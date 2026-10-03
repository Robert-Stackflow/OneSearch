package console

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSearchFormattingPaginationAndCap(t *testing.T) {
	s := testServer(t)
	var received map[string]any
	response := `{"hits":[{"id":"a","_formatted":{"title":"<em>搜索</em>"},"_matchesPosition":{"title":[{"start":0,"length":6}]}}],"totalHits":7,"totalPages":3,"page":2,"hitsPerPage":3}`
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(response))
	}))
	defer engine.Close()
	s.store.SaveInstance(Instance{ID: "format-test", Host: engine.URL, Secret: "master", Status: "running", CreatedAt: now()})
	policy, _ := json.Marshal(SitePolicy{Enabled: true, Origins: []string{"https://blog.example.com"}, RequireOrigin: true, Rate: 60, MaxLimit: 3})
	s.store.db.Exec("INSERT INTO site_policies VALUES(?,?,?)", "format-test", "blog", string(policy))
	request := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/search/format-test/blog", bytes.NewBufferString(body))
		r.Header.Set("Origin", "https://blog.example.com")
		r.Header.Set("Authorization", "Bearer scoped-search-key")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	w := request(`{"q":"搜索","page":2,"hitsPerPage":999,"limit":999}`)
	if w.Code != 200 || w.Body.String() != response {
		t.Fatal("search metadata changed or request rejected", w.Code, w.Body.String())
	}
	if received["hitsPerPage"] != float64(3) || received["page"] != float64(2) || received["limit"] != nil {
		t.Fatal("page pagination bypassed result cap", received)
	}
	if received["showMatchesPosition"] != true || received["attributesToHighlight"] == nil || received["attributesToCrop"] == nil {
		t.Fatal("missing default match metadata")
	}
	var history string
	s.store.db.QueryRow("SELECT payload FROM search_history WHERE instance_id='format-test' LIMIT 1").Scan(&history)
	if !strings.Contains(history, `"page":2`) || !strings.Contains(history, `"hitsPerPage":3`) {
		t.Fatal("effective pagination missing from request history")
	}
	w = request(`{"q":"搜索","offset":3,"limit":100,"showMatchesPosition":false,"highlightPreTag":"[hit]","highlightPostTag":"[/hit]","cropLength":20}`)
	if w.Code != 200 || received["limit"] != float64(3) || received["offset"] != float64(3) || received["showMatchesPosition"] != false || received["highlightPreTag"] != "[hit]" {
		t.Fatal("offset cap or explicit formatting parameters lost")
	}
	for _, body := range []string{`{"page":-1}`, `{"hitsPerPage":2.5}`, `{"limit":"100"}`, `{"page":null}`} {
		if request(body).Code != 400 {
			t.Fatal("invalid pagination accepted", body)
		}
	}
}

func TestExpiredSecurityVerificationWithoutTOTP(t *testing.T) {
	s := testServer(t)
	login := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	cookie := login.Result().Cookies()[0]
	s.store.db.Exec("UPDATE session_details SET verified_at=?", time.Now().Add(-time.Hour).Unix())
	status := call(s, "GET", "/api/security", "", cookie)
	if !strings.Contains(status.Body.String(), `"totpEnabled":false`) || !strings.Contains(status.Body.String(), `"verifiedUntil"`) {
		t.Fatal("security status missing verification state")
	}
	w := call(s, "POST", "/api/security/totp/begin", "", cookie)
	if w.Code != 403 || strings.Contains(w.Body.String(), "双因素") {
		t.Fatal("expired session incorrectly requires unconfigured TOTP", w.Body.String())
	}
	w = call(s, "POST", "/api/auth/reauth", `{"password":"test-admin-password-long"}`, cookie)
	if w.Code != 200 {
		t.Fatal("unconfigured TOTP blocked password verification")
	}
	if call(s, "POST", "/api/security/totp/begin", "", cookie).Code != 200 {
		t.Fatal("TOTP setup did not continue after verification")
	}
}
