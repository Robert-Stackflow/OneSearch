package console

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestApplicationIsolationAndKeyTypes(t *testing.T) {
	s := testServer(t)
	id := randomID()
	calls := 0
	grants := map[string]any{
		"app-search-key":   map[string]any{"key": "app-search-key", "actions": []string{"search"}, "indexes": []string{"blog"}},
		"app-readonly-key": map[string]any{"key": "app-readonly-key", "actions": []string{"search", "documents.get", "indexes.get", "settings.get", "tasks.get", "stats.get"}, "indexes": []string{"blog"}},
		"app-admin-key":    map[string]any{"key": "app-admin-key", "actions": []string{"search", "documents.get", "documents.add", "documents.delete", "indexes.get", "settings.get", "settings.update", "tasks.get", "stats.get"}, "indexes": []string{"blog"}},
		"app-chat-key":     map[string]any{"key": "app-chat-key", "actions": []string{"search", "chatCompletions"}, "indexes": []string{"blog"}},
		"multi-index-key":  map[string]any{"key": "multi-index-key", "actions": []string{"search"}, "indexes": []string{"blog", "docs"}},
	}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/keys/") {
			if r.Header.Get("Authorization") != "Bearer master-key" {
				t.Error("credential lookup must use backend key")
			}
			if grant, ok := grants[strings.TrimPrefix(r.URL.Path, "/keys/")]; ok {
				json.NewEncoder(w).Encode(grant)
			} else {
				w.WriteHeader(404)
			}
			return
		}
		if r.URL.Path == "/indexes/blog" && r.Header.Get("Authorization") == "Bearer master-key" {
			w.Write([]byte(`{"uid":"blog"}`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/indexes/") && r.Header.Get("Authorization") == "Bearer master-key" {
			w.WriteHeader(404)
			return
		}
		calls++
		if r.Header.Get("Authorization") == "Bearer master-key" {
			t.Error("app API escalated to master")
		}
		if strings.HasSuffix(r.URL.Path, "/search") {
			w.Write([]byte(`{"hits":[],"totalHits":0,"totalPages":0,"page":1,"hitsPerPage":6}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/chat/completions") {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Write([]byte("data: {\"text\":\"hello\"}\n\ndata: [DONE]\n\n"))
			return
		}
		if r.URL.Path == "/tasks" && r.URL.Query().Get("indexUids") != "blog" {
			t.Error("task list not index scoped")
		}
		if r.Method == "POST" || r.Method == "PATCH" {
			w.WriteHeader(202)
			w.Write([]byte(`{"taskUid":1}`))
			return
		}
		w.Write([]byte(`{"results":[{"id":"1","title":"Hello"}],"uid":"blog"}`))
	}))
	defer engine.Close()
	if e := s.store.SaveInstance(Instance{ID: id, Host: engine.URL, Secret: "master-key", Status: "running", Name: "Blog", CreatedAt: now()}); e != nil {
		t.Fatal(e)
	}
	cookie := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`).Result().Cookies()[0]
	route := "/api/instances/" + id + "/sites/blog/application"
	if w := call(s, "GET", route, "", cookie); !bytes.Contains(w.Body.Bytes(), []byte(`"data":null`)) {
		t.Fatal("read created application", w.Body.String())
	}
	if w := call(s, "POST", route, ""); w.Code != 401 {
		t.Fatal("anonymous application creation")
	}
	w := call(s, "POST", route, "", cookie)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var value struct{ Data Application }
	json.Unmarshal(w.Body.Bytes(), &value)
	app := value.Data.ID
	w = call(s, "POST", route, "", cookie)
	if !bytes.Contains(w.Body.Bytes(), []byte(app)) {
		t.Fatal("repeated create changed App ID")
	}
	if call(s, "POST", "/api/instances/"+id+"/sites/missing/application", "", cookie).Code != 404 {
		t.Fatal("orphan application created")
	}
	policy, _ := json.Marshal(SitePolicy{Enabled: true, Origins: []string{"https://blog.example.com"}, RequireOrigin: true, Rate: 100, MaxLimit: 10})
	s.store.db.Exec("INSERT INTO site_policies VALUES(?,?,?)", id, "blog", string(policy))
	request := func(method, path, key, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/apps/"+app+"/"+path, strings.NewReader(body))
		r.RemoteAddr = "192.0.2.3:1234"
		r.Header.Set("Authorization", "Bearer "+key)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	for _, key := range []string{"app-search-key", "app-readonly-key", "app-admin-key", "app-chat-key"} {
		if w := request("POST", "search", key, `{"q":"hello"}`, "https://blog.example.com"); w.Code != 200 {
			t.Fatal("valid App key search failed", key, w.Body.String())
		}
	}
	before := calls
	for _, key := range []string{"app-search-key", "app-readonly-key", "app-chat-key", "multi-index-key", "master-key"} {
		if w := request("POST", "documents", key, `[{"id":"new"}]`, ""); w.Code < 400 {
			t.Fatal("unauthorized app write", key)
		}
	}
	if calls != before {
		t.Fatal("unauthorized write reached engine")
	}
	if request("POST", "search", "multi-index-key", `{}`, "https://blog.example.com").Code != 403 {
		t.Fatal("multi-index key accepted")
	}
	for _, path := range []string{"documents", "documents/1", "index", "settings", "stats", "tasks"} {
		if w := request("GET", path, "app-readonly-key", "", ""); w.Code != 200 {
			t.Fatal("readonly failed", path, w.Body.String())
		}
	}
	if request("PATCH", "settings", "app-readonly-key", `{}`, "").Code != 403 {
		t.Fatal("readonly settings mutation allowed")
	}
	if request("PATCH", "settings", "app-admin-key", `{}`, "").Code != 202 {
		t.Fatal("admin settings failed")
	}
	if request("POST", "documents", "app-admin-key", `[{"id":"new"}]`, "").Code != 202 {
		t.Fatal("admin write failed")
	}
	if request("GET", "tasks?indexUids=docs", "app-readonly-key", "", "").Code != 400 {
		t.Fatal("foreign task filter allowed")
	}
	if request("GET", "settings", "app-readonly-key", "", "https://blog.example.com").Code != 403 {
		t.Fatal("browser admin access allowed")
	}
	for _, key := range []string{"app-search-key", "app-readonly-key", "app-admin-key"} {
		if request("POST", "chat/completions", key, `{"messages":[]}`, "https://blog.example.com").Code != 403 {
			t.Fatal("non-chat key accepted", key)
		}
	}
	w = request("POST", "chat/completions", "app-chat-key", `{"messages":[]}`, "https://blog.example.com")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "[DONE]") || w.Header().Get("Content-Type") != "text/event-stream" || w.Header().Get("X-Accel-Buffering") != "no" {
		t.Fatal("chat streaming failed", w.Body.String())
	}
	if request("POST", "chat/completions", "app-chat-key", `{}`, "https://evil.example.com").Code != 403 {
		t.Fatal("chat origin bypass")
	}
	if request("OPTIONS", "chat/completions", "", "", "https://blog.example.com").Code != 204 {
		t.Fatal("chat preflight failed")
	}
	delete(grants, "app-readonly-key")
	if request("GET", "settings", "app-readonly-key", "", "").Code != 401 {
		t.Fatal("revoked key remained valid")
	}
}
