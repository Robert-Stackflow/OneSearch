package console

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func profileLogin(t *testing.T, s *Server) *http.Cookie {
	t.Helper()
	w := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	if w.Code != 200 || len(w.Result().Cookies()) == 0 {
		t.Fatal(w.Body.String())
	}
	return w.Result().Cookies()[0]
}

func TestProfileAndAvatarValidation(t *testing.T) {
	s := testServer(t)
	c := profileLogin(t, s)
	if call(s, "PUT", "/api/account", `{"name":"其他人"}`).Code != 401 {
		t.Fatal("unauthenticated profile edit")
	}
	if call(s, "PUT", "/api/account", `{"name":"  "}`, c).Code != 400 {
		t.Fatal("empty name accepted")
	}
	w := call(s, "PUT", "/api/account", `{"name":"  博客管理员  "}`, c)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"name":"博客管理员"`) {
		t.Fatal(w.Body.String())
	}
	var pngData bytes.Buffer
	if e := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 2, 2))); e != nil {
		t.Fatal(e)
	}
	upload := func(data []byte) *httptest.ResponseRecorder {
		var b bytes.Buffer
		m := multipart.NewWriter(&b)
		f, _ := m.CreateFormFile("avatar", "avatar.png")
		f.Write(data)
		m.Close()
		r := httptest.NewRequest("POST", "/api/account/avatar", &b)
		r.Header.Set("Content-Type", m.FormDataContentType())
		r.Header.Set("X-OneSearch-Request", "1")
		r.AddCookie(c)
		r.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	if upload([]byte("<script>not an image</script>")).Code != 400 {
		t.Fatal("non-image accepted")
	}
	if upload(bytes.Repeat([]byte("x"), (5<<20)+1)).Code != 400 {
		t.Fatal("oversized avatar accepted")
	}
	w = upload(pngData.Bytes())
	if w.Code != 200 || !strings.Contains(w.Body.String(), "/api/account/avatar?v=") {
		t.Fatal(w.Body.String())
	}
	got := call(s, "GET", "/api/account/avatar", "", c)
	if got.Code != 200 || got.Header().Get("Content-Type") != "image/png" || !bytes.Equal(got.Body.Bytes(), pngData.Bytes()) {
		t.Fatal("avatar content mismatch")
	}
	if call(s, "GET", "/api/account/avatar", "").Code != 401 {
		t.Fatal("private avatar accessible without session")
	}
	if !strings.Contains(call(s, "GET", "/api/auth/me", "", c).Body.String(), "博客管理员") {
		t.Fatal("avatar upload lost display name")
	}
}

func TestAutomaticBackupEncryptionAndDailySlot(t *testing.T) {
	s := testServer(t)
	c := profileLogin(t, s)
	if call(s, "PUT", "/api/backups/schedule", `{"enabled":true,"time":"03:00","keep":2}`, c).Code != 400 {
		t.Fatal("enabled without encryption password")
	}
	password := "test-backup-password-unique"
	w := call(s, "PUT", "/api/backups/schedule", `{"enabled":true,"time":"03:00","keep":2,"includeDumps":false,"password":"`+password+`"}`, c)
	if w.Code != 200 || strings.Contains(w.Body.String(), password) {
		t.Fatal("schedule response exposed password or failed")
	}
	var raw string
	var encrypted []byte
	if e := s.store.db.QueryRow("SELECT payload,password FROM backup_schedule WHERE id=1").Scan(&raw, &encrypted); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(raw, password) || bytes.Contains(encrypted, []byte(password)) {
		t.Fatal("stored password was not encrypted")
	}
	zone, _ := time.LoadLocation("Asia/Shanghai")
	at := time.Date(2099, 1, 1, 3, 0, 0, 0, zone)
	s.runScheduledBackup(at.Add(-time.Minute))
	var count int
	s.store.db.QueryRow("SELECT count(*) FROM backups").Scan(&count)
	if count != 0 {
		t.Fatal("backup ran before scheduled time")
	}
	s.runScheduledBackup(at)
	s.runScheduledBackup(at.Add(time.Minute))
	s.store.db.QueryRow("SELECT count(*) FROM backups").Scan(&count)
	if count != 1 {
		t.Fatalf("expected one backup per day, got %d", count)
	}
	var data string
	if e := s.store.db.QueryRow("SELECT payload FROM backups").Scan(&data); e != nil {
		t.Fatal(e)
	}
	var b Backup
	json.Unmarshal([]byte(data), &b)
	if !b.Automatic || b.Status != "succeeded" {
		t.Fatal(data)
	}
	blob, e := os.ReadFile(filepath.Join(s.cfg.DataDir, "backups", b.ID+".osbackup"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = DecryptArchive(blob, password); e != nil {
		t.Fatal(e)
	}
	// Reloading the persisted schedule and changing retention must preserve the daily slot.
	w = call(s, "PUT", "/api/backups/schedule", `{"enabled":true,"time":"03:00","keep":1,"includeDumps":false}`, c)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cfg, _, e := s.readSchedule()
	if e != nil || cfg.LastRun != "2099-01-01" || !cfg.HasPassword {
		t.Fatal("schedule lost daily slot/password")
	}
	s.runScheduledBackup(at.Add(time.Hour))
	s.store.db.QueryRow("SELECT count(*) FROM backups").Scan(&count)
	if count != 1 {
		t.Fatal("settings update repeated today's backup")
	}
	s.runScheduledBackup(at.AddDate(0, 0, 1))
	s.store.db.QueryRow("SELECT count(*) FROM backups").Scan(&count)
	if count != 1 {
		t.Fatal("retention did not remove previous automatic backup")
	}
	if _, e = os.Stat(filepath.Join(s.cfg.DataDir, "backups", b.ID+".osbackup")); !os.IsNotExist(e) {
		t.Fatal("retention left old file")
	}
}

func TestAutomaticRetentionPreservesManualAndInstanceBackups(t *testing.T) {
	s := testServer(t)
	dir := filepath.Join(s.cfg.DataDir, "backups")
	os.MkdirAll(dir, 0700)
	var oldID string
	for n := 0; n < 4; n++ {
		b := Backup{ID: randomID(), Kind: "platform", Status: "succeeded", Automatic: n < 3, CreatedAt: time.Date(2026, 1, n+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)}
		if n == 0 {
			oldID = b.ID
		}
		s.saveBackup(b)
		os.WriteFile(filepath.Join(dir, b.ID+".osbackup"), []byte("test"), 0600)
	}
	perInstance := Backup{ID: randomID(), Kind: "dump", InstanceID: randomID(), Status: "succeeded", Automatic: true, CreatedAt: now()}
	s.saveBackup(perInstance)
	s.pruneAutomatic(2)
	var count int
	s.store.db.QueryRow("SELECT count(*) FROM backups").Scan(&count)
	if count != 4 {
		t.Fatalf("manual/per-instance retention lost records: %d", count)
	}
	if _, e := os.Stat(filepath.Join(dir, oldID+".osbackup")); !os.IsNotExist(e) {
		t.Fatal("old automatic file retained")
	}
	s.saveBackup(Backup{ID: randomID(), Kind: "platform", Status: "running"})
	if e := s.recoverBackups(); e != nil {
		t.Fatal(e)
	}
	rows, _ := s.store.db.Query("SELECT payload FROM backups")
	defer rows.Close()
	for rows.Next() {
		var raw string
		rows.Scan(&raw)
		var b Backup
		json.Unmarshal([]byte(raw), &b)
		if b.Status == "running" {
			t.Fatal("interrupted backup stuck running")
		}
	}
}

func TestEncryptedDumpRemovesOnlyItsTemporaryFile(t *testing.T) {
	s := testServer(t)
	i := Instance{ID: randomID(), Provider: "native", Secret: "test-engine-key", Version: "test"}
	dir := filepath.Join(s.cfg.DataDir, "instances", i.ID, "dumps")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	generated := filepath.Join(dir, "generated-dump.dump")
	other := filepath.Join(dir, "unrelated.dump")
	os.WriteFile(generated, []byte("test engine data"), 0600)
	os.WriteFile(other, []byte("keep existing dump"), 0600)
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-engine-key" {
			w.WriteHeader(401)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/dumps" {
			w.Write([]byte(`{"taskUid":1}`))
			return
		}
		w.Write([]byte(`{"status":"succeeded","details":{"dumpUid":"generated-dump"}}`))
	}))
	defer engine.Close()
	i.Host = engine.URL
	b := Backup{ID: randomID(), Kind: "dump", InstanceID: i.ID, Status: "running", CreatedAt: now(), Automatic: true}
	s.saveBackup(b)
	s.performBackup(b, i, "test-dump-password-long")
	var raw string
	s.store.db.QueryRow("SELECT payload FROM backups WHERE id=?", b.ID).Scan(&raw)
	if !strings.Contains(raw, `"status":"succeeded"`) {
		t.Fatal(raw)
	}
	if _, e := os.Stat(generated); !os.IsNotExist(e) {
		t.Fatal("unencrypted temporary dump was retained")
	}
	if _, e := os.Stat(other); e != nil {
		t.Fatal("unrelated dump was removed")
	}
	data, e := os.ReadFile(filepath.Join(s.cfg.DataDir, "backups", b.ID+".osbackup"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = DecryptArchive(data, "test-dump-password-long"); e != nil {
		t.Fatal(e)
	}
}
