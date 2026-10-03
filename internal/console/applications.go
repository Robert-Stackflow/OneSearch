package console

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Application struct {
	ID         string `json:"appId"`
	InstanceID string `json:"instanceId"`
	IndexUID   string `json:"indexUid"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
}

func (s *Server) application(w http.ResponseWriter, r *http.Request) {
	id, index := r.PathValue("id"), r.PathValue("index")
	if !engineIDPattern.MatchString(id) || !uidPattern.MatchString(index) {
		fail(w, 400, "实例或索引无效")
		return
	}
	var a Application
	err := s.store.db.QueryRow("SELECT app_id,instance_id,index_uid,name,created_at FROM applications WHERE instance_id=? AND index_uid=?", id, index).Scan(&a.ID, &a.InstanceID, &a.IndexUID, &a.Name, &a.CreatedAt)
	if err == nil {
		send(w, 200, a)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "无法读取应用")
		return
	}
	if r.Method == "GET" {
		send(w, 200, nil)
		return
	}
	i, err := s.store.GetInstance(id)
	if err != nil || i.Status != "running" {
		fail(w, 409, "请先启动实例")
		return
	}
	_, status, err := upstream(r.Context(), i, "GET", "/indexes/"+index, nil)
	if err != nil || status != 200 {
		fail(w, 404, "索引不存在")
		return
	}
	a = Application{"app_" + randomID(), id, index, i.Name + " / " + index, now()}
	_, err = s.store.db.Exec("INSERT INTO applications VALUES(?,?,?,?,?) ON CONFLICT(instance_id,index_uid) DO NOTHING", a.ID, id, index, a.Name, a.CreatedAt)
	if err != nil {
		fail(w, 500, "无法创建应用")
		return
	}
	err = s.store.db.QueryRow("SELECT app_id,instance_id,index_uid,name,created_at FROM applications WHERE instance_id=? AND index_uid=?", id, index).Scan(&a.ID, &a.InstanceID, &a.IndexUID, &a.Name, &a.CreatedAt)
	if err != nil {
		fail(w, 500, "无法读取应用")
		return
	}
	s.store.Audit(r.Context().Value(actorKey{}).(string), "application.create", a.ID)
	send(w, 200, a)
}

func (s *Server) withApp(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		app := r.PathValue("app")
		if len(app) != 36 || !strings.HasPrefix(app, "app_") || !engineIDPattern.MatchString(strings.TrimPrefix(app, "app_")) {
			fail(w, 404, "应用不存在")
			return
		}
		var id, index string
		if s.store.db.QueryRow("SELECT instance_id,index_uid FROM applications WHERE app_id=?", app).Scan(&id, &index) != nil {
			fail(w, 404, "应用不存在")
			return
		}
		r.SetPathValue("id", id)
		r.SetPathValue("index", index)
		next(w, r)
	}
}
func (s *Server) appRoutes(m *http.ServeMux) {
	for _, method := range []string{"POST", "OPTIONS"} {
		m.HandleFunc(method+" /api/apps/{app}/search", s.withApp(s.publicSearch))
		m.HandleFunc(method+" /api/apps/{app}/chat/completions", s.withApp(s.appChat))
	}
	for _, pattern := range []string{"GET /api/apps/{app}/documents", "POST /api/apps/{app}/documents", "POST /api/apps/{app}/documents/delete-batch", "GET /api/apps/{app}/tasks/{task}"} {
		m.HandleFunc(pattern, s.withApp(s.publish))
	}
	for _, pattern := range []string{"GET /api/apps/{app}/index", "GET /api/apps/{app}/stats", "GET /api/apps/{app}/settings", "PATCH /api/apps/{app}/settings", "GET /api/apps/{app}/tasks", "GET /api/apps/{app}/documents/{document}"} {
		m.HandleFunc(pattern, s.withApp(s.appRead))
	}
}

func (s *Server) appChatSettings(w http.ResponseWriter, r *http.Request) {
	id, index := r.PathValue("id"), r.PathValue("index")
	var app string
	if s.store.db.QueryRow("SELECT app_id FROM applications WHERE instance_id=? AND index_uid=?", id, index).Scan(&app) != nil {
		fail(w, 404, "请先创建应用")
		return
	}
	i, e := s.store.GetInstance(id)
	if e != nil || i.Status != "running" {
		fail(w, 409, "请先启动实例")
		return
	}
	var body []byte
	if r.Method == "PATCH" {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		body, e = io.ReadAll(r.Body)
		var obj map[string]any
		if e != nil || json.Unmarshal(body, &obj) != nil || obj == nil {
			fail(w, 400, "模型配置必须是 JSON 对象")
			return
		}
		_, status, e := upstream(r.Context(), i, "PATCH", "/experimental-features", strings.NewReader(`{"chatCompletions":true}`))
		if e != nil || status != 200 {
			fail(w, 502, "无法启用引擎对话功能")
			return
		}
	}
	data, status, e := upstream(r.Context(), i, r.Method, "/chats/"+app+"/settings", bytes.NewReader(body))
	if e != nil {
		fail(w, 502, "无法连接引擎")
		return
	}
	if status >= 400 {
		fail(w, status, "请先保存模型服务配置，确认引擎支持对话功能")
		return
	}
	var obj map[string]any
	if json.Unmarshal(data, &obj) != nil {
		fail(w, 502, "模型配置响应无效")
		return
	}
	delete(obj, "apiKey")
	if r.Method == "PATCH" {
		s.store.Audit(r.Context().Value(actorKey{}).(string), "application.chat.update", app)
	}
	send(w, status, obj)
}

// App management credentials remain server-side. Only the bound index is exposed.
func (s *Server) appRead(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "" {
		fail(w, 403, "管理入口仅接受服务器请求")
		return
	}
	if !s.allowAttempt("app-admin:"+peerIP(r), 300) {
		fail(w, 429, "请求过于频繁")
		return
	}
	index := r.PathValue("index")
	tail := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	action, path := "indexes.get", "/indexes/"+index
	switch {
	case r.PathValue("document") != "":
		if !uidPattern.MatchString(r.PathValue("document")) {
			fail(w, 400, "文档标识无效")
			return
		}
		action = "documents.get"
		path += "/documents/" + r.PathValue("document")
	case tail == "settings":
		action = "settings.get"
		if r.Method == "PATCH" {
			action = "settings.update"
		}
		path += "/settings"
	case tail == "stats":
		action = "stats.get"
		path += "/stats"
	case tail == "tasks":
		action = "tasks.get"
		path = "/tasks"
	}
	i, key, ok := s.gatewayCredential(w, r, index, action, false)
	if !ok {
		return
	}
	q := r.URL.Query()
	for k := range q {
		if tail != "tasks" || (k != "limit" && k != "from" && k != "statuses" && k != "types") {
			fail(w, 400, "不支持该查询参数")
			return
		}
	}
	if tail == "tasks" {
		q.Set("indexUids", index)
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var body []byte
	if r.Method == "PATCH" {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var e error
		body, e = io.ReadAll(r.Body)
		var obj map[string]any
		if e != nil || json.Unmarshal(body, &obj) != nil || obj == nil {
			fail(w, 400, "请提供不超过 64 KiB 的设置对象")
			return
		}
	}
	res, status, e := upstream(r.Context(), i, r.Method, path, bytes.NewReader(body))
	if e != nil {
		fail(w, 502, "无法连接引擎")
		return
	}
	if status >= 400 {
		fail(w, status, "引擎拒绝该应用请求")
		return
	}
	if r.Method == "PATCH" {
		s.store.Audit("app-key:"+key, "application.settings.update", r.PathValue("app"))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(res)
}

func (s *Server) appChat(w http.ResponseWriter, r *http.Request) {
	id, index := r.PathValue("id"), r.PathValue("index")
	p := s.policy(id, index)
	if !p.Enabled || !originAllowed(p, r) {
		fail(w, 403, "该站点的访问未被允许")
		return
	}
	w.Header().Set("Vary", "Origin")
	if o := r.Header.Get("Origin"); o != "" {
		w.Header().Set("Access-Control-Allow-Origin", o)
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "POST")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.WriteHeader(204)
		return
	}
	if !s.allowAttempt("chat:"+id+":"+index+":"+peerIP(r), p.Rate) {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "对话请求过于频繁")
		return
	}
	i, _, ok := s.gatewayCredential(w, r, index, "chatCompletions", false)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	body, e := io.ReadAll(r.Body)
	var payload map[string]any
	if e != nil || json.Unmarshal(body, &payload) != nil || payload == nil {
		fail(w, 400, "请提供不超过 64 KiB 的对话请求")
		return
	}
	// Workspace UID is the stable App ID; clients cannot select another workspace.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "POST", i.Host+"/chats/"+url.PathEscape(r.PathValue("app"))+"/chat/completions", bytes.NewReader(body))
	if e != nil {
		fail(w, 502, "无法创建对话请求")
		return
	}
	req.Header.Set("Authorization", "Bearer "+i.Secret)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, e := client.Do(req)
	if e != nil {
		fail(w, 502, "无法连接对话服务")
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		fail(w, res.StatusCode, "引擎拒绝对话请求，请检查实验功能与该应用的模型服务配置")
		return
	}
	w.Header().Set("Content-Type", res.Header.Get("Content-Type"))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(res.StatusCode)
	buf := make([]byte, 8192)
	for {
		n, e := res.Body.Read(buf)
		if n > 0 {
			if _, err := w.Write(buf[:n]); err != nil {
				return
			}
			http.NewResponseController(w).Flush()
		}
		if e != nil {
			return
		}
	}
}
