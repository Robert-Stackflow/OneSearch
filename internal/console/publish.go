package console

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type gatewayWriter struct {
	http.ResponseWriter
	status int
}

func (w *gatewayWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }

// Gateway keys name literal indexes; engine/admin keys are not website keys.
func (s *Server) gatewayCredential(w http.ResponseWriter, r *http.Request, index, action string, searchOnly bool) (Instance, string, bool) {
	var empty Instance
	auth := r.Header.Get("Authorization")
	token := strings.TrimPrefix(auth, "Bearer ")
	if !strings.HasPrefix(auth, "Bearer ") || len(token) < 8 || len(token) > 512 {
		fail(w, 401, "请提供索引专属访问密钥")
		return empty, "", false
	}
	i, e := s.store.GetInstance(r.PathValue("id"))
	if e != nil || i.Status != "running" {
		fail(w, 503, "搜索实例暂不可用")
		return empty, "", false
	}
	if subtle.ConstantTimeCompare([]byte(token), []byte(i.Secret)) == 1 {
		fail(w, 403, "公开入口不接受实例主密钥")
		return empty, "", false
	}
	body, status, e := upstream(r.Context(), i, "GET", "/keys/"+url.PathEscape(token), nil)
	if e != nil {
		fail(w, 502, "无法验证访问密钥")
		return empty, "", false
	}
	if status != 200 {
		fail(w, 401, "访问密钥无效或已撤销")
		return empty, "", false
	}
	var grant struct {
		Key, UID         string
		Actions, Indexes []string
		ExpiresAt        *time.Time
	}
	if json.Unmarshal(body, &grant) != nil || subtle.ConstantTimeCompare([]byte(grant.Key), []byte(token)) != 1 || (grant.ExpiresAt != nil && !grant.ExpiresAt.After(time.Now())) {
		fail(w, 401, "访问密钥无效或已过期")
		return empty, "", false
	}
	scoped, permitted := false, false
	for _, name := range grant.Indexes {
		if !uidPattern.MatchString(name) {
			fail(w, 403, "密钥必须绑定明确的索引，不能使用通配符")
			return empty, "", false
		}
		if name == index {
			scoped = true
		}
	}
	if r.PathValue("app") != "" && (len(grant.Indexes) != 1 || grant.Indexes[0] != index) {
		fail(w, 403, "App Key 必须只绑定该应用的索引")
		return empty, "", false
	}
	safe := map[string]bool{"search": true, "documents.get": true, "documents.add": true, "documents.delete": true, "indexes.get": true, "settings.get": true, "settings.update": true, "tasks.get": true, "stats.get": true, "chatCompletions": true}
	for _, a := range grant.Actions {
		if (searchOnly && r.PathValue("app") == "" && a != "search") || !safe[a] || (action == "chatCompletions" && a != "search" && a != "chatCompletions") {
			fail(w, 403, "密钥包含不适用于此入口的权限")
			return empty, "", false
		}
		if a == action {
			permitted = true
		}
	}
	if !scoped || !permitted {
		fail(w, 403, "访问密钥不允许此索引或操作")
		return empty, "", false
	}
	i.Secret = token
	return i, grant.UID, true
}

func (s *Server) publish(w http.ResponseWriter, r *http.Request) {
	id, index := r.PathValue("id"), r.PathValue("index")
	if !engineIDPattern.MatchString(id) || !uidPattern.MatchString(index) {
		fail(w, 400, "实例或索引标识无效")
		return
	}
	// Server-to-server Bearer API; browser origins and cookie writes are rejected.
	if r.Header.Get("Origin") != "" {
		fail(w, 403, "发布入口仅接受服务器请求")
		return
	}
	if !s.allowAttempt("publish:"+peerIP(r), 300) {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "发布请求过于频繁")
		return
	}
	path := "/indexes/" + index + "/documents"
	action := "documents.get"
	var body []byte
	var e error
	if r.PathValue("task") != "" {
		action = "tasks.get"
	} else if r.Method == "POST" {
		action = "documents.add"
		if strings.HasSuffix(r.URL.Path, "/delete-batch") {
			action = "documents.delete"
		}
	}
	i, uid, ok := s.gatewayCredential(w, r, index, action, false)
	if !ok {
		return
	}
	switch {
	case r.PathValue("task") != "":
		task := r.PathValue("task")
		if _, e := strconv.ParseUint(task, 10, 32); e != nil {
			fail(w, 400, "任务标识无效")
			return
		}
		path = "/tasks/" + task
		action = "tasks.get"
	case r.Method == "GET":
		q := r.URL.Query()
		for k := range q {
			if k != "limit" && k != "offset" && k != "fields" {
				fail(w, 400, "不支持此文档查询参数")
				return
			}
		}
		limit, offset := 100, 0
		if v := q.Get("limit"); v != "" {
			limit, e = strconv.Atoi(v)
			if e != nil || limit < 1 || limit > 1000 {
				fail(w, 400, "limit 为 1–1000")
				return
			}
		}
		if v := q.Get("offset"); v != "" {
			offset, e = strconv.Atoi(v)
			if e != nil || offset < 0 || offset > 10000000 {
				fail(w, 400, "offset 无效")
				return
			}
		}
		if v := q.Get("fields"); v != "" && v != "id" && r.PathValue("app") == "" {
			fail(w, 400, "发布入口仅返回文档 id")
			return
		}
		query := url.Values{"limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}
		if r.PathValue("app") == "" {
			query.Set("fields", "id")
		} else if fields := q.Get("fields"); fields != "" {
			query.Set("fields", fields)
		}
		path += "?" + query.Encode()
	case r.Method == "POST":
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		body, e = io.ReadAll(r.Body)
		if e != nil {
			fail(w, 413, "发布请求不得超过 16 MiB")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/delete-batch") {
			action = "documents.delete"
			path += "/delete-batch"
			var ids []string
			if json.Unmarshal(body, &ids) != nil || len(ids) == 0 || len(ids) > 10000 {
				fail(w, 400, "请提供 1–10000 个文档 id")
				return
			}
			for _, v := range ids {
				if !uidPattern.MatchString(v) {
					fail(w, 400, "文档 id 无效")
					return
				}
			}
		} else {
			action = "documents.add"
			var docs []map[string]json.RawMessage
			if json.Unmarshal(body, &docs) != nil || len(docs) == 0 || len(docs) > 1000 {
				fail(w, 400, "请提供 1–1000 篇文档的 JSON 数组")
				return
			}
			seen := map[string]bool{}
			for _, doc := range docs {
				var v string
				if json.Unmarshal(doc["id"], &v) != nil || !uidPattern.MatchString(v) || seen[v] {
					fail(w, 400, "文档必须包含有效且不重复的字符串 id")
					return
				}
				seen[v] = true
			}
		}
	default:
		fail(w, 405, "不支持此发布方法")
		return
	}
	response, status, e := upstream(r.Context(), i, r.Method, path, bytes.NewReader(body))
	if e != nil {
		fail(w, 502, "发布服务连接失败")
		return
	}
	if status >= 400 {
		fail(w, status, "引擎拒绝发布请求，请检查索引主键、密钥权限和任务状态")
		return
	}
	if r.PathValue("task") != "" {
		var task struct {
			IndexUID string `json:"indexUid"`
		}
		if json.Unmarshal(response, &task) != nil || task.IndexUID != index {
			fail(w, 403, "任务不属于该索引")
			return
		}
	}
	if r.Method == "POST" {
		s.store.Audit("publisher:"+uid, "documents.publish", id+"/"+index)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(response)
}
