package console

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Instance struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Provider     string `json:"provider"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	MemoryMB     int    `json:"memoryMB"`
	Threads      int    `json:"threads"`
	Status       string `json:"status"`
	DesiredState string `json:"desiredState"`
	Version      string `json:"version"`
	Error        string `json:"error,omitempty"`
	PID          int    `json:"-"`
	CreatedAt    string `json:"createdAt"`
	Secret       string `json:"-"`
}
type Operation struct {
	ID           string `json:"id"`
	InstanceID   string `json:"instanceId"`
	InstanceName string `json:"instanceName"`
	Action       string `json:"action"`
	Status       string `json:"status"`
	Message      string `json:"message"`
	CreatedAt    string `json:"createdAt"`
	FinishedAt   string `json:"finishedAt,omitempty"`
}
type Store struct {
	db   *sql.DB
	aead cipher.AEAD
	mu   sync.Mutex
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x", b)
}
func now() string { return time.Now().UTC().Format(time.RFC3339) }

func OpenStore(dir, keyText string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	var key []byte
	var err error
	if keyText != "" {
		key, err = base64.StdEncoding.DecodeString(keyText)
	} else {
		keyPath := filepath.Join(dir, "encryption.key")
		key, err = os.ReadFile(keyPath)
		if errors.Is(err, os.ErrNotExist) {
			key = make([]byte, 32)
			_, err = rand.Read(key)
			if err == nil {
				err = os.WriteFile(keyPath, key, 0600)
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("加密密钥必须是 32 字节")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "onesearch.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	schema := `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS instances(id TEXT PRIMARY KEY, payload TEXT NOT NULL, secret BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, password_hash BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);`
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, aead: aead}, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) seal(text string) []byte {
	n := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(n); err != nil {
		panic(err)
	}
	return s.aead.Seal(n, n, []byte(text), nil)
}
func (s *Store) unseal(data []byte) (string, error) {
	if len(data) < s.aead.NonceSize() {
		return "", errors.New("密钥数据不完整")
	}
	n := s.aead.NonceSize()
	p, e := s.aead.Open(nil, data[:n], data[n:], nil)
	return string(p), e
}
func (s *Store) SaveInstance(i Instance) error {
	b, err := json.Marshal(i)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO instances VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,secret=excluded.secret", i.ID, string(b), s.seal(i.Secret))
	return err
}
func (s *Store) GetInstance(id string) (Instance, error) {
	var i Instance
	var payload string
	var secret []byte
	err := s.db.QueryRow("SELECT payload,secret FROM instances WHERE id=?", id).Scan(&payload, &secret)
	if err != nil {
		return i, err
	}
	if err = json.Unmarshal([]byte(payload), &i); err != nil {
		return i, err
	}
	i.Secret, err = s.unseal(secret)
	return i, err
}
func (s *Store) Instances() ([]Instance, error) {
	rows, err := s.db.Query("SELECT payload FROM instances ORDER BY rowid DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Instance{}
	for rows.Next() {
		var p string
		if err = rows.Scan(&p); err != nil {
			return nil, err
		}
		var i Instance
		if err = json.Unmarshal([]byte(p), &i); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}
func (s *Store) SaveOperation(o Operation) error {
	b, err := json.Marshal(o)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO operations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", o.ID, string(b))
	return err
}
func (s *Store) Operations() ([]Operation, error) {
	rows, err := s.db.Query("SELECT payload FROM operations ORDER BY rowid DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Operation{}
	for rows.Next() {
		var p string
		if err = rows.Scan(&p); err != nil {
			return nil, err
		}
		var o Operation
		if err = json.Unmarshal([]byte(p), &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (s *Store) Audit(actor, action, target string) {
	s.db.Exec("INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)", actor, action, target, now())
}
func (s *Store) Audits() ([]map[string]any, error) {
	rows, err := s.db.Query("SELECT actor,action,target,created_at FROM audit ORDER BY id DESC LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var a, b, c, d string
		if err = rows.Scan(&a, &b, &c, &d); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"actor": a, "action": b, "target": c, "createdAt": d})
	}
	return out, rows.Err()
}
