package console

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDailyAggregationSurvivesHistoryRetention(t *testing.T) {
	s := testServer(t)
	s.store.SaveInstance(Instance{ID: "one", Status: "stopped", CreatedAt: now()})
	s.store.SaveInstance(Instance{ID: "two", Status: "stopped", CreatedAt: now()})
	r := httptest.NewRequest("POST", "/api/search/one/blog", bytes.NewReader(nil))
	r.RemoteAddr = "192.0.2.1:1234"
	s.recordSearch(r, "one", "blog", "public", []byte(`{"q":"hello"}`), []byte(`{"hits":[{"id":1}]}`), 200, time.Now())
	s.recordSearch(r, "one", "blog", "public", nil, nil, 403, time.Now())
	s.recordSearch(r, "two", "docs", "admin", nil, []byte(`{"hits":[]}`), 200, time.Now())
	days, e := s.metrics("one", 7)
	if e != nil {
		t.Fatal(e)
	}
	last := days[len(days)-1]
	if last.Requests != 2 || last.Successes != 1 || last.Public != 2 || last.Admin != 0 {
		t.Fatalf("incorrect instance aggregation: %+v", last)
	}
	s.store.db.Exec("DELETE FROM search_history")
	days, e = s.metrics("", 365)
	if e != nil {
		t.Fatal(e)
	}
	last = days[len(days)-1]
	if last.Requests != 3 || last.ZeroResults != 1 {
		t.Fatal("daily summary lost with raw history")
	}
	s.store.SaveOperation(Operation{ID: "op-one", InstanceID: "one", CreatedAt: now()})
	s.store.SaveOperation(Operation{ID: "op-two", InstanceID: "two", CreatedAt: now()})
	w := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	cookie := w.Result().Cookies()[0]
	w = call(s, "GET", "/api/instances/one/operations", "", cookie)
	var out struct {
		Data []Operation `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 200 || len(out.Data) != 1 || out.Data[0].ID != "op-one" {
		t.Fatal("instance operation filter failed", w.Body.String())
	}
}
