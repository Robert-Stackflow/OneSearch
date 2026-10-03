package console

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (s *Server) extraSchema() error {
	if e := s.securitySchema(); e != nil {
		return e
	}
	_, e := s.store.db.Exec(`
CREATE TABLE IF NOT EXISTS site_policies(instance_id TEXT NOT NULL,index_uid TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(instance_id,index_uid));
CREATE TABLE IF NOT EXISTS search_history(id TEXT PRIMARY KEY,instance_id TEXT NOT NULL,index_uid TEXT NOT NULL,source TEXT NOT NULL,query TEXT NOT NULL,ip TEXT NOT NULL,status INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS history_date ON search_history(created_at);
CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
`)
	if e != nil {
		return e
	}
	return s.analyticsSchema()
}
func (s *Server) extraRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/calendar", s.calendar)
	m.HandleFunc("GET /api/instances/{id}/analytics", s.instanceAnalytics)
	m.HandleFunc("GET /api/instances/{id}/operations", s.instanceOperations)
	m.HandleFunc("POST /api/auth/reauth", s.reauth)
	m.HandleFunc("POST /api/account/password", s.changePassword)
	m.HandleFunc("GET /api/security", s.securityStatus)
	m.HandleFunc("POST /api/security/totp/begin", s.beginTOTP)
	m.HandleFunc("POST /api/security/totp/confirm", s.confirmTOTP)
	m.HandleFunc("POST /api/security/totp/disable", s.disableTOTP)
	m.HandleFunc("GET /api/passkeys", s.listPasskeys)
	m.HandleFunc("POST /api/passkeys/begin", s.registerPasskeyBegin)
	m.HandleFunc("POST /api/passkeys/finish", s.registerPasskeyFinish)
	m.HandleFunc("DELETE /api/passkeys/{key}", s.deletePasskey)
	m.HandleFunc("GET /api/sessions", s.sessions)
	m.HandleFunc("DELETE /api/sessions/{session}", s.revokeSession)
	m.HandleFunc("GET /api/history", s.history)
	m.HandleFunc("GET /api/instances/{id}/sites/{index}", s.getPolicy)
	m.HandleFunc("PUT /api/instances/{id}/sites/{index}", s.putPolicy)
	m.HandleFunc("GET /api/backups", s.listBackups)
	m.HandleFunc("POST /api/backups", s.createBackup)
	m.HandleFunc("GET /api/backups/{backup}/download", s.downloadBackup)
}
func (s *Server) allowAttempt(key string, max int) bool {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	ts := []time.Time{}
	for _, t := range s.loginFailures[key] {
		if time.Since(t) < time.Minute {
			ts = append(ts, t)
		}
	}
	if len(ts) >= max {
		return false
	}
	s.loginFailures[key] = append(ts, time.Now())
	if len(s.loginFailures) > 10000 {
		for k, v := range s.loginFailures {
			if len(v) == 0 || time.Since(v[len(v)-1]) > time.Minute {
				delete(s.loginFailures, k)
			}
		}
	}
	return true
}

type SitePolicy struct {
	Enabled       bool     `json:"enabled"`
	Origins       []string `json:"origins"`
	RequireOrigin bool     `json:"requireOrigin"`
	Rate          int      `json:"rate"`
	MaxLimit      int      `json:"maxLimit"`
}

func (s *Server) policy(id, index string) SitePolicy {
	p := SitePolicy{Origins: []string{}, RequireOrigin: true, Rate: 60, MaxLimit: 50}
	var raw string
	if s.store.db.QueryRow("SELECT payload FROM site_policies WHERE instance_id=? AND index_uid=?", id, index).Scan(&raw) == nil {
		json.Unmarshal([]byte(raw), &p)
	}
	return p
}
func (s *Server) getPolicy(w http.ResponseWriter, r *http.Request) {
	send(w, 200, s.policy(r.PathValue("id"), r.PathValue("index")))
}
func validOrigin(v string) bool {
	u, e := url.Parse(v)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.String() == v
}
func (s *Server) putPolicy(w http.ResponseWriter, r *http.Request) {
	id, index := r.PathValue("id"), r.PathValue("index")
	if !uidPattern.MatchString(index) {
		fail(w, 400, "索引标识无效")
		return
	}
	if _, e := s.store.GetInstance(id); e != nil {
		fail(w, 404, "实例不存在")
		return
	}
	var p SitePolicy
	if e := decode(w, r, &p); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if p.Rate < 1 || p.Rate > 1000 || p.MaxLimit < 1 || p.MaxLimit > 100 || len(p.Origins) > 30 {
		fail(w, 400, "频率为 1–1000 次/分钟，结果数为 1–100，最多 30 个站点")
		return
	}
	for _, origin := range p.Origins {
		if !validOrigin(origin) {
			fail(w, 400, "来源应为完整协议和域名，例如 https://example.com，不含路径")
			return
		}
	}
	b, _ := json.Marshal(p)
	_, e := s.store.db.Exec("INSERT INTO site_policies VALUES(?,?,?) ON CONFLICT(instance_id,index_uid) DO UPDATE SET payload=excluded.payload", id, index, string(b))
	if e != nil {
		fail(w, 500, "无法保存规则")
		return
	}
	s.store.Audit(r.Context().Value(actorKey{}).(string), "site-policy.update", id+"/"+index)
	send(w, 200, p)
}
func originAllowed(p SitePolicy, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		if u, e := url.Parse(r.Referer()); e == nil && u.Scheme != "" && u.Host != "" {
			origin = u.Scheme + "://" + u.Host
		}
	}
	if origin == "" {
		return !p.RequireOrigin
	}
	for _, v := range p.Origins {
		if v == origin {
			return true
		}
	}
	return false
}
func (s *Server) publicSearch(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	id, index := r.PathValue("id"), r.PathValue("index")
	p := s.policy(id, index)
	var body, response []byte
	status := 403
	defer func() {
		if r.Method != "OPTIONS" {
			s.recordSearch(r, id, index, "public", body, response, status, start)
		}
	}()
	if !uidPattern.MatchString(index) || !p.Enabled || !originAllowed(p, r) {
		fail(w, 403, "该站点的搜索访问未被允许")
		return
	}
	w.Header().Set("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "POST")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(204)
		return
	}
	if !s.allowAttempt("search:"+id+":"+index+":"+peerIP(r), p.Rate) {
		status = 429
		w.Header().Set("Retry-After", "60")
		fail(w, status, "搜索请求过于频繁")
		return
	}
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") || len(auth) < 12 || len(auth) > 1024 {
		status = 401
		fail(w, status, "请提供索引专属搜索密钥")
		return
	}
	i, e := s.store.GetInstance(id)
	if e != nil || i.Status != "running" {
		status = 503
		fail(w, status, "搜索实例暂不可用")
		return
	}
	if strings.TrimPrefix(auth, "Bearer ") == i.Secret {
		status = 403
		fail(w, status, "公开入口不接受实例主密钥")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	body, e = io.ReadAll(r.Body)
	if e != nil {
		status = 413
		fail(w, status, "搜索请求不得超过 64 KiB")
		return
	}
	var req map[string]any
	if json.Unmarshal(body, &req) != nil || req == nil {
		status = 400
		fail(w, status, "搜索内容必须是 JSON 对象")
		return
	}
	allowed := map[string]bool{"q": true, "limit": true, "offset": true, "page": true, "hitsPerPage": true, "filter": true, "sort": true, "attributesToRetrieve": true, "attributesToHighlight": true, "attributesToCrop": true, "facets": true, "showMatchesPosition": true, "highlightPreTag": true, "highlightPostTag": true, "cropLength": true, "cropMarker": true, "showRankingScore": true}
	for k := range req {
		if !allowed[k] {
			status = 400
			fail(w, status, "不支持此搜索参数")
			return
		}
	}
	// page/hitsPerPage overrides limit in Meilisearch, so cap both pagination modes.
	for _, k := range []string{"limit", "offset", "page", "hitsPerPage"} {
		if v, exists := req[k]; exists {
			n, ok := v.(float64)
			if !ok || n < 0 || n > 1e9 || math.Trunc(n) != n {
				status = 400
				fail(w, status, "分页参数必须是有效的非负整数")
				return
			}
		}
	}
	_, paged := req["page"]
	_, sized := req["hitsPerPage"]
	sizeField := "limit"
	if paged || sized {
		sizeField = "hitsPerPage"
		if _, exists := req["page"]; !exists {
			req["page"] = float64(1)
		}
		delete(req, "limit")
		delete(req, "offset")
	}
	limit := float64(10)
	if v, ok := req[sizeField].(float64); ok {
		limit = v
	}
	req[sizeField] = math.Min(float64(p.MaxLimit), math.Max(1, limit))
	defaults := map[string]any{"attributesToHighlight": []string{"*"}, "attributesToCrop": []string{"content", "excerpt", "description"}, "cropLength": 40, "showMatchesPosition": true}
	for k, v := range defaults {
		if _, exists := req[k]; !exists {
			req[k] = v
		}
	}
	body, _ = json.Marshal(req)
	i.Secret = strings.TrimPrefix(auth, "Bearer ")
	response, status, e = upstream(r.Context(), i, "POST", "/indexes/"+index+"/search", bytes.NewReader(body))
	if e != nil {
		status = 502
		fail(w, status, "搜索服务连接失败")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(response)
}
func (s *Server) recordSearch(r *http.Request, id, index, source string, body, response []byte, status int, start time.Time) {
	req := map[string]any{}
	json.Unmarshal(body, &req)
	summary := map[string]any{}
	for _, k := range []string{"q", "limit", "offset", "page", "hitsPerPage", "filter", "sort", "facets"} {
		if v, ok := req[k]; ok {
			summary[k] = v
		}
	}
	query, _ := req["q"].(string)
	result := map[string]any{}
	json.Unmarshal(response, &result)
	hits, _ := result["hits"].([]any)
	item := map[string]any{"id": randomID(), "instanceId": id, "indexUid": index, "source": source, "query": trim(query, 1000), "ip": peerIP(r), "method": r.Method, "path": trim(r.URL.Path, 500), "origin": trim(r.Header.Get("Origin"), 500), "referer": trim(r.Referer(), 1000), "userAgent": trim(r.UserAgent(), 1000), "status": status, "durationMs": time.Since(start).Milliseconds(), "engineTimeMs": result["processingTimeMs"], "resultCount": len(hits), "requestBytes": len(body), "responseBytes": len(response), "request": summary, "createdAt": now()}
	b, _ := json.Marshal(item)
	s.store.db.Exec("INSERT INTO search_history VALUES(?,?,?,?,?,?,?,?,?)", item["id"], id, index, source, trim(query, 1000), peerIP(r), status, item["createdAt"], string(b))
	s.addMetric(id, source, status, len(hits), time.Since(start).Milliseconds())
	s.store.db.Exec("DELETE FROM search_history WHERE created_at<?", time.Now().AddDate(0, 0, -30).UTC().Format(time.RFC3339))
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	if offset < 0 {
		offset = 0
	}
	where := " WHERE (?='' OR instance_id=?) AND (?='' OR index_uid=?) AND (?='' OR query LIKE ?) AND (?='' OR source=?)"
	args := []any{q.Get("instance"), q.Get("instance"), q.Get("index"), q.Get("index"), q.Get("q"), "%" + q.Get("q") + "%", q.Get("source"), q.Get("source")}
	var total int
	s.store.db.QueryRow("SELECT count(*) FROM search_history"+where, args...).Scan(&total)
	rows, e := s.store.db.Query("SELECT payload FROM search_history"+where+" ORDER BY created_at DESC LIMIT 50 OFFSET ?", append(args, offset)...)
	if e != nil {
		fail(w, 500, "无法读取搜索历史")
		return
	}
	defer rows.Close()
	out := []any{}
	for rows.Next() {
		var raw string
		rows.Scan(&raw)
		var item any
		json.Unmarshal([]byte(raw), &item)
		out = append(out, item)
	}
	send(w, 200, map[string]any{"results": out, "total": total, "offset": offset, "limit": 50})
}
