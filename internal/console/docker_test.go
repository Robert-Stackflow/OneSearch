package console

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerLifecycleAndOwnership(t *testing.T) {
	id := strings.Repeat("a", 32)
	dir := t.TempDir()
	exists, running, foreign := false, false, false
	created, started, stopped := 0, 0, 0
	var d *DockerRuntime
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/v1.53")
		switch {
		case p == "/version" || strings.HasPrefix(p, "/images/"):
			w.Write([]byte(`{}`))
		case strings.HasSuffix(p, "/json"):
			if !exists {
				w.WriteHeader(404)
				return
			}
			owner := d.owner
			if foreign {
				owner = "another-app"
			}
			json.NewEncoder(w).Encode(map[string]any{"Config": map[string]any{"Labels": map[string]string{"onesearch.owner": owner, "onesearch.instance": id}}, "State": map[string]any{"Running": running, "Pid": 123}, "Mounts": []map[string]string{{"Source": filepath.Join(dir, "instances", id), "Destination": "/meili_data"}}})
		case p == "/containers/create":
			var config map[string]any
			json.NewDecoder(r.Body).Decode(&config)
			host := config["HostConfig"].(map[string]any)
			if host["PortBindings"] != nil || host["Privileged"] != nil || host["NetworkMode"] != "test-network" {
				t.Error("engine must use fixed network with no host ports or privileged access")
			}
			if config["Image"] != "fixed-image" || !strings.Contains(strings.Join(anyStrings(config["Env"]), " "), "MEILI_ENV=production") {
				t.Error("image or production mode is incorrect")
			}
			created++
			exists = true
			w.WriteHeader(201)
			w.Write([]byte(`{"Id":"container"}`))
		case strings.HasSuffix(p, "/start"):
			started++
			running = true
			w.WriteHeader(204)
		case strings.HasSuffix(p, "/stop"):
			stopped++
			running = false
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected Docker route %s", p)
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	// Reuse the fake transport without giving production a configurable remote URL.
	d = &DockerRuntime{client: &http.Client{Transport: rewriteTransport{api.URL, http.DefaultTransport}}, image: "fixed-image", network: "test-network", owner: "deployment", hostDir: dir, dataDir: dir}
	i := Instance{ID: id, Secret: strings.Repeat("b", 64), MemoryMB: 512, Threads: 2}
	if _, e := d.Version(context.Background()); e != nil {
		t.Fatal(e)
	}
	if _, e := d.Start(i); e != nil {
		t.Fatal(e)
	}
	if _, e := d.Start(i); e != nil {
		t.Fatal(e)
	}
	if created != 1 || started != 1 || !d.Owns(id) {
		t.Fatal("create and start must be idempotent")
	}
	d.Shutdown()
	if !running {
		t.Fatal("console shutdown interrupted engine")
	}
	if e := d.Stop(i); e != nil {
		t.Fatal(e)
	}
	foreign = true
	if d.Owns(id) {
		t.Fatal("foreign container was treated as owned")
	}
	if e := d.Stop(i); e == nil {
		t.Fatal("foreign stop was allowed")
	}
	if _, e := d.Start(i); e == nil {
		t.Fatal("foreign start was allowed")
	}
	if stopped != 1 || started != 1 {
		t.Fatal("foreign container was mutated")
	}
	if _, e := d.Start(Instance{ID: "../../other"}); e == nil {
		t.Fatal("invalid ID accepted")
	}
}

type rewriteTransport struct {
	base      string
	transport http.RoundTripper
}

func (t rewriteTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	req := r.Clone(r.Context())
	u, e := http.NewRequest(r.Method, t.base+r.URL.RequestURI(), nil)
	if e != nil {
		return nil, e
	}
	req.URL = u.URL
	return t.transport.RoundTrip(req)
}
func anyStrings(value any) []string {
	out := []string{}
	for _, v := range value.([]any) {
		out = append(out, v.(string))
	}
	return out
}
func TestDockerLogFrames(t *testing.T) {
	var data []byte
	for _, text := range []string{"first\n", "latest\n"} {
		header := make([]byte, 8)
		header[0] = 1
		binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
		data = append(data, header...)
		data = append(data, []byte(text)...)
	}
	if got := dockerLogText(data); got != "first\nlatest\n" {
		t.Fatal(got)
	}
	if dockerLogText([]byte{1, 0, 0}) != "" {
		t.Fatal("partial frame accepted")
	}
}
