package console

import (
	"net/http/httptest"
	"testing"
)

func TestNormalizedOriginMatchesBrowserAndRejectsPaths(t *testing.T) {
	for _, tt := range []struct{ input, want string }{
		{"https://gh.blog.cloudchewie.com/", "https://gh.blog.cloudchewie.com"},
		{" https://BLOG.example.com:443/ ", "https://blog.example.com"},
		{"http://localhost:5178/", "http://localhost:5178"},
		{"http://localhost:80", "http://localhost"},
		{"https://[::1]:443/", "https://[::1]"},
	} {
		got, ok := normalizeOrigin(tt.input)
		if !ok || got != tt.want {
			t.Fatalf("normalize %q = %q,%v", tt.input, got, ok)
		}
		r := httptest.NewRequest("POST", "/", nil)
		r.Header.Set("Origin", tt.want)
		if !originAllowed(SitePolicy{Origins: []string{got}, RequireOrigin: true}, r) {
			t.Fatal("canonical browser origin rejected")
		}
		r.Header.Set("Origin", "https://evil.example.com")
		if originAllowed(SitePolicy{Origins: []string{got}}, r) {
			t.Fatal("different origin accepted")
		}
	}
	for _, value := range []string{"https://example.com/posts/", "https://example.com/?q=x", "https://example.com/?", "https://example.com/#", "https://example.com/%2f", "https://user@example.com", "https://example.com:65536", "https://example.com:", "javascript:alert(1)", "//example.com", "null"} {
		if _, ok := normalizeOrigin(value); ok {
			t.Errorf("unsafe origin accepted: %q", value)
		}
	}
}
