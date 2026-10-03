package console

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) analyticsSchema() error {
	_, e := s.store.db.Exec(`CREATE TABLE IF NOT EXISTS daily_metrics(day TEXT NOT NULL,instance_id TEXT NOT NULL,source TEXT NOT NULL,requests INTEGER NOT NULL,successes INTEGER NOT NULL,zero_results INTEGER NOT NULL,duration_ms INTEGER NOT NULL,result_count INTEGER NOT NULL,PRIMARY KEY(day,instance_id,source));CREATE TABLE IF NOT EXISTS metrics_meta(id INTEGER PRIMARY KEY,start_day TEXT NOT NULL);`)
	if e != nil {
		return e
	}
	_, e = s.store.db.Exec(`INSERT INTO daily_metrics SELECT substr(created_at,1,10),instance_id,source,count(*),sum(CASE WHEN status>=200 AND status<400 THEN 1 ELSE 0 END),sum(CASE WHEN status>=200 AND status<400 AND json_extract(payload,'$.resultCount')=0 THEN 1 ELSE 0 END),sum(COALESCE(json_extract(payload,'$.durationMs'),0)),sum(COALESCE(json_extract(payload,'$.resultCount'),0)) FROM search_history GROUP BY substr(created_at,1,10),instance_id,source ON CONFLICT(day,instance_id,source) DO NOTHING`)
	if e != nil {
		return e
	}
	_, e = s.store.db.Exec("INSERT OR IGNORE INTO metrics_meta VALUES(1,COALESCE((SELECT min(substr(created_at,1,10)) FROM search_history),?))", time.Now().UTC().Format("2006-01-02"))
	return e
}
func (s *Server) addMetric(id, source string, status, count int, duration int64) {
	success, zero := 0, 0
	if status >= 200 && status < 400 {
		success = 1
		if count == 0 {
			zero = 1
		}
	}
	s.store.db.Exec(`INSERT INTO daily_metrics VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(day,instance_id,source) DO UPDATE SET requests=requests+excluded.requests,successes=successes+excluded.successes,zero_results=zero_results+excluded.zero_results,duration_ms=duration_ms+excluded.duration_ms,result_count=result_count+excluded.result_count`, time.Now().UTC().Format("2006-01-02"), id, source, 1, success, zero, duration, count)
	s.store.db.Exec("DELETE FROM daily_metrics WHERE day<?", time.Now().UTC().AddDate(0, 0, -400).Format("2006-01-02"))
}

type DailyMetric struct {
	Date        string `json:"date"`
	Requests    int    `json:"requests"`
	Successes   int    `json:"successes"`
	ZeroResults int    `json:"zeroResults"`
	DurationMS  int64  `json:"durationMs"`
	Results     int    `json:"results"`
	Public      int    `json:"public"`
	Admin       int    `json:"admin"`
}

func (s *Server) metrics(id string, days int) ([]DailyMetric, error) {
	start := time.Now().UTC().AddDate(0, 0, -days+1)
	rows, e := s.store.db.Query("SELECT day,sum(requests),sum(successes),sum(zero_results),sum(duration_ms),sum(result_count),sum(CASE WHEN source='public' THEN requests ELSE 0 END),sum(CASE WHEN source='admin' THEN requests ELSE 0 END) FROM daily_metrics WHERE day>=? AND (?='' OR instance_id=?) GROUP BY day", start.Format("2006-01-02"), id, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	lookup := map[string]DailyMetric{}
	for rows.Next() {
		var d DailyMetric
		if e = rows.Scan(&d.Date, &d.Requests, &d.Successes, &d.ZeroResults, &d.DurationMS, &d.Results, &d.Public, &d.Admin); e != nil {
			return nil, e
		}
		lookup[d.Date] = d
	}
	out := make([]DailyMetric, 0, days)
	for n := 0; n < days; n++ {
		date := start.AddDate(0, 0, n).Format("2006-01-02")
		d := lookup[date]
		d.Date = date
		out = append(out, d)
	}
	return out, rows.Err()
}
func (s *Server) calendar(w http.ResponseWriter, r *http.Request) {
	days, e := s.metrics("", 365)
	if e != nil {
		fail(w, 500, "无法读取活动统计")
		return
	}
	var since string
	s.store.db.QueryRow("SELECT start_day FROM metrics_meta WHERE id=1").Scan(&since)
	send(w, 200, map[string]any{"days": days, "since": since, "timezone": "UTC"})
}
func (s *Server) instanceAnalytics(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, e := s.store.GetInstance(id); e != nil {
		fail(w, 404, "实例不存在")
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days != 7 && days != 30 {
		days = 30
	}
	daily, e := s.metrics(id, days)
	if e != nil {
		fail(w, 500, "无法读取实例统计")
		return
	}
	total, success, zero, public, admin := 0, 0, 0, 0, 0
	var duration int64
	for _, d := range daily {
		total += d.Requests
		success += d.Successes
		zero += d.ZeroResults
		duration += d.DurationMS
		public += d.Public
		admin += d.Admin
	}
	top := []map[string]any{}
	start := time.Now().UTC().AddDate(0, 0, -days+1).Format("2006-01-02")
	rows, e := s.store.db.Query("SELECT query,count(*) FROM search_history WHERE instance_id=? AND created_at>=? AND query!='' GROUP BY query ORDER BY count(*) DESC LIMIT 10", id, start)
	if e == nil {
		for rows.Next() {
			var query string
			var count int
			rows.Scan(&query, &count)
			top = append(top, map[string]any{"query": query, "count": count})
		}
		rows.Close()
	}
	var ips int
	s.store.db.QueryRow("SELECT count(DISTINCT ip) FROM search_history WHERE instance_id=? AND created_at>=?", id, start).Scan(&ips)
	avg := float64(0)
	if total > 0 {
		avg = float64(duration) / float64(total)
	}
	send(w, 200, map[string]any{"days": daily, "requests": total, "successes": success, "errors": total - success, "zeroResults": zero, "averageMs": avg, "public": public, "admin": admin, "uniqueIPs": ips, "topQueries": top, "timezone": "UTC"})
}
func (s *Server) instanceOperations(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, e := s.store.GetInstance(id); e != nil {
		fail(w, 404, "实例不存在")
		return
	}
	rows, e := s.store.db.Query("SELECT payload FROM operations WHERE json_extract(payload,'$.instanceId')=? ORDER BY json_extract(payload,'$.createdAt') DESC LIMIT 100", id)
	if e != nil {
		fail(w, 500, "无法读取实例操作")
		return
	}
	defer rows.Close()
	out := []Operation{}
	for rows.Next() {
		var raw string
		rows.Scan(&raw)
		var o Operation
		json.Unmarshal([]byte(raw), &o)
		out = append(out, o)
	}
	send(w, 200, out)
}
