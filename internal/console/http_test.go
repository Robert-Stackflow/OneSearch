package console

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestTrustedProxyClientIP(t *testing.T) {
	s := &Server{cfg: Config{TrustedProxies: []string{"10.213.13.1/32"}}}
	for _, test := range []struct{ peer, forward, want string }{
		{"192.0.2.1:1234", "203.0.113.99", "192.0.2.1"},
		{"10.213.13.1:1234", "203.0.113.99, 192.0.2.1", "192.0.2.1"},
		{"10.213.13.1:1234", "203.0.113.99, 10.213.13.1", "203.0.113.99"},
		{"10.213.13.1:1234", "invalid", "10.213.13.1"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = test.peer
		r.Header.Set("X-Forwarded-For", test.forward)
		if got := peerIP(s.withClientIP(r)); got != test.want {
			t.Fatalf("got %s want %s", got, test.want)
		}
	}
}
func TestProductionCookieAndSPARoutes(t *testing.T) {
	s := testServer(t)
	s.cfg.Mode = "production"
	r := httptest.NewRequest("POST", "/api/auth/login", nil)
	w := httptest.NewRecorder()
	if e := s.createSession(w, r, "admin", "password"); e != nil {
		t.Fatal(e)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("production session cookie is not hardened")
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("frontend"), 0600)
	h := spaHandler(dir)
	for _, test := range []struct {
		path   string
		status int
	}{{"/account/security", 200}, {"/assets/missing.js", 404}, {"/.env", 404}, {"/api/not-found", 404}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", test.path, nil))
		if w.Code != test.status {
			t.Fatalf("%s: %d", test.path, w.Code)
		}
	}
}
