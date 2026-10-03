package console

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/scrypt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Backup struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	InstanceID string `json:"instanceId,omitempty"`
	Status     string `json:"status"`
	CreatedAt  string `json:"createdAt"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256,omitempty"`
	Error      string `json:"error,omitempty"`
}

func (s *Server) saveBackup(b Backup) {
	p, _ := json.Marshal(b)
	s.store.db.Exec("INSERT INTO backups VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", b.ID, string(p))
}
func (s *Server) listBackups(w http.ResponseWriter, r *http.Request) {
	rows, e := s.store.db.Query("SELECT payload FROM backups ORDER BY id DESC")
	if e != nil {
		fail(w, 500, "无法读取备份")
		return
	}
	defer rows.Close()
	out := []Backup{}
	for rows.Next() {
		var p string
		rows.Scan(&p)
		var b Backup
		json.Unmarshal([]byte(p), &b)
		out = append(out, b)
	}
	send(w, 200, out)
}
func encryptArchive(data []byte, password string) ([]byte, error) {
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return nil, e
	}
	key, e := scrypt.Key([]byte(password), salt, 32768, 8, 1, 32)
	if e != nil {
		return nil, e
	}
	block, _ := aes.NewCipher(key)
	a, _ := cipher.NewGCM(block)
	nonce := make([]byte, a.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	header := append([]byte("ONESEARCH1"), salt...)
	header = append(header, nonce...)
	return a.Seal(header, nonce, data, header), nil
}
func DecryptArchive(data []byte, password string) ([]byte, error) {
	if len(data) < 54 || string(data[:10]) != "ONESEARCH1" {
		return nil, errors.New("不是 OneSearch 加密备份")
	}
	key, e := scrypt.Key([]byte(password), data[10:26], 32768, 8, 1, 32)
	if e != nil {
		return nil, e
	}
	block, _ := aes.NewCipher(key)
	a, _ := cipher.NewGCM(block)
	return a.Open(nil, data[26:38], data[38:], data[:38])
}
func (s *Server) createBackup(w http.ResponseWriter, r *http.Request) {
	if !s.requireRecent(w, r) {
		return
	}
	var req struct {
		Kind       string `json:"kind"`
		InstanceID string `json:"instanceId"`
		Password   string `json:"password"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if req.Kind != "platform" && req.Kind != "dump" {
		fail(w, 400, "备份类型应为 platform 或 dump")
		return
	}
	if len(req.Password) < 12 || len(req.Password) > 1024 {
		fail(w, 400, "备份密码需为 12–1024 字节")
		return
	}
	var instance Instance
	if req.Kind == "dump" {
		i, e := s.store.GetInstance(req.InstanceID)
		if e != nil || i.Provider != "native" || i.Status != "running" {
			fail(w, 400, "数据备份需要运行中的本平台本地实例")
			return
		}
		instance = i
	}
	b := Backup{ID: randomID(), Kind: req.Kind, InstanceID: req.InstanceID, Status: "running", CreatedAt: now()}
	s.saveBackup(b)
	s.store.Audit(r.Context().Value(actorKey{}).(string), "backup.create", b.ID)
	s.work.Add(1)
	go func() {
		defer s.work.Done()
		var archive []byte
		var e error
		if b.Kind == "platform" {
			archive, e = s.platformArchive()
		} else {
			archive, e = s.dumpArchive(instance)
		}
		if e == nil {
			archive, e = encryptArchive(archive, req.Password)
		}
		if e == nil {
			e = os.MkdirAll(filepath.Join(s.cfg.DataDir, "backups"), 0700)
		}
		if e == nil {
			e = os.WriteFile(filepath.Join(s.cfg.DataDir, "backups", b.ID+".osbackup"), archive, 0600)
		}
		if e != nil {
			b.Status = "failed"
			message := e.Error()
			if instance.Secret != "" {
				message = strings.ReplaceAll(message, instance.Secret, "[REDACTED]")
			}
			b.Error = "备份未完成，请检查本地文件权限和实例任务：" + message
		} else {
			b.Status = "succeeded"
			b.Size = int64(len(archive))
			b.SHA256 = hashToken(string(archive))
		}
		s.saveBackup(b)
	}()
	send(w, 202, b)
}
func (s *Server) platformArchive() ([]byte, error) {
	id := randomID()
	path := filepath.Join(s.cfg.DataDir, "backup-"+id+".sqlite")
	defer os.Remove(path)
	_, e := s.store.db.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'")
	if e != nil {
		return nil, e
	}
	snapshot, e := sql.Open("sqlite", path)
	if e != nil {
		return nil, e
	}
	_, e = snapshot.Exec("DELETE FROM sessions;DELETE FROM session_details;DELETE FROM passkey_challenges;")
	snapshot.Close()
	if e != nil {
		return nil, e
	}
	db, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	var key []byte
	if s.cfg.EncryptionKey != "" {
		key, e = base64.StdEncoding.DecodeString(s.cfg.EncryptionKey)
	} else {
		key, e = os.ReadFile(filepath.Join(s.cfg.DataDir, "encryption.key"))
	}
	if e != nil {
		return nil, e
	}
	return zipFiles(map[string][]byte{"onesearch.db": db, "encryption.key": key, "manifest.json": []byte(`{"format":1,"kind":"platform","sessionsExcluded":true,"engineDataExcluded":true}`)})
}
func zipFiles(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, data := range files {
		w, e := z.Create(name)
		if e != nil {
			return nil, e
		}
		if _, e = w.Write(data); e != nil {
			return nil, e
		}
	}
	if e := z.Close(); e != nil {
		return nil, e
	}
	return buf.Bytes(), nil
}
func (s *Server) dumpArchive(i Instance) ([]byte, error) {
	ctx, c := context.WithTimeout(s.ctx, 90*time.Second)
	defer c()
	body, status, e := upstream(ctx, i, "POST", "/dumps", nil)
	if e != nil || status >= 400 {
		return nil, fmt.Errorf("实例拒绝备份（HTTP %d）", status)
	}
	var task struct {
		UID int `json:"taskUid"`
	}
	if e = json.Unmarshal(body, &task); e != nil {
		return nil, e
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
		body, status, e = upstream(ctx, i, "GET", fmt.Sprintf("/tasks/%d", task.UID), nil)
		if e != nil || status != 200 {
			return nil, errors.New("无法查询备份任务")
		}
		var result struct {
			Status  string `json:"status"`
			Details struct {
				DumpUID string `json:"dumpUid"`
			} `json:"details"`
		}
		if json.Unmarshal(body, &result) != nil {
			return nil, errors.New("备份任务响应无效")
		}
		if result.Status == "failed" || result.Status == "canceled" {
			return nil, errors.New("实例备份任务失败")
		}
		if result.Status == "succeeded" {
			if !uidPattern.MatchString(result.Details.DumpUID) {
				return nil, errors.New("备份文件标识无效")
			}
			data, e := os.ReadFile(filepath.Join(s.cfg.DataDir, "instances", i.ID, "dumps", result.Details.DumpUID+".dump"))
			if e != nil {
				return nil, e
			}
			manifest, _ := json.Marshal(map[string]any{"format": 1, "kind": "dump", "instanceId": i.ID, "version": i.Version, "dumpUID": result.Details.DumpUID})
			return zipFiles(map[string][]byte{"engine.dump": data, "manifest.json": manifest})
		}
	}
}
func (s *Server) downloadBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("backup")
	if !uidPattern.MatchString(id) {
		fail(w, 404, "备份不存在")
		return
	}
	var raw string
	if s.store.db.QueryRow("SELECT payload FROM backups WHERE id=?", id).Scan(&raw) != nil {
		fail(w, 404, "备份不存在")
		return
	}
	var b Backup
	json.Unmarshal([]byte(raw), &b)
	if b.Status != "succeeded" {
		fail(w, 409, "备份未完成")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=onesearch-"+id+".osbackup")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.cfg.DataDir, "backups", id+".osbackup"))
}

// ExtractBackup accepts exactly the known files, never ZIP member paths from an archive.
func ExtractBackup(data []byte, password, destination string) error {
	plain, e := DecryptArchive(data, password)
	if e != nil {
		return errors.New("备份密码错误或文件已损坏")
	}
	z, e := zip.NewReader(bytes.NewReader(plain), int64(len(plain)))
	if e != nil {
		return e
	}
	allowed := map[string]bool{"onesearch.db": true, "encryption.key": true, "manifest.json": true, "engine.dump": true}
	files := map[string][]byte{}
	for _, f := range z.File {
		if !allowed[f.Name] || files[f.Name] != nil || f.UncompressedSize64 > 256<<20 {
			return errors.New("备份内容或大小不符合约定")
		}
		rd, e := f.Open()
		if e != nil {
			return e
		}
		b, e := io.ReadAll(io.LimitReader(rd, 256<<20))
		rd.Close()
		if e != nil {
			return e
		}
		files[f.Name] = b
	}
	if files["manifest.json"] == nil {
		return errors.New("缺少备份清单")
	}
	if e = os.MkdirAll(destination, 0700); e != nil {
		return e
	}
	for name, b := range files {
		path := filepath.Join(destination, name)
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = f.Write(b)
		f.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
