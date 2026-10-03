package console

import (
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(actorKey{}).(string)
	if !s.allowAttempt("password-change:"+user+":"+peerIP(r), 10) {
		fail(w, 429, "验证次数过多，请一分钟后再试")
		return
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
		OTP             string `json:"otp"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if len(req.NewPassword) < 12 || len(req.NewPassword) > 72 {
		fail(w, 400, "新密码长度为 12–72 字节")
		return
	}
	if req.NewPassword == req.CurrentPassword {
		fail(w, 400, "新密码不能与当前密码相同")
		return
	}
	var old []byte
	if e := s.store.db.QueryRow("SELECT password_hash FROM users WHERE username=?", user).Scan(&old); e != nil || bcrypt.CompareHashAndPassword(old, []byte(req.CurrentPassword)) != nil || !s.verifySecondFactor(user, req.OTP) {
		fail(w, 401, "当前密码或双因素验证码不正确")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if e != nil {
		fail(w, 500, "无法更新密码")
		return
	}
	tx, e := s.store.db.Begin()
	if e != nil {
		fail(w, 500, "无法更新密码")
		return
	}
	defer tx.Rollback()
	res, e := tx.Exec("UPDATE users SET password_hash=? WHERE username=? AND password_hash=?", hash, user, old)
	if e != nil {
		fail(w, 500, "无法更新密码")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		fail(w, 409, "密码已变更，请重新登录")
		return
	}
	if _, e = tx.Exec("DELETE FROM sessions WHERE username=?", user); e != nil {
		fail(w, 500, "无法撤销会话")
		return
	}
	if _, e = tx.Exec("DELETE FROM passkey_challenges WHERE username=?", user); e != nil {
		fail(w, 500, "无法撤销验证请求")
		return
	}
	if e = tx.Commit(); e != nil {
		fail(w, 500, "无法保存密码")
		return
	}
	if e = s.createSession(w, r, user, "password"); e != nil {
		fail(w, 500, "密码已更新，请重新登录")
		return
	}
	os.Remove(filepath.Join(s.cfg.DataDir, "dev-login.txt"))
	s.store.Audit(user, "password.change", "account")
	send(w, 200, map[string]bool{"ok": true})
}
