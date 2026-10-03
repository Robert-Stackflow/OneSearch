package console

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type child struct {
	cmd  *exec.Cmd
	done chan struct{}
	log  *os.File
}
type NativeRuntime struct {
	Binary, DataDir string
	mu              sync.Mutex
	children        map[string]*child
}

// EngineRuntime controls only engines owned by this deployment.
type EngineRuntime interface {
	Version(context.Context) (string, error)
	Start(Instance) (int, error)
	Stop(Instance) error
	Owns(string) bool
	Shutdown()
	Logs(Instance) (string, error)
}

func managed(i Instance) bool { return i.Provider == "native" || i.Provider == "docker" }

func NewRuntime(binary, dir string) *NativeRuntime {
	return &NativeRuntime{Binary: binary, DataDir: dir, children: map[string]*child{}}
}
func (p *NativeRuntime) Version(ctx context.Context) (string, error) {
	if p.Binary == "" {
		return "", errors.New("未配置 Meilisearch 可执行文件")
	}
	b, e := exec.CommandContext(ctx, p.Binary, "--version").Output()
	if e != nil {
		return "", e
	}
	return strings.TrimSpace(string(b)), nil
}
func (p *NativeRuntime) Start(i Instance) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if c := p.children[i.ID]; c != nil {
		select {
		case <-c.done:
			delete(p.children, i.ID)
		default:
			return c.cmd.Process.Pid, nil
		}
	}
	dir := filepath.Join(p.DataDir, "instances", i.ID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return 0, err
	}
	// The executable and paths are configured by the operator, never by browser input.
	log, err := os.OpenFile(filepath.Join(dir, "engine.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	cmd := exec.Command(p.Binary, "--http-addr", fmt.Sprintf("127.0.0.1:%d", i.Port), "--env", "development", "--db-path", filepath.Join(dir, "data.ms"), "--no-analytics", "--max-indexing-memory", fmt.Sprintf("%dMiB", i.MemoryMB), "--max-indexing-threads", strconv.Itoa(i.Threads))
	cmd.Env = append(os.Environ(), "MEILI_MASTER_KEY="+i.Secret)
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.Dir = dir
	if err = cmd.Start(); err != nil {
		log.Close()
		return 0, err
	}
	c := &child{cmd: cmd, done: make(chan struct{}), log: log}
	p.children[i.ID] = c
	go func() { cmd.Wait(); log.Close(); close(c.done) }()
	return cmd.Process.Pid, nil
}
func (p *NativeRuntime) Stop(i Instance) error {
	p.mu.Lock()
	c := p.children[i.ID]
	p.mu.Unlock()
	if c == nil {
		return errors.New("此实例由之前的后台进程启动；请先手动关闭对应服务，再在此启动。为避免误停其它进程，不按历史 PID 终止进程")
	}
	select {
	case <-c.done:
		return nil
	default:
	}
	if runtime.GOOS == "windows" {
		if err := c.cmd.Process.Kill(); err != nil {
			return err
		}
	} else {
		if err := c.cmd.Process.Signal(os.Interrupt); err != nil {
			return err
		}
	}
	select {
	case <-c.done:
	case <-time.After(10 * time.Second):
		if err := c.cmd.Process.Kill(); err != nil {
			return err
		}
		<-c.done
	}
	return nil
}
func (p *NativeRuntime) Owns(id string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	c := p.children[id]
	if c == nil {
		return false
	}
	select {
	case <-c.done:
		return false
	default:
		return true
	}
}
func (p *NativeRuntime) Shutdown() {
	p.mu.Lock()
	ids := []string{}
	for id := range p.children {
		ids = append(ids, id)
	}
	p.mu.Unlock()
	for _, id := range ids {
		_ = p.Stop(Instance{ID: id})
	}
}
func (p *NativeRuntime) Logs(i Instance) (string, error) {
	f, err := os.Open(filepath.Join(p.DataDir, "instances", i.ID, "engine.log"))
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if info.Size() > 65536 {
		f.Seek(-65536, io.SeekEnd)
	}
	b, err := io.ReadAll(io.LimitReader(f, 65536))
	if err != nil {
		return "", err
	}
	return strings.ReplaceAll(string(b), i.Secret, "[REDACTED]"), nil
}
func freePort(instances []Instance) (int, error) {
	used := map[int]bool{}
	for _, i := range instances {
		used[i.Port] = true
	}
	for port := 7810; port <= 7899; port++ {
		if used[port] {
			continue
		}
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return port, nil
		}
	}
	return 0, errors.New("没有空闲开发端口（7810–7899）")
}
func upstream(ctx context.Context, i Instance, method, path string, body io.Reader) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, i.Host+path, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+i.Secret)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, errors.New("无法连接此 Meilisearch 实例，请检查运行状态")
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	return b, res.StatusCode, err
}
func engineVersion(ctx context.Context, i Instance) (string, error) {
	b, status, err := upstream(ctx, i, "GET", "/version", nil)
	if err != nil {
		return "", err
	}
	if status != 200 {
		return "", fmt.Errorf("实例认证失败（HTTP %d）", status)
	}
	var v struct {
		PkgVersion string `json:"pkgVersion"`
	}
	if err = json.Unmarshal(b, &v); err != nil {
		return "", err
	}
	if v.PkgVersion == "" {
		return "", errors.New("目标服务不是兼容的 Meilisearch")
	}
	return v.PkgVersion, nil
}
