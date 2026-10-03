package console

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"golang.org/x/crypto/bcrypt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) securitySchema() error {
	_, e := s.store.db.Exec(`
 CREATE TABLE IF NOT EXISTS session_details(token_hash TEXT PRIMARY KEY, ip TEXT NOT NULL, user_agent TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, verified_at INTEGER NOT NULL, method TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS security(username TEXT PRIMARY KEY, totp_secret BLOB, enabled INTEGER NOT NULL DEFAULT 0, pending_secret BLOB, pending_expires INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT -1, recovery_hashes TEXT NOT NULL DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY, username TEXT NOT NULL, rp_id TEXT NOT NULL, name TEXT NOT NULL, credential TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
 CREATE TABLE IF NOT EXISTS passkey_challenges(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, auth_session TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
 `)
	return e
}
func peerIP(r *http.Request) string {
	ip, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return ip
}
func (s *Server) createSession(w http.ResponseWriter, r *http.Request, user, method string) error {
	token := randomID() + randomID()
	digest := hashToken(token)
	t := time.Now().Unix()
	tx, e := s.store.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// Rotate an existing session rather than keeping an old authenticated token alive.
	if old, e := r.Cookie("onesearch_session"); e == nil {
		tx.Exec("DELETE FROM session_details WHERE token_hash=?", hashToken(old.Value))
		tx.Exec("DELETE FROM sessions WHERE token_hash=?", hashToken(old.Value))
	}
	if _, e = tx.Exec("INSERT INTO sessions VALUES(?,?,?)", digest, user, t+86400); e != nil {
		return e
	}
	if _, e = tx.Exec("INSERT INTO session_details VALUES(?,?,?,?,?,?,?)", digest, peerIP(r), trim(r.UserAgent(), 1000), t, t, t, method); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	http.SetCookie(w, &http.Cookie{Name: "onesearch_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 86400})
	s.store.Audit(user, "login."+method, "console")
	return nil
}
func trim(v string, n int) string {
	r := []rune(v)
	if len(r) > n {
		return string(r[:n])
	}
	return v
}
func (s *Server) requireRecent(w http.ResponseWriter, r *http.Request) bool {
	c, e := r.Cookie("onesearch_session")
	if e != nil {
		fail(w, 401, "请先登录")
		return false
	}
	var at int64
	if e = s.store.db.QueryRow("SELECT verified_at FROM session_details WHERE token_hash=?", hashToken(c.Value)).Scan(&at); e != nil || time.Now().Unix()-at > 300 {
		fail(w, 403, "请重新验证身份后继续此操作")
		return false
	}
	return true
}
func (s *Server) sessions(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(actorKey{}).(string)
	current, _ := r.Cookie("onesearch_session")
	currentHash := ""
	if current != nil {
		currentHash = hashToken(current.Value)
	}
	rows, e := s.store.db.Query("SELECT s.token_hash,d.ip,d.user_agent,d.created_at,d.last_seen,s.expires_at,d.method FROM sessions s JOIN session_details d ON s.token_hash=d.token_hash WHERE s.username=? AND s.expires_at>? ORDER BY d.created_at DESC", user, time.Now().Unix())
	if e != nil {
		fail(w, 500, "无法读取会话")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, ip, ua, method string
		var created, last, expires int64
		if e = rows.Scan(&id, &ip, &ua, &created, &last, &expires, &method); e != nil {
			fail(w, 500, "无法读取会话")
			return
		}
		out = append(out, map[string]any{"id": id, "ip": ip, "userAgent": ua, "createdAt": time.Unix(created, 0).UTC().Format(time.RFC3339), "lastSeen": time.Unix(last, 0).UTC().Format(time.RFC3339), "expiresAt": time.Unix(expires, 0).UTC().Format(time.RFC3339), "current": id == currentHash, "method": method})
	}
	send(w, 200, out)
}
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("session")
	user := r.Context().Value(actorKey{}).(string)
	if id == "others" {
		c, _ := r.Cookie("onesearch_session")
		_, e := s.store.db.Exec("DELETE FROM sessions WHERE username=? AND token_hash!=?", user, hashToken(c.Value))
		if e != nil {
			fail(w, 500, "无法撤销会话")
			return
		}
	} else {
		_, e := s.store.db.Exec("DELETE FROM sessions WHERE username=? AND token_hash=?", user, id)
		if e != nil {
			fail(w, 500, "无法撤销会话")
			return
		}
	}
	s.store.Audit(user, "session.revoke", id)
	send(w, 200, map[string]bool{"ok": true})
}
func totp(secret string, step int64) string {
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if e != nil {
		return ""
	}
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(b)
	hash := mac.Sum(nil)
	offset := hash[len(hash)-1] & 15
	value := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000)
}
func matchTOTP(secret, code string, at time.Time) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	step := at.Unix() / 30
	for d := int64(-1); d <= 1; d++ {
		candidate := step + d
		if subtle.ConstantTimeCompare([]byte(totp(secret, candidate)), []byte(code)) == 1 {
			return candidate, true
		}
	}
	return 0, false
}
func (s *Server) verifySecondFactor(user, code string) bool {
	var encrypted []byte
	var enabled int
	var last int64
	var recovery string
	e := s.store.db.QueryRow("SELECT totp_secret,enabled,last_step,recovery_hashes FROM security WHERE username=?", user).Scan(&encrypted, &enabled, &last, &recovery)
	if e != nil {
		return errors.Is(e, sqlNoRows())
	}
	if enabled == 0 {
		return true
	}
	secret, e := s.store.unseal(encrypted)
	if e != nil {
		return false
	}
	step, ok := matchTOTP(secret, code, time.Now())
	if ok {
		res, e := s.store.db.Exec("UPDATE security SET last_step=? WHERE username=? AND last_step<?", step, user, step)
		if e != nil {
			return false
		}
		n, _ := res.RowsAffected()
		return n == 1
	}
	hashes := []string{}
	if json.Unmarshal([]byte(recovery), &hashes) != nil {
		return false
	}
	digest := hashToken(strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(code)), "-", ""))
	for n, h := range hashes {
		if subtle.ConstantTimeCompare([]byte(h), []byte(digest)) == 1 {
			updated := append(append([]string{}, hashes[:n]...), hashes[n+1:]...)
			b, _ := json.Marshal(updated)
			res, e := s.store.db.Exec("UPDATE security SET recovery_hashes=? WHERE username=? AND recovery_hashes=?", string(b), user, recovery)
			if e != nil {
				return false
			}
			count, _ := res.RowsAffected()
			return count == 1
		}
	}
	return false
}
func (s *Server) reauth(w http.ResponseWriter, r *http.Request) {
	if !s.allowAttempt("reauth:"+peerIP(r), 10) {
		fail(w, 429, "验证次数过多，请一分钟后再试")
		return
	}
	var req struct {
		Password string `json:"password"`
		OTP      string `json:"otp"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	var h []byte
	e := s.store.db.QueryRow("SELECT password_hash FROM users WHERE username=?", user).Scan(&h)
	if e != nil || bcrypt.CompareHashAndPassword(h, []byte(req.Password)) != nil {
		fail(w, 401, "当前密码不正确")
		return
	}
	if !s.verifySecondFactor(user, req.OTP) {
		fail(w, 401, "验证码或恢复码不正确")
		return
	}
	c, _ := r.Cookie("onesearch_session")
	s.store.db.Exec("UPDATE session_details SET verified_at=? WHERE token_hash=?", time.Now().Unix(), hashToken(c.Value))
	send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) securityStatus(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(actorKey{}).(string)
	var enabled, count int
	var rec string
	s.store.db.QueryRow("SELECT enabled,recovery_hashes FROM security WHERE username=?", user).Scan(&enabled, &rec)
	s.store.db.QueryRow("SELECT count(*) FROM passkeys WHERE username=?", user).Scan(&count)
	var hashes []string
	json.Unmarshal([]byte(rec), &hashes)
	var verifiedAt int64
	if c, e := r.Cookie("onesearch_session"); e == nil {
		s.store.db.QueryRow("SELECT verified_at FROM session_details WHERE token_hash=?", hashToken(c.Value)).Scan(&verifiedAt)
	}
	send(w, 200, map[string]any{"verifiedUntil": (verifiedAt + 300) * 1000, "totpEnabled": enabled == 1, "passkeyCount": count, "recoveryRemaining": len(hashes), "rpOrigin": s.cfg.Origin})
}
func (s *Server) beginTOTP(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	var enabled int
	s.store.db.QueryRow("SELECT enabled FROM security WHERE username=?", user).Scan(&enabled)
	if enabled == 1 {
		fail(w, 409, "双因素认证已开启")
		return
	}
	b := make([]byte, 20)
	rand.Read(b)
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
	_, e := s.store.db.Exec("INSERT INTO security(username,pending_secret,pending_expires) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET pending_secret=excluded.pending_secret,pending_expires=excluded.pending_expires", user, s.store.seal(secret), time.Now().Add(5*time.Minute).Unix())
	if e != nil {
		fail(w, 500, "无法创建验证器配置")
		return
	}
	u := url.URL{Scheme: "otpauth", Host: "totp", Path: "/OneSearch:" + user}
	q := url.Values{"secret": {secret}, "issuer": {"OneSearch"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	u.RawQuery = q.Encode()
	send(w, 200, map[string]string{"secret": secret, "uri": u.String()})
}
func (s *Server) confirmTOTP(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	var encrypted []byte
	var expires int64
	if e := s.store.db.QueryRow("SELECT pending_secret,pending_expires FROM security WHERE username=? AND enabled=0", user).Scan(&encrypted, &expires); e != nil || expires < time.Now().Unix() {
		fail(w, 400, "设置已过期，请重新开始")
		return
	}
	secret, e := s.store.unseal(encrypted)
	if e != nil {
		fail(w, 500, "无法读取配置")
		return
	}
	step, ok := matchTOTP(secret, req.Code, time.Now())
	if !ok {
		fail(w, 400, "验证码不正确")
		return
	}
	codes := []string{}
	hashes := []string{}
	for n := 0; n < 8; n++ {
		b := make([]byte, 8)
		rand.Read(b)
		raw := strings.ToUpper(hexBytes(b))
		codes = append(codes, raw[:8]+"-"+raw[8:])
		hashes = append(hashes, hashToken(raw))
	}
	encoded, _ := json.Marshal(hashes)
	res, e := s.store.db.Exec("UPDATE security SET totp_secret=pending_secret,enabled=1,pending_secret=NULL,pending_expires=0,last_step=?,recovery_hashes=? WHERE username=? AND enabled=0 AND pending_expires=?", step, string(encoded), user, expires)
	if e != nil {
		fail(w, 500, "无法启用双因素认证")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		fail(w, 409, "设置已变更，请重试")
		return
	}
	c, _ := r.Cookie("onesearch_session")
	s.store.db.Exec("DELETE FROM sessions WHERE username=? AND token_hash!=?", user, hashToken(c.Value))
	s.store.Audit(user, "totp.enable", "account")
	send(w, 200, map[string]any{"recoveryCodes": codes})
}
func hexBytes(b []byte) string { return fmt.Sprintf("%x", b) }
func (s *Server) disableTOTP(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	if !s.verifySecondFactor(user, req.Code) {
		fail(w, 401, "验证码不正确或已使用")
		return
	}
	_, e := s.store.db.Exec("UPDATE security SET enabled=0,totp_secret=NULL,pending_secret=NULL,recovery_hashes='[]',last_step=-1 WHERE username=?", user)
	if e != nil {
		fail(w, 500, "无法关闭双因素认证")
		return
	}
	s.store.Audit(user, "totp.disable", "account")
	send(w, 200, map[string]bool{"ok": true})
}

type passkeyUser struct {
	Name        string
	Credentials []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte                         { return []byte(u.Name) }
func (u passkeyUser) WebAuthnName() string                       { return u.Name }
func (u passkeyUser) WebAuthnDisplayName() string                { return u.Name }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }
func (s *Server) rp() (*webauthn.WebAuthn, error) {
	u, e := url.Parse(s.cfg.Origin)
	if e != nil {
		return nil, e
	}
	return webauthn.New(&webauthn.Config{RPDisplayName: "OneSearch", RPID: u.Hostname(), RPOrigins: []string{s.cfg.Origin}, AttestationPreference: protocol.PreferNoAttestation, AuthenticatorSelection: protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired}, Timeouts: webauthn.TimeoutsConfig{Login: webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute}, Registration: webauthn.TimeoutConfig{Enforce: true, Timeout: 5 * time.Minute}}})
}
func (s *Server) passkeyUser(name string) (passkeyUser, error) {
	u := passkeyUser{Name: name, Credentials: []webauthn.Credential{}}
	origin, _ := url.Parse(s.cfg.Origin)
	rows, e := s.store.db.Query("SELECT credential FROM passkeys WHERE username=? AND rp_id=?", name, origin.Hostname())
	if e != nil {
		return u, e
	}
	defer rows.Close()
	for rows.Next() {
		var p string
		rows.Scan(&p)
		var c webauthn.Credential
		if e = json.Unmarshal([]byte(p), &c); e != nil {
			return u, e
		}
		u.Credentials = append(u.Credentials, c)
	}
	return u, rows.Err()
}
func (s *Server) saveChallenge(w http.ResponseWriter, r *http.Request, kind, user, name string, session *webauthn.SessionData) error {
	token := randomID() + randomID()
	p, e := json.Marshal(session)
	if e != nil {
		return e
	}
	auth := ""
	if c, e := r.Cookie("onesearch_session"); e == nil {
		auth = hashToken(c.Value)
	}
	s.store.db.Exec("DELETE FROM passkey_challenges WHERE expires_at<=?", time.Now().Unix())
	_, e = s.store.db.Exec("INSERT INTO passkey_challenges VALUES(?,?,?,?,?,?,?)", hashToken(token), user, kind, name, auth, string(p), time.Now().Add(5*time.Minute).Unix())
	if e != nil {
		return e
	}
	http.SetCookie(w, &http.Cookie{Name: "onesearch_challenge", Value: token, Path: "/api", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 300})
	return nil
}

type challenge struct {
	user, name, auth string
	session          webauthn.SessionData
}

func (s *Server) consumeChallenge(w http.ResponseWriter, r *http.Request, kind string) (challenge, error) {
	var c challenge
	cookie, e := r.Cookie("onesearch_challenge")
	if e != nil {
		return c, errors.New("验证已过期")
	}
	var payload, storedKind string
	var expires int64
	e = s.store.db.QueryRow("DELETE FROM passkey_challenges WHERE token_hash=? RETURNING username,kind,name,auth_session,payload,expires_at", hashToken(cookie.Value)).Scan(&c.user, &storedKind, &c.name, &c.auth, &payload, &expires)
	http.SetCookie(w, &http.Cookie{Name: "onesearch_challenge", Value: "", Path: "/api", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	if e != nil || storedKind != kind || expires < time.Now().Unix() {
		return c, errors.New("验证已过期或已经使用")
	}
	e = json.Unmarshal([]byte(payload), &c.session)
	return c, e
}
func (s *Server) listPasskeys(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(actorKey{}).(string)
	rows, e := s.store.db.Query("SELECT id,name,rp_id,created_at,COALESCE(last_used_at,'') FROM passkeys WHERE username=?", user)
	if e != nil {
		fail(w, 500, "无法读取通行密钥")
		return
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, name, rp, created, last string
		rows.Scan(&id, &name, &rp, &created, &last)
		out = append(out, map[string]string{"id": id, "name": name, "rpID": rp, "createdAt": created, "lastUsedAt": last})
	}
	send(w, 200, out)
}
func (s *Server) registerPasskeyBegin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" || len(req.Name) > 100 {
		fail(w, 400, "请填写密钥名称（最多 100 字节）")
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	u, e := s.passkeyUser(user)
	if e != nil {
		fail(w, 500, "无法读取账户")
		return
	}
	rp, e := s.rp()
	if e != nil {
		fail(w, 500, "通行密钥站点配置无效")
		return
	}
	opts, session, e := rp.BeginRegistration(u, webauthn.WithExclusions(webauthn.Credentials(u.Credentials).CredentialDescriptors()))
	if e != nil {
		fail(w, 500, "无法开始注册")
		return
	}
	if e = s.saveChallenge(w, r, "register", user, req.Name, session); e != nil {
		fail(w, 500, "无法保存验证请求")
		return
	}
	send(w, 200, opts)
}
func (s *Server) registerPasskeyFinish(w http.ResponseWriter, r *http.Request) {
	c, e := s.consumeChallenge(w, r, "register")
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	auth, _ := r.Cookie("onesearch_session")
	user := r.Context().Value(actorKey{}).(string)
	if c.user != user || auth == nil || c.auth != hashToken(auth.Value) {
		fail(w, 403, "验证与当前会话不匹配")
		return
	}
	u, e := s.passkeyUser(user)
	if e != nil {
		fail(w, 500, "无法读取账户")
		return
	}
	rp, e := s.rp()
	if e != nil {
		fail(w, 500, "通行密钥配置无效")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	cred, e := rp.FinishRegistration(u, c.session, r)
	if e != nil {
		fail(w, 400, "通行密钥验证未通过，请使用当前站点重新注册")
		return
	}
	encoded, _ := json.Marshal(cred)
	origin, _ := url.Parse(s.cfg.Origin)
	id := base64.RawURLEncoding.EncodeToString(cred.ID)
	_, e = s.store.db.Exec("INSERT INTO passkeys(id,username,rp_id,name,credential,created_at) VALUES(?,?,?,?,?,?)", id, user, origin.Hostname(), c.name, string(encoded), now())
	if e != nil {
		fail(w, 409, "该通行密钥已注册")
		return
	}
	s.store.Audit(user, "passkey.register", id)
	send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) passkeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	u, e := s.passkeyUser(req.Username)
	if e != nil || len(u.Credentials) == 0 {
		fail(w, 400, "此账户没有可用的通行密钥")
		return
	}
	rp, e := s.rp()
	if e != nil {
		fail(w, 500, "通行密钥配置无效")
		return
	}
	opts, session, e := rp.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationRequired))
	if e != nil {
		fail(w, 400, "无法开始通行密钥验证")
		return
	}
	if e = s.saveChallenge(w, r, "login", req.Username, "", session); e != nil {
		fail(w, 500, "无法保存验证请求")
		return
	}
	send(w, 200, opts)
}
func (s *Server) passkeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	c, e := s.consumeChallenge(w, r, "login")
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	u, e := s.passkeyUser(c.user)
	if e != nil {
		fail(w, 500, "无法读取账户")
		return
	}
	rp, e := s.rp()
	if e != nil {
		fail(w, 500, "通行密钥配置无效")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	cred, e := rp.FinishLogin(u, c.session, r)
	if e != nil || cred.Authenticator.CloneWarning {
		fail(w, 401, "通行密钥验证未通过")
		return
	}
	p, _ := json.Marshal(cred)
	_, e = s.store.db.Exec("UPDATE passkeys SET credential=?,last_used_at=? WHERE id=? AND username=?", string(p), now(), base64.RawURLEncoding.EncodeToString(cred.ID), c.user)
	if e != nil {
		fail(w, 500, "无法更新通行密钥")
		return
	}
	if e = s.createSession(w, r, c.user, "passkey"); e != nil {
		fail(w, 500, "无法创建会话")
		return
	}
	send(w, 200, map[string]string{"username": c.user})
}
func (s *Server) deletePasskey(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	user := r.Context().Value(actorKey{}).(string)
	_, e := s.store.db.Exec("DELETE FROM passkeys WHERE id=? AND username=?", r.PathValue("key"), user)
	if e != nil {
		fail(w, 500, "无法移除通行密钥")
		return
	}
	s.store.Audit(user, "passkey.remove", r.PathValue("key"))
	send(w, 200, map[string]bool{"ok": true})
}

func sqlNoRows() error { return sql.ErrNoRows }
