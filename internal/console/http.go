package console

import (
	"context"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type clientIPKey struct{}

func (s *Server) trusted(ip string) bool {
	address := net.ParseIP(ip)
	if address == nil {
		return false
	}
	for _, cidr := range s.cfg.TrustedProxies {
		_, network, e := net.ParseCIDR(cidr)
		if e == nil && network.Contains(address) {
			return true
		}
	}
	return false
}

// Walk from the actual peer through trusted hops only. Client-supplied entries
// on the left of the first untrusted address cannot forge history or rate limits.
func (s *Server) withClientIP(r *http.Request) *http.Request {
	ip := peerIP(r)
	if !s.trusted(ip) {
		return r
	}
	forwarded := r.Header.Get("X-Forwarded-For")
	if len(forwarded) > 4096 {
		return r
	}
	if forwarded == "" {
		forwarded = r.Header.Get("X-Real-IP")
	}
	hops := strings.Split(forwarded, ",")
	for n := len(hops) - 1; n >= 0 && s.trusted(ip); n-- {
		candidate := strings.TrimSpace(hops[n])
		if net.ParseIP(candidate) == nil {
			return r
		}
		ip = candidate
	}
	return r.WithContext(context.WithValue(r.Context(), clientIPKey{}, ip))
}

func spaHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.NotFound(w, r)
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(clean, "/api") || strings.Contains(clean, "/.") {
			http.NotFound(w, r)
			return
		}
		if info, e := os.Stat(filepath.Join(dir, filepath.FromSlash(clean))); e == nil && !info.IsDir() {
			if strings.HasPrefix(clean, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(clean, "/assets/") || path.Ext(clean) != "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
