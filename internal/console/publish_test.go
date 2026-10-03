package console

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScopedPublishingGateway(t *testing.T) {
	s := testServer(t)
	id := randomID()
	calls := 0
	keys := map[string]any{
		"publisher-key":       map[string]any{"key": "publisher-key", "uid": "publish-uid", "actions": []string{"documents.get", "documents.add", "documents.delete", "tasks.get"}, "indexes": []string{"blog"}},
		"search-only-key":     map[string]any{"key": "search-only-key", "actions": []string{"search"}, "indexes": []string{"blog"}},
		"broad-publisher-key": map[string]any{"key": "broad-publisher-key", "actions": []string{"*"}, "indexes": []string{"*"}},
		"wrong-index-key":     map[string]any{"key": "wrong-index-key", "actions": []string{"documents.add"}, "indexes": []string{"docs"}},
		"expired-key":         map[string]any{"key": "expired-key", "actions": []string{"documents.add"}, "indexes": []string{"blog"}, "expiresAt": time.Now().Add(-time.Minute).Format(time.RFC3339)},
	}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/keys/") {
			if r.Header.Get("Authorization") != "Bearer master-key" {
				t.Error("grant lookup did not use backend credential")
			}
			key := strings.TrimPrefix(r.URL.Path, "/keys/")
			if v, ok := keys[key]; ok {
				json.NewEncoder(w).Encode(v)
			} else {
				w.WriteHeader(404)
			}
			return
		}
		calls++
		if r.Header.Get("Authorization") != "Bearer publisher-key" {
			t.Error("write elevated to master key")
		}
		if r.URL.Path == "/tasks/2" {
			w.Write([]byte(`{"indexUid":"docs","status":"succeeded"}`))
			return
		}
		if r.URL.Path == "/tasks/1" {
			w.Write([]byte(`{"indexUid":"blog","status":"succeeded"}`))
			return
		}
		if r.Method == "GET" {
			if r.URL.Query().Get("fields") != "id" {
				t.Error("publisher exposed arbitrary document fields")
			}
			w.Write([]byte(`{"results":[{"id":"old"}],"total":1}`))
			return
		}
		w.WriteHeader(202)
		w.Write([]byte(`{"taskUid":1}`))
	}))
	defer engine.Close()
	s.store.SaveInstance(Instance{ID: id, Host: engine.URL, Secret: "master-key", Status: "running", CreatedAt: now()})
	request := func(method, path, key, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/publish/"+id+"/blog/"+path, bytes.NewBufferString(body))
		r.RemoteAddr = "192.0.2.50:1234"
		if key != "" {
			r.Header.Set("Authorization", "Bearer "+key)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	for _, key := range []string{"", "master-key", "search-only-key", "broad-publisher-key", "wrong-index-key", "expired-key", "revoked-key"} {
		if w := request("POST", "documents", key, `[{"id":"new","title":"Hello"}]`, ""); w.Code < 400 {
			t.Fatal("forbidden publisher accepted", key)
		}
	}
	if calls != 0 {
		t.Fatal("invalid credential reached mutation endpoint")
	}
	if request("POST", "documents", "publisher-key", `[{"id":"new"}]`, "https://blog.example.com").Code != 403 {
		t.Fatal("browser write accepted")
	}
	if request("POST", "documents", "publisher-key", `[{"id":"new","title":"Hello"}]`, "").Code != 202 {
		t.Fatal("valid publishing rejected")
	}
	if request("POST", "documents/delete-batch", "publisher-key", `["old"]`, "").Code != 202 {
		t.Fatal("scoped deletion rejected")
	}
	if request("GET", "documents?fields=id&limit=1000", "publisher-key", "", "").Code != 200 {
		t.Fatal("id inventory rejected")
	}
	if request("GET", "tasks/1", "publisher-key", "", "").Code != 200 {
		t.Fatal("own task rejected")
	}
	if request("GET", "tasks/2", "publisher-key", "", "").Code != 403 {
		t.Fatal("foreign task exposed")
	}
	for _, body := range []string{`[]`, `[{"title":"no id"}]`, `[{"id":"a"},{"id":"a"}]`, `[{"id":"../escape"}]`} {
		if request("POST", "documents", "publisher-key", body, "").Code != 400 {
			t.Fatal("invalid documents accepted", body)
		}
	}
	if request("GET", "documents?fields=content", "publisher-key", "", "").Code != 400 {
		t.Fatal("publisher read content")
	}
	delete(keys, "publisher-key")
	if request("POST", "documents", "publisher-key", `[{"id":"new"}]`, "").Code != 401 {
		t.Fatal("revoked key cached")
	}
}
