package console

import (
	"bytes"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) profileSchema() error {
	_, e := s.store.db.Exec(`CREATE TABLE IF NOT EXISTS account_profiles(username TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', avatar BLOB, avatar_type TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`)
	return e
}
func (s *Server) accountInfo(user string) map[string]any {
	var name string
	var updated int64
	var has bool
	s.store.db.QueryRow("SELECT name,updated_at,avatar IS NOT NULL FROM account_profiles WHERE username=?", user).Scan(&name, &updated, &has)
	if name == "" {
		name = user
	}
	avatar := ""
	if has {
		avatar = "/api/account/avatar?v=" + time.Unix(0, updated).UTC().Format("20060102150405.000000000")
	}
	return map[string]any{"username": user, "name": name, "avatarUrl": avatar, "mode": s.cfg.Mode}
}
func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if len([]rune(req.Name)) < 1 || len([]rune(req.Name)) > 60 {
		fail(w, 400, "名称需为 1–60 个字符")
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	_, e := s.store.db.Exec("INSERT INTO account_profiles(username,name) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name", user, req.Name)
	if e != nil {
		fail(w, 500, "无法保存账户资料")
		return
	}
	s.store.Audit(user, "account.update", "console")
	send(w, 200, s.accountInfo(user))
}
func (s *Server) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, (5<<20)+(64<<10))
	if e := r.ParseMultipartForm(5 << 20); e != nil {
		fail(w, 400, "头像最多 5 MiB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	f, _, e := r.FormFile("avatar")
	if e != nil {
		fail(w, 400, "请选择头像图片")
		return
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, (5<<20)+1))
	if e != nil || len(b) > 5<<20 {
		fail(w, 400, "头像最多 5 MiB")
		return
	}
	config, format, e := image.DecodeConfig(bytes.NewReader(b))
	if e != nil || config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 {
		fail(w, 400, "请上传有效 JPG、PNG 或 GIF，分辨率不超过 4096 × 4096")
		return
	}
	if _, _, e = image.Decode(bytes.NewReader(b)); e != nil {
		fail(w, 400, "图片文件已损坏")
		return
	}
	mime := map[string]string{"jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif"}[format]
	if mime == "" {
		fail(w, 400, "不支持此图片类型")
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	_, e = s.store.db.Exec("INSERT INTO account_profiles(username,avatar,avatar_type,updated_at) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET avatar=excluded.avatar,avatar_type=excluded.avatar_type,updated_at=excluded.updated_at", user, b, mime, time.Now().UnixNano())
	if e != nil {
		fail(w, 500, "无法保存头像")
		return
	}
	s.store.Audit(user, "account.avatar", "console")
	send(w, 200, s.accountInfo(user))
}
func (s *Server) avatar(w http.ResponseWriter, r *http.Request) {
	var b []byte
	var mime string
	e := s.store.db.QueryRow("SELECT avatar,avatar_type FROM account_profiles WHERE username=?", r.Context().Value(actorKey{})).Scan(&b, &mime)
	if e != nil || len(b) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Write(b)
}
