package console

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Config struct {
	DataDir, Binary, Origin, AdminUser, AdminPassword, EncryptionKey         string
	Mode, StaticDir                                                          string
	DockerSocket, DockerImage, DockerNetwork, DockerOwner, DockerHostDataDir string
	TrustedProxies                                                           []string
}
type Server struct {
	store         *Store
	native        EngineRuntime
	cfg           Config
	queue         chan Operation
	done          chan struct{}
	work          sync.WaitGroup
	ctx           context.Context
	cancel        context.CancelFunc
	createMu      sync.Mutex
	loginMu       sync.Mutex
	loginFailures map[string][]time.Time
}
type actorKey struct{}

var uidPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func New(cfg Config) (*Server, error) {
	if cfg.Mode == "" {
		cfg.Mode = "dev"
	}
	if cfg.Mode != "dev" && cfg.Mode != "production" {
		return nil, errors.New("不支持的运行模式")
	}
	for _, cidr := range cfg.TrustedProxies {
		if _, _, e := net.ParseCIDR(cidr); e != nil {
			return nil, errors.New("代理信任列表需要有效 CIDR")
		}
	}
	if cfg.Mode == "production" {
		u, e := url.Parse(cfg.Origin)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("生产环境需要完整 HTTPS Origin，不包含路径")
		}
		if _, e = os.Stat(filepath.Join(cfg.StaticDir, "index.html")); e != nil {
			return nil, errors.New("未找到前端构建文件")
		}
	}
	store, err := OpenStore(cfg.DataDir, cfg.EncryptionKey)
	if err != nil {
		return nil, err
	}
	if cfg.AdminUser == "" {
		cfg.AdminUser = "admin"
	}
	if cfg.Origin == "" {
		cfg.Origin = "http://localhost:5178"
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{store: store, native: NewRuntime(cfg.Binary, cfg.DataDir), cfg: cfg, queue: make(chan Operation, 100), done: make(chan struct{}), ctx: ctx, cancel: cancel, loginFailures: map[string][]time.Time{}}
	if cfg.Mode == "production" {
		s.native, err = NewDockerRuntime(cfg)
		if err != nil {
			store.Close()
			cancel()
			return nil, err
		}
	}
	if err = s.extraSchema(); err != nil {
		store.Close()
		cancel()
		return nil, err
	}
	if err = s.bootstrap(); err != nil {
		store.Close()
		cancel()
		return nil, err
	}
	// Interrupted operations are not silently replayed. A user can explicitly retry.
	ops, err := store.Operations()
	if err != nil {
		s.Close()
		return nil, err
	}
	for _, o := range ops {
		if o.Status == "queued" || o.Status == "running" {
			o.Status = "failed"
			o.Message = "后台重启中断了操作，请检查实例后重试"
			o.FinishedAt = now()
			store.SaveOperation(o)
		}
	}
	list, err := store.Instances()
	if err != nil {
		s.Close()
		return nil, err
	}
	for _, i := range list {
		full, e := store.GetInstance(i.ID)
		if e != nil {
			s.Close()
			return nil, e
		}
		if full.Status == "archived" {
			continue
		}
		probe, c := context.WithTimeout(ctx, 2*time.Second)
		v, e := engineVersion(probe, full)
		c()
		if e == nil {
			full.Status = "running"
			full.Version = v
			full.Error = ""
		} else {
			full.Status = "stopped"
		}
		if err = store.SaveInstance(full); err != nil {
			s.Close()
			return nil, err
		}
	}
	s.work.Add(1)
	go s.worker()
	if cfg.Mode == "production" {
		for _, i := range list {
			full, e := store.GetInstance(i.ID)
			if e == nil && managed(full) && full.Status != "archived" && full.Status != "running" && full.DesiredState == "running" {
				full.Status = "starting"
				if e = store.SaveInstance(full); e == nil {
					_, e = s.enqueue(full, "start")
				}
				if e != nil {
					s.Close()
					return nil, e
				}
			}
		}
	}
	return s, nil
}
func (s *Server) bootstrap() error {
	var n int
	if err := s.store.db.QueryRow("SELECT count(*) FROM users").Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	password := s.cfg.AdminPassword
	if password == "" {
		b := make([]byte, 18)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		password = hex.EncodeToString(b)
		file := "dev-login.txt"
		if s.cfg.Mode == "production" {
			file = "initial-login.txt"
		}
		if err := os.WriteFile(filepath.Join(s.cfg.DataDir, file), []byte("用户名: "+s.cfg.AdminUser+"\n密码: "+password+"\n首次生成后保留，不会因重启改变。登录后请修改密码。\n"), 0600); err != nil {
			return err
		}
	}
	if len(password) < 12 {
		return errors.New("管理员初始密码至少 12 位")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	_, err = s.store.db.Exec("INSERT INTO users VALUES(?,?)", s.cfg.AdminUser, h)
	return err
}
func (s *Server) Close() { s.cancel(); s.work.Wait(); s.native.Shutdown(); s.store.Close() }
func send(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"data": data})
}
func fail(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": message}})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return errors.New("请求内容或字段不正确")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("请求只能包含一个 JSON 值")
	}
	return nil
}
func hashToken(t string) string { b := sha256.Sum256([]byte(t)); return hex.EncodeToString(b[:]) }
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]string{"status": "ok", "mode": s.cfg.Mode})
	})
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/passkey/begin", s.passkeyLoginBegin)
	mux.HandleFunc("POST /api/auth/passkey/finish", s.passkeyLoginFinish)
	mux.HandleFunc("POST /api/search/{id}/{index}", s.publicSearch)
	mux.HandleFunc("OPTIONS /api/search/{id}/{index}", s.publicSearch)
	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]any{"username": r.Context().Value(actorKey{}), "mode": s.cfg.Mode})
	})
	protected.HandleFunc("POST /api/auth/logout", s.logout)
	s.extraRoutes(protected)
	protected.HandleFunc("GET /api/system", s.system)
	protected.HandleFunc("GET /api/operations", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.store.Operations()
		if e != nil {
			fail(w, 500, "无法读取操作记录")
			return
		}
		send(w, 200, v)
	})
	protected.HandleFunc("GET /api/audit", func(w http.ResponseWriter, r *http.Request) {
		v, e := s.store.Audits()
		if e != nil {
			fail(w, 500, "无法读取审计记录")
			return
		}
		send(w, 200, v)
	})
	protected.HandleFunc("GET /api/instances", s.listInstances)
	protected.HandleFunc("POST /api/instances", s.createInstance)
	protected.HandleFunc("GET /api/instances/{id}", s.getInstance)
	protected.HandleFunc("POST /api/instances/{id}/actions", s.instanceAction)
	protected.HandleFunc("GET /api/instances/{id}/logs", s.logs)
	protected.HandleFunc("/api/instances/{id}/engine/{rest...}", s.engine)
	mux.Handle("/api/", s.auth(protected))
	if s.cfg.StaticDir != "" {
		mux.Handle("/", spaHandler(s.cfg.StaticDir))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = s.withClientIP(r)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(r.URL.Path, "/api/search/") {
			mux.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/auth/passkey/") && !s.allowAttempt("passkey:"+peerIP(r), 30) {
			fail(w, 429, "尝试次数过多")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("X-OneSearch-Request") != "1" {
				fail(w, 403, "缺少请求校验标识")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && origin != s.cfg.Origin && !(s.cfg.Mode == "dev" && origin == "http://127.0.0.1:7800") {
				fail(w, 403, "请求来源未被允许")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("onesearch_session")
		if err != nil {
			fail(w, 401, "请先登录")
			return
		}
		var user string
		err = s.store.db.QueryRow("SELECT username FROM sessions WHERE token_hash=? AND expires_at>?", hashToken(cookie.Value), time.Now().Unix()).Scan(&user)
		if err != nil {
			fail(w, 401, "登录已过期，请重新登录")
			return
		}
		s.store.db.Exec("UPDATE session_details SET last_seen=? WHERE token_hash=?", time.Now().Unix(), hashToken(cookie.Value))
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, user)))
	})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		OTP      string `json:"otp"`
	}
	if err := decode(w, r, &req); err != nil {
		fail(w, 400, err.Error())
		return
	}
	// Middleware accepts forwarded addresses only from explicitly trusted peers.
	peer := peerIP(r)
	s.loginMu.Lock()
	ts := []time.Time{}
	for _, t := range s.loginFailures[peer] {
		if time.Since(t) < time.Minute {
			ts = append(ts, t)
		}
	}
	if len(ts) >= 10 {
		s.loginMu.Unlock()
		fail(w, 429, "尝试次数过多，请一分钟后再试")
		return
	}
	s.loginFailures[peer] = append(ts, time.Now())
	s.loginMu.Unlock()
	var h []byte
	err := s.store.db.QueryRow("SELECT password_hash FROM users WHERE username=?", req.Username).Scan(&h)
	if err != nil || bcrypt.CompareHashAndPassword(h, []byte(req.Password)) != nil || !s.verifySecondFactor(req.Username, req.OTP) {
		fail(w, 401, "用户名、密码或双因素验证码不正确")
		return
	}
	err = s.createSession(w, r, req.Username, "password")
	if err != nil {
		fail(w, 500, "无法创建登录会话")
		return
	}
	send(w, 200, map[string]string{"username": req.Username})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.store.Audit(r.Context().Value(actorKey{}).(string), "logout", "console")
	if c, e := r.Cookie("onesearch_session"); e == nil {
		s.store.db.Exec("DELETE FROM sessions WHERE token_hash=?", hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: "onesearch_session", Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.Mode == "production", SameSite: http.SameSiteStrictMode, MaxAge: -1})
	send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) system(w http.ResponseWriter, r *http.Request) {
	ctx, c := context.WithTimeout(r.Context(), 5*time.Second)
	defer c()
	v, e := s.native.Version(ctx)
	runtime := "native"
	if s.cfg.Mode == "production" {
		runtime = "docker"
	}
	send(w, 200, map[string]any{"mode": s.cfg.Mode, "runtime": runtime, "runtimeAvailable": e == nil, "engineVersion": v, "dockerAvailable": s.cfg.Mode == "production" && e == nil, "origin": s.cfg.Origin})
}
func publicInstance(i Instance, owned bool) map[string]any {
	b, _ := json.Marshal(i)
	out := map[string]any{}
	json.Unmarshal(b, &out)
	out["canControl"] = managed(i) && (i.Status != "running" || owned)
	return out
}
func (s *Server) listInstances(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Instances()
	if err != nil {
		fail(w, 500, "无法读取实例")
		return
	}
	out := []map[string]any{}
	for _, i := range list {
		out = append(out, publicInstance(i, s.native.Owns(i.ID)))
	}
	send(w, 200, out)
}
func (s *Server) getInstance(w http.ResponseWriter, r *http.Request) {
	i, err := s.store.GetInstance(r.PathValue("id"))
	if err != nil {
		fail(w, 404, "实例不存在")
		return
	}
	ctx, c := context.WithTimeout(r.Context(), 2*time.Second)
	defer c()
	if i.Status == "running" {
		if _, err = engineVersion(ctx, i); err != nil {
			i.Status = "unhealthy"
		}
	}
	send(w, 200, publicInstance(i, s.native.Owns(i.ID)))
}
func (s *Server) createInstance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Provider    string `json:"provider"`
		Host        string `json:"host"`
		APIKey      string `json:"apiKey"`
		MemoryMB    int    `json:"memoryMB"`
		Threads     int    `json:"threads"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if len(req.Name) == 0 || len(req.Name) > 120 || len(req.Description) > 1000 {
		fail(w, 400, "名称必填且最多 120 字节，描述最多 1000 字节")
		return
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	i := Instance{ID: randomID(), Name: req.Name, Description: req.Description, Provider: req.Provider, CreatedAt: now(), DesiredState: "running"}
	// Native creation is retained as the dev client's managed-engine choice.
	if s.cfg.Mode == "production" && i.Provider == "native" {
		i.Provider = "docker"
	}
	if i.Provider == "external" {
		if s.cfg.Mode == "production" {
			fail(w, 400, "服务器版本暂不接入外部实例，请创建托管实例")
			return
		}
		u, e := url.Parse(req.Host)
		if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			fail(w, 400, "dev 模式仅允许接入 http://127.0.0.1:端口，地址不可包含路径或凭据")
			return
		}
		port, e := strconvPort(u.Port())
		if e != nil {
			fail(w, 400, "请指定有效端口")
			return
		}
		i.Port = port
		i.Host = strings.TrimRight(req.Host, "/")
		i.Secret = req.APIKey
		ctx, c := context.WithTimeout(r.Context(), 5*time.Second)
		v, e := engineVersion(ctx, i)
		c()
		if e != nil {
			fail(w, 400, e.Error())
			return
		}
		i.Version = v
		i.Status = "running"
	} else if managed(i) && ((s.cfg.Mode == "dev" && i.Provider == "native") || (s.cfg.Mode == "production" && i.Provider == "docker")) {
		if req.MemoryMB < 128 || req.MemoryMB > 8192 || req.Threads < 1 || req.Threads > 16 {
			fail(w, 400, "索引内存预算为 128–8192 MiB，索引线程为 1–16")
			return
		}
		if _, e := s.native.Version(r.Context()); e != nil {
			fail(w, 503, "搜索运行时未就绪，请检查服务端配置")
			return
		}
		if i.Provider == "docker" {
			i.Port = 7700
			i.Host = "http://" + engineName(i.ID) + ":7700"
		} else {
			list, e := s.store.Instances()
			if e != nil {
				fail(w, 500, "无法分配端口")
				return
			}
			port, e := freePort(list)
			if e != nil {
				fail(w, 409, e.Error())
				return
			}
			i.Port = port
			i.Host = fmt.Sprintf("http://127.0.0.1:%d", port)
		}
		i.Secret = randomID() + randomID()
		i.MemoryMB = req.MemoryMB
		i.Threads = req.Threads
		i.Status = "provisioning"
	} else {
		fail(w, 400, "请选择创建本地实例或接入已有实例")
		return
	}
	if e := s.store.SaveInstance(i); e != nil {
		fail(w, 500, "无法保存实例")
		return
	}
	s.store.Audit(r.Context().Value(actorKey{}).(string), "instance.create", i.ID)
	if managed(i) {
		o, e := s.enqueue(i, "start")
		if e != nil {
			fail(w, 500, "无法创建启动操作")
			return
		}
		send(w, 202, map[string]any{"instance": publicInstance(i, false), "operation": o})
		return
	}
	send(w, 201, map[string]any{"instance": publicInstance(i, false)})
}
func strconvPort(text string) (int, error) {
	var n int
	if _, e := fmt.Sscanf(text, "%d", &n); e != nil || fmt.Sprint(n) != text || n < 1 || n > 65535 {
		return 0, errors.New("无效端口")
	}
	return n, nil
}
func (s *Server) instanceAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if e := decode(w, r, &req); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if req.Action != "start" && req.Action != "stop" && req.Action != "restart" && req.Action != "archive" {
		fail(w, 400, "不支持此操作")
		return
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	i, e := s.store.GetInstance(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "实例不存在")
		return
	}
	if i.Status == "provisioning" || i.Status == "starting" || i.Status == "stopping" {
		fail(w, 409, "实例正在执行其它操作")
		return
	}
	if i.Status == "archived" {
		fail(w, 409, "已归档的实例不可操作")
		return
	}
	if i.Provider == "external" && req.Action != "archive" {
		fail(w, 409, "接入的外部实例只能管理索引；启停由原运行环境负责")
		return
	}
	if managed(i) && i.Status == "running" && !s.native.Owns(i.ID) {
		fail(w, 409, "此实例由之前的后台进程启动。请手动停止旧服务后重试，平台不会终止身份不确定的进程")
		return
	}
	if req.Action == "start" && i.Status == "running" {
		fail(w, 409, "实例已经运行")
		return
	}
	if req.Action == "stop" && i.Status == "stopped" {
		fail(w, 409, "实例已经停止")
		return
	}
	if req.Action == "stop" || req.Action == "archive" {
		i.DesiredState = "stopped"
		i.Status = "stopping"
	} else {
		i.DesiredState = "running"
		i.Status = "starting"
	}
	if e = s.store.SaveInstance(i); e != nil {
		fail(w, 500, "无法保存操作状态")
		return
	}
	o, e := s.enqueue(i, req.Action)
	if e != nil {
		fail(w, 500, "无法创建操作")
		return
	}
	s.store.Audit(r.Context().Value(actorKey{}).(string), "instance."+req.Action, i.ID)
	send(w, 202, o)
}
func (s *Server) enqueue(i Instance, action string) (Operation, error) {
	o := Operation{ID: randomID(), InstanceID: i.ID, InstanceName: i.Name, Action: action, Status: "queued", Message: "等待执行", CreatedAt: now()}
	if err := s.store.SaveOperation(o); err != nil {
		return o, err
	}
	s.queue <- o
	return o, nil
}
func (s *Server) worker() {
	defer s.work.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case o := <-s.queue:
			s.execute(o)
		}
	}
}
func (s *Server) execute(o Operation) {
	i, err := s.store.GetInstance(o.InstanceID)
	if err != nil {
		return
	}
	o.Status = "running"
	o.Message = "正在执行"
	s.store.SaveOperation(o)
	if i.Provider == "external" && o.Action == "archive" {
		i.Status = "archived"
	} else {
		if o.Action == "stop" || o.Action == "restart" || o.Action == "archive" {
			if s.native.Owns(i.ID) {
				err = s.native.Stop(i)
			}
			if err == nil {
				i.PID = 0
				i.Status = "stopped"
			}
		}
		if err == nil && (o.Action == "start" || o.Action == "restart") {
			i.PID, err = s.native.Start(i)
			if err == nil {
				ctx, c := context.WithTimeout(s.ctx, 45*time.Second)
				defer c()
				for {
					v, e := engineVersion(ctx, i)
					if e == nil {
						i.Version = v
						i.Status = "running"
						break
					}
					select {
					case <-ctx.Done():
						err = errors.New("服务未在 45 秒内就绪，请查看运行日志")
					case <-time.After(300 * time.Millisecond):
					}
					if err != nil {
						_ = s.native.Stop(i)
						break
					}
				}
			}
		}
		if err == nil && o.Action == "archive" {
			i.Status = "archived"
		}
	}
	if err != nil {
		i.Status = "failed"
		i.Error = err.Error()
		o.Status = "failed"
		o.Message = err.Error()
	} else {
		i.Error = ""
		o.Status = "succeeded"
		o.Message = "操作完成；数据已保留"
	}
	o.FinishedAt = now()
	s.store.SaveInstance(i)
	s.store.SaveOperation(o)
}
func (s *Server) logs(w http.ResponseWriter, r *http.Request) {
	i, e := s.store.GetInstance(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "实例不存在")
		return
	}
	if !managed(i) {
		send(w, 200, map[string]string{"text": "外部实例的日志由原运行环境管理。"})
		return
	}
	text, e := s.native.Logs(i)
	if errors.Is(e, os.ErrNotExist) {
		text = "实例尚未生成运行日志。"
	} else if e != nil {
		fail(w, 500, "无法读取日志")
		return
	}
	send(w, 200, map[string]string{"text": text})
}

// Only these API routes may use the server-held instance credential.
func allowedEnginePath(method, path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || !uidPattern.MatchString(p) {
			return false
		}
	}
	if len(parts) == 1 {
		switch parts[0] {
		case "version", "stats":
			return method == "GET"
		case "indexes", "keys":
			return method == "GET" || method == "POST"
		case "tasks":
			return method == "GET"
		}
	}
	if len(parts) == 2 {
		if parts[0] == "tasks" {
			return method == "GET"
		}
		if parts[0] == "keys" {
			return method == "DELETE"
		}
		if parts[0] == "indexes" {
			return method == "GET" || method == "DELETE"
		}
	}
	if len(parts) == 3 && parts[0] == "indexes" {
		switch parts[2] {
		case "documents":
			return method == "GET" || method == "POST" || method == "PUT"
		case "search":
			return method == "POST"
		case "settings":
			return method == "GET" || method == "PATCH"
		case "stats":
			return method == "GET"
		}
	}
	if len(parts) == 4 && parts[0] == "indexes" && parts[2] == "documents" {
		return method == "GET" || method == "DELETE"
	}
	return false
}
func (s *Server) engine(w http.ResponseWriter, r *http.Request) {
	path := r.PathValue("rest")
	if !allowedEnginePath(r.Method, path) {
		fail(w, 403, "此实例接口未开放")
		return
	}
	i, e := s.store.GetInstance(r.PathValue("id"))
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "实例不存在")
		return
	}
	if e != nil {
		fail(w, 500, "无法读取实例凭据")
		return
	}
	if i.Status != "running" {
		fail(w, 409, "实例未运行")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	b, e := io.ReadAll(r.Body)
	if e != nil {
		fail(w, 413, "请求超过 16 MiB 限制")
		return
	}
	if len(b) > 0 && !json.Valid(b) {
		fail(w, 400, "请提供有效 JSON")
		return
	}
	query := r.URL.Query()
	allowed := map[string]bool{"limit": true, "offset": true, "fields": true, "filter": true, "indexUids": true, "statuses": true, "types": true, "from": true}
	for key := range query {
		if !allowed[key] {
			fail(w, 400, "不支持此查询参数")
			return
		}
	}
	fullPath := "/" + path
	if len(query) > 0 {
		fullPath += "?" + query.Encode()
	}
	started := time.Now()
	res, status, e := upstream(r.Context(), i, r.Method, fullPath, bytes.NewReader(b))
	parts := strings.Split(path, "/")
	if len(parts) == 3 && parts[0] == "indexes" && parts[2] == "search" && r.Method == "POST" {
		if e != nil {
			status = 502
		}
		s.recordSearch(r, i.ID, parts[1], "admin", b, res, status, started)
	}
	if e != nil {
		fail(w, 502, e.Error())
		return
	}
	if status >= 400 {
		var data struct {
			Message string `json:"message"`
		}
		json.Unmarshal(res, &data)
		if data.Message == "" {
			data.Message = fmt.Sprintf("Meilisearch 返回 HTTP %d", status)
		}
		fail(w, status, strings.ReplaceAll(data.Message, i.Secret, "[REDACTED]"))
		return
	}
	var data any
	if e = json.Unmarshal(res, &data); e != nil && status != 204 {
		fail(w, 502, "实例返回了不可识别的数据")
		return
	}
	if path == "keys" && r.Method == "GET" {
		if obj, ok := data.(map[string]any); ok {
			if list, ok := obj["results"].([]any); ok {
				for _, item := range list {
					if key, ok := item.(map[string]any); ok {
						delete(key, "key")
					}
				}
			}
		}
	}
	if r.Method != "GET" {
		s.store.Audit(r.Context().Value(actorKey{}).(string), r.Method+" "+path, i.ID)
	}
	send(w, status, data)
}
