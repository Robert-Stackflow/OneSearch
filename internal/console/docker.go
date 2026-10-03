package console

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// DockerRuntime uses an operator-configured socket, image, network and host data
// directory. None can be chosen by a browser request. Engines have no host ports.
type DockerRuntime struct {
	client                                  *http.Client
	image, network, owner, hostDir, dataDir string
}

var engineIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func NewDockerRuntime(cfg Config) (*DockerRuntime, error) {
	if !filepath.IsAbs(cfg.DockerHostDataDir) || cfg.DockerNetwork == "" || cfg.DockerOwner == "" || cfg.DockerImage == "" {
		return nil, errors.New("Docker 运行时需要绝对宿主机数据目录、固定镜像、网络和部署标识")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", cfg.DockerSocket)
	}}
	return &DockerRuntime{client: &http.Client{Transport: transport, Timeout: 45 * time.Second}, image: cfg.DockerImage, network: cfg.DockerNetwork, owner: cfg.DockerOwner, hostDir: cfg.DockerHostDataDir, dataDir: cfg.DataDir}, nil
}

func (d *DockerRuntime) request(ctx context.Context, method, path string, value any) ([]byte, int, error) {
	var body io.Reader
	if value != nil {
		b, e := json.Marshal(value)
		if e != nil {
			return nil, 0, e
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, "http://docker/v1.53"+path, body)
	if e != nil {
		return nil, 0, e
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := d.client.Do(req)
	if e != nil {
		return nil, 0, errors.New("无法连接 Docker 服务")
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if e != nil {
		return nil, res.StatusCode, e
	}
	if res.StatusCode >= 400 {
		return b, res.StatusCode, fmt.Errorf("Docker 操作失败（HTTP %d），请检查服务端日志和运行时配置", res.StatusCode)
	}
	return b, res.StatusCode, nil
}
func (d *DockerRuntime) Version(ctx context.Context) (string, error) {
	if _, _, e := d.request(ctx, "GET", "/version", nil); e != nil {
		return "", e
	}
	if _, _, e := d.request(ctx, "GET", "/images/"+url.PathEscape(d.image)+"/json", nil); e != nil {
		return "", errors.New("请先拉取配置的 Meilisearch 镜像")
	}
	return d.image, nil
}
func engineName(id string) string { return "onesearch-engine-" + id }

type dockerContainer struct {
	Config struct {
		Labels map[string]string
		Image  string
	}
	State struct {
		Running bool
		Pid     int
	}
	Mounts []struct{ Source, Destination string }
}

func (d *DockerRuntime) inspect(ctx context.Context, id string) (dockerContainer, int, error) {
	var c dockerContainer
	if !engineIDPattern.MatchString(id) {
		return c, 0, errors.New("无效实例标识")
	}
	b, status, e := d.request(ctx, "GET", "/containers/"+engineName(id)+"/json", nil)
	if e != nil {
		return c, status, e
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return c, status, e
	}
	if c.Config.Labels["onesearch.owner"] != d.owner || c.Config.Labels["onesearch.instance"] != id {
		return c, status, errors.New("容器不属于当前部署，拒绝操作")
	}
	// A matching name or label alone must not authorize a foreign data mount.
	want := filepath.Join(d.hostDir, "instances", id)
	for _, m := range c.Mounts {
		if m.Source == want && m.Destination == "/meili_data" {
			return c, status, nil
		}
	}
	return c, status, errors.New("容器数据目录不匹配，拒绝操作")
}
func (d *DockerRuntime) Owns(id string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, e := d.inspect(ctx, id)
	return e == nil
}
func (d *DockerRuntime) Start(i Instance) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	c, status, e := d.inspect(ctx, i.ID)
	if e != nil && status != 404 {
		return 0, e
	}
	if status == 404 {
		if e = os.MkdirAll(filepath.Join(d.dataDir, "instances", i.ID), 0700); e != nil {
			return 0, e
		}
		config := map[string]any{
			"Image": d.image, "WorkingDir": "/meili_data", "User": "0:0",
			"Env":    []string{"MEILI_MASTER_KEY=" + i.Secret, "MEILI_ENV=production", "MEILI_NO_ANALYTICS=true"},
			"Cmd":    []string{"meilisearch", "--http-addr", "0.0.0.0:7700", "--db-path", "/meili_data/data.ms", "--dump-dir", "/meili_data/dumps", "--snapshot-dir", "/meili_data/snapshots", "--max-indexing-memory", fmt.Sprintf("%dMiB", i.MemoryMB), "--max-indexing-threads", fmt.Sprint(i.Threads)},
			"Labels": map[string]string{"onesearch.owner": d.owner, "onesearch.instance": i.ID},
			"HostConfig": map[string]any{
				"NetworkMode": d.network, "RestartPolicy": map[string]string{"Name": "unless-stopped"},
				"Mounts":  []map[string]any{{"Type": "bind", "Source": filepath.Join(d.hostDir, "instances", i.ID), "Target": "/meili_data"}},
				"CapDrop": []string{"ALL"}, "SecurityOpt": []string{"no-new-privileges:true"},
				"LogConfig": map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "10m", "max-file": "3"}},
			},
		}
		if _, _, e = d.request(ctx, "POST", "/containers/create?name="+engineName(i.ID), config); e != nil {
			return 0, e
		}
	} else if c.State.Running {
		return c.State.Pid, nil
	}
	if _, _, e = d.request(ctx, "POST", "/containers/"+engineName(i.ID)+"/start", nil); e != nil {
		return 0, e
	}
	c, _, e = d.inspect(ctx, i.ID)
	return c.State.Pid, e
}
func (d *DockerRuntime) Stop(i Instance) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, _, e := d.inspect(ctx, i.ID)
	if e != nil {
		return e
	}
	if !c.State.Running {
		return nil
	}
	_, _, e = d.request(ctx, "POST", "/containers/"+engineName(i.ID)+"/stop?t=15", nil)
	return e
}

// Console upgrades do not interrupt independent search engines.
func (d *DockerRuntime) Shutdown() {}
func dockerLogText(b []byte) string {
	var out bytes.Buffer
	for len(b) >= 8 {
		n := int(binary.BigEndian.Uint32(b[4:8]))
		if n < 0 || n > len(b)-8 {
			break
		}
		out.Write(b[8 : 8+n])
		b = b[8+n:]
	}
	text := out.String()
	if len(text) > 65536 {
		text = text[len(text)-65536:]
	}
	return text
}
func (d *DockerRuntime) Logs(i Instance) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, _, e := d.inspect(ctx, i.ID); e != nil {
		return "", e
	}
	b, _, e := d.request(ctx, "GET", "/containers/"+engineName(i.ID)+"/logs?stdout=true&stderr=true&tail=500", nil)
	return strings.ReplaceAll(dockerLogText(b), i.Secret, "[REDACTED]"), e
}
