package console

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base32"
	"encoding/json"
	"github.com/go-webauthn/webauthn/webauthn"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	s, e := New(Config{DataDir: t.TempDir(), AdminPassword: "test-admin-password-long", Origin: "http://localhost:5178"})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	return s
}
func call(s *Server, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("X-OneSearch-Request", "1")
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func TestTOTPAndSessionRevocation(t *testing.T) {
	s := testServer(t)
	w := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	s.store.db.Exec("INSERT INTO security(username,totp_secret,enabled,recovery_hashes) VALUES(?,?,1,?)", "admin", s.store.seal(secret), `["`+hashToken("RECOVERYCODE12345")+`"]`)
	w = call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	if w.Code != 401 {
		t.Fatal("password bypassed second factor")
	}
	code := totp(secret, time.Now().Unix()/30)
	w = call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long","otp":"`+code+`"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	other := w.Result().Cookies()[0]
	w = call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long","otp":"`+code+`"}`)
	if w.Code != 401 {
		t.Fatal("TOTP was replayed")
	}
	if !s.verifySecondFactor("admin", "RECOVERY-CODE12345") || s.verifySecondFactor("admin", "RECOVERY-CODE12345") {
		t.Fatal("recovery code must work once")
	}
	w = call(s, "DELETE", "/api/sessions/others", "", cookie)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = call(s, "GET", "/api/auth/me", "", other)
	if w.Code != 401 {
		t.Fatal("revoked session remained valid")
	}
}
func TestTOTPReference(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	if got := totp(secret, 59/30); got != "287082" {
		t.Fatalf("RFC 6238 6-digit truncation: %s", got)
	}
}
func TestChallengeBindingAndConsumption(t *testing.T) {
	s := testServer(t)
	r := httptest.NewRequest("POST", "/api/passkeys/begin", nil)
	r.AddCookie(&http.Cookie{Name: "onesearch_session", Value: "original-session"})
	w := httptest.NewRecorder()
	if e := s.saveChallenge(w, r, "register", "admin", "test", &webauthn.SessionData{Challenge: "challenge", Expires: time.Now().Add(time.Minute)}); e != nil {
		t.Fatal(e)
	}
	r2 := httptest.NewRequest("POST", "/api/passkeys/finish", nil)
	r2.AddCookie(w.Result().Cookies()[0])
	c, e := s.consumeChallenge(httptest.NewRecorder(), r2, "register")
	if e != nil || c.auth != hashToken("original-session") {
		t.Fatal("challenge not bound")
	}
	if _, e = s.consumeChallenge(httptest.NewRecorder(), r2, "register"); e == nil {
		t.Fatal("challenge replay")
	}
	if _, e = s.rp(); e != nil {
		t.Fatal(e)
	}
}
func TestPublicSearchAndHistory(t *testing.T) {
	s := testServer(t)
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer scoped-search-key" {
			w.WriteHeader(401)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["limit"] != float64(3) {
			t.Error("result limit not enforced")
		}
		w.Write([]byte(`{"hits":[{"id":"a"}],"processingTimeMs":2}`))
	}))
	defer engine.Close()
	s.store.SaveInstance(Instance{ID: "test", Host: engine.URL, Secret: "master-secret", Status: "running", CreatedAt: now()})
	p := SitePolicy{Enabled: true, Origins: []string{"https://blog.example.com"}, RequireOrigin: true, Rate: 2, MaxLimit: 3}
	b, _ := json.Marshal(p)
	s.store.db.Exec("INSERT INTO site_policies VALUES(?,?,?)", "test", "blog", string(b))
	request := func(origin, key string) int {
		r := httptest.NewRequest("POST", "/api/search/test/blog", bytes.NewBufferString(`{"q":"test","limit":100}`))
		r.RemoteAddr = "192.0.2.10:1234"
		r.Header.Set("Origin", origin)
		r.Header.Set("Authorization", "Bearer "+key)
		r.Header.Set("X-Forwarded-For", "203.0.113.99")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w.Code
	}
	if request("https://evil.example.com", "scoped-search-key") != 403 {
		t.Fatal("origin bypass")
	}
	if request("https://blog.example.com", "scoped-search-key") != 200 {
		t.Fatal("allowed search rejected")
	}
	if request("https://blog.example.com", "master-secret") != 403 {
		t.Fatal("master key accepted")
	}
	if request("https://blog.example.com", "scoped-search-key") != 429 {
		t.Fatal("rate limit bypass")
	}
	var ip string
	s.store.db.QueryRow("SELECT ip FROM search_history LIMIT 1").Scan(&ip)
	if ip != "192.0.2.10" {
		t.Fatal("untrusted forwarded IP used")
	}
	var n int
	s.store.db.QueryRow("SELECT count(*) FROM search_history").Scan(&n)
	if n != 4 {
		t.Fatal("blocked traffic not recorded")
	}
}
func TestEncryptedBackupRoundtrip(t *testing.T) {
	s := testServer(t)
	s.store.db.Exec("INSERT INTO sessions VALUES('test','admin',9999999999)")
	data, e := s.platformArchive()
	if e != nil {
		t.Fatal(e)
	}
	password := "a-strong-backup-password"
	encrypted, e := encryptArchive(data, password)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = DecryptArchive(encrypted, "wrong-password"); e == nil {
		t.Fatal("incorrect password accepted")
	}
	damaged := append([]byte{}, encrypted...)
	damaged[len(damaged)-1] ^= 1
	if _, e = DecryptArchive(damaged, password); e == nil {
		t.Fatal("tampered archive accepted")
	}
	dir := filepath.Join(t.TempDir(), "restored")
	if e = ExtractBackup(encrypted, password, dir); e != nil {
		t.Fatal(e)
	}
	key, e := os.ReadFile(filepath.Join(dir, "encryption.key"))
	if e != nil || len(key) != 32 {
		t.Fatal("encryption key missing")
	}
	db, e := OpenStore(dir, "")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var n int
	db.db.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 0 {
		t.Fatal("backup contains sessions")
	}
	var buffer bytes.Buffer
	z := zip.NewWriter(&buffer)
	f, _ := z.Create("../evil")
	f.Write([]byte("bad"))
	z.Close()
	bad, _ := encryptArchive(buffer.Bytes(), password)
	if ExtractBackup(bad, password, t.TempDir()) == nil {
		t.Fatal("ZIP traversal accepted")
	}
}
func TestCSRFAndEngineWhitelist(t *testing.T) {
	s := testServer(t)
	r := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(`{}`))
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("missing CSRF marker accepted")
	}
	if allowedEnginePath("POST", "dumps") || allowedEnginePath("GET", "indexes/../keys") {
		t.Fatal("unsafe engine route exposed")
	}
	if _, e := engineVersion(context.Background(), Instance{Host: "http://127.0.0.1:1"}); e == nil {
		t.Fatal("unreachable engine considered healthy")
	}
}

func TestPasswordChangeRotatesSessions(t *testing.T) {
	s := testServer(t)
	w := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	first := w.Result().Cookies()[0]
	w = call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	second := w.Result().Cookies()[0]
	w = call(s, "POST", "/api/account/password", `{"currentPassword":"wrong","newPassword":"another-long-test-password"}`, first)
	if w.Code != 401 {
		t.Fatal("wrong password accepted")
	}
	w = call(s, "POST", "/api/account/password", `{"currentPassword":"test-admin-password-long","newPassword":"another-long-test-password"}`, first)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	current := w.Result().Cookies()[0]
	for _, c := range []*http.Cookie{first, second} {
		if call(s, "GET", "/api/auth/me", "", c).Code != 401 {
			t.Fatal("old session valid after password change")
		}
	}
	if call(s, "GET", "/api/auth/me", "", current).Code != 200 {
		t.Fatal("rotated session invalid")
	}
	if call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`).Code != 401 {
		t.Fatal("old password accepted")
	}
	if call(s, "POST", "/api/auth/login", `{"username":"admin","password":"another-long-test-password"}`).Code != 200 {
		t.Fatal("new password rejected")
	}
}
