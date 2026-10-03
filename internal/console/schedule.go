package console

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type BackupSchedule struct {
	Enabled      bool   `json:"enabled"`
	Time         string `json:"time"`
	Keep         int    `json:"keep"`
	IncludeDumps bool   `json:"includeDumps"`
	Password     string `json:"password,omitempty"`
	HasPassword  bool   `json:"hasPassword"`
	LastRun      string `json:"lastRun"`
}

func (s *Server) scheduleSchema() error {
	_, e := s.store.db.Exec(`CREATE TABLE IF NOT EXISTS backup_schedule(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,password BLOB,last_slot TEXT NOT NULL DEFAULT '')`)
	return e
}
func (s *Server) readSchedule() (BackupSchedule, []byte, error) {
	cfg := BackupSchedule{Time: "03:00", Keep: 7, IncludeDumps: true}
	var raw string
	var secret []byte
	e := s.store.db.QueryRow("SELECT payload,password,last_slot FROM backup_schedule WHERE id=1").Scan(&raw, &secret, &cfg.LastRun)
	if errors.Is(e, sql.ErrNoRows) {
		return cfg, nil, nil
	}
	if e != nil {
		return cfg, nil, e
	}
	last := cfg.LastRun
	e = json.Unmarshal([]byte(raw), &cfg)
	cfg.LastRun = last
	cfg.Password = ""
	cfg.HasPassword = len(secret) > 0
	return cfg, secret, e
}
func (s *Server) getSchedule(w http.ResponseWriter, r *http.Request) {
	c, _, e := s.readSchedule()
	if e != nil {
		fail(w, 500, "无法读取自动备份设置")
		return
	}
	send(w, 200, c)
}
func (s *Server) putSchedule(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	var c BackupSchedule
	if e := decode(w, r, &c); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if _, e := time.Parse("15:04", c.Time); e != nil || c.Keep < 1 || c.Keep > 100 {
		fail(w, 400, "请选择有效时间，保留份数为 1–100")
		return
	}
	_, secret, e := s.readSchedule()
	if e != nil {
		fail(w, 500, "无法读取自动备份设置")
		return
	}
	if c.Password != "" {
		if len(c.Password) < 12 || len(c.Password) > 1024 {
			fail(w, 400, "备份密码需为 12–1024 字节")
			return
		}
		secret = s.store.seal(c.Password)
	}
	if c.Enabled && len(secret) == 0 {
		fail(w, 400, "启用自动备份前请设置备份密码")
		return
	}
	c.Password = ""
	c.HasPassword = false
	c.LastRun = ""
	raw, _ := json.Marshal(c)
	_, e = s.store.db.Exec("INSERT INTO backup_schedule(id,payload,password) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,password=excluded.password", string(raw), secret)
	if e != nil {
		fail(w, 500, "无法保存自动备份设置")
		return
	}
	s.store.Audit(r.Context().Value(actorKey{}).(string), "backup.schedule", "console")
	s.getSchedule(w, r)
}
func (s *Server) backupScheduler() {
	defer s.work.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case at := <-ticker.C:
			s.runScheduledBackup(at)
		}
	}
}
func (s *Server) runScheduledBackup(at time.Time) {
	c, secret, e := s.readSchedule()
	if e != nil || !c.Enabled {
		return
	}
	zone, e := time.LoadLocation("Asia/Shanghai")
	if e != nil {
		return
	}
	local := at.In(zone)
	clock, e := time.Parse("15:04", c.Time)
	if e != nil || c.Keep < 1 || c.Keep > 100 {
		return
	}
	due := time.Date(local.Year(), local.Month(), local.Day(), clock.Hour(), clock.Minute(), 0, 0, zone)
	if local.Before(due) {
		return
	}
	slot := local.Format("2006-01-02")
	password, e := s.store.unseal(secret)
	if e != nil || password == "" {
		return
	}
	res, e := s.store.db.Exec("UPDATE backup_schedule SET last_slot=? WHERE id=1 AND last_slot<>?", slot, slot)
	if e != nil {
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return
	}
	instances := []Instance{{}}
	if c.IncludeDumps {
		list, e := s.store.Instances()
		if e == nil {
			for _, i := range list {
				if managed(i) && i.Status == "running" {
					full, e := s.store.GetInstance(i.ID)
					if e == nil {
						instances = append(instances, full)
					}
				}
			}
		}
	}
	for _, i := range instances {
		select {
		case <-s.ctx.Done():
			return
		default:
		}
		kind := "platform"
		if i.ID != "" {
			kind = "dump"
		}
		b := Backup{ID: randomID(), Kind: kind, InstanceID: i.ID, Status: "running", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Automatic: true}
		s.saveBackup(b)
		s.store.Audit("system", "backup.auto", b.ID)
		s.performBackup(b, i, password)
	}
	s.pruneAutomatic(c.Keep)
}
func (s *Server) pruneAutomatic(keep int) {
	if keep < 1 {
		return
	}
	rows, e := s.store.db.Query("SELECT payload FROM backups ORDER BY rowid DESC")
	if e != nil {
		return
	}
	groups := map[string][]Backup{}
	for rows.Next() {
		var raw string
		if rows.Scan(&raw) != nil {
			continue
		}
		var b Backup
		if json.Unmarshal([]byte(raw), &b) == nil && b.Automatic && (b.Status == "succeeded" || b.Status == "failed") {
			key := b.Kind + ":" + b.InstanceID + ":" + b.Status
			groups[key] = append(groups[key], b)
		}
	}
	rows.Close()
	for _, list := range groups {
		sort.SliceStable(list, func(i, j int) bool {
			first, _ := time.Parse(time.RFC3339Nano, list[i].CreatedAt)
			second, _ := time.Parse(time.RFC3339Nano, list[j].CreatedAt)
			return first.After(second)
		})
		for n, b := range list {
			if n < keep || !engineIDPattern.MatchString(b.ID) {
				continue
			}
			e := os.Remove(filepath.Join(s.cfg.DataDir, "backups", b.ID+".osbackup"))
			if e == nil || os.IsNotExist(e) {
				s.store.db.Exec("DELETE FROM backups WHERE id=?", b.ID)
			}
		}
	}
}
