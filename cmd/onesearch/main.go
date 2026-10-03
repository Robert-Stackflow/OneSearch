package main

import (
	"context"
	"log"
	"net/http"
	"onesearch/internal/console"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	mode := env("ONESEARCH_MODE", "dev")
	if mode != "dev" && mode != "production" {
		log.Fatal("ONESEARCH_MODE 必须为 dev 或 production")
	}
	dir, err := filepath.Abs(env("ONESEARCH_DATA_DIR", "data"))
	if err != nil {
		log.Fatal(err)
	}
	app, err := console.New(console.Config{
		Mode: mode, DataDir: dir, Binary: os.Getenv("MEILISEARCH_BINARY"), Origin: env("ONESEARCH_ORIGIN", "http://localhost:5178"), AdminUser: env("ONESEARCH_ADMIN_USER", "admin"), AdminPassword: os.Getenv("ONESEARCH_ADMIN_PASSWORD"), EncryptionKey: os.Getenv("ONESEARCH_ENCRYPTION_KEY"),
		StaticDir: os.Getenv("ONESEARCH_STATIC_DIR"), DockerSocket: env("ONESEARCH_DOCKER_SOCKET", "/var/run/docker.sock"), DockerImage: env("ONESEARCH_ENGINE_IMAGE", "getmeili/meilisearch:v1.54.3"), DockerNetwork: os.Getenv("ONESEARCH_DOCKER_NETWORK"), DockerOwner: os.Getenv("ONESEARCH_DOCKER_OWNER"), DockerHostDataDir: os.Getenv("ONESEARCH_HOST_DATA_DIR"), TrustedProxies: strings.FieldsFunc(os.Getenv("ONESEARCH_TRUSTED_PROXIES"), func(c rune) bool { return c == ',' }),
	})
	if err != nil {
		log.Fatal(err)
	}
	addr := env("ONESEARCH_ADDR", "127.0.0.1:7800")
	if mode == "dev" && !strings.HasPrefix(addr, "127.0.0.1:") {
		log.Fatal("dev 服务只能监听 127.0.0.1")
	}
	srv := &http.Server{Addr: addr, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stopped
		ctx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		srv.Shutdown(ctx)
	}()
	loginFile := "dev-login.txt"
	if mode == "production" {
		loginFile = "initial-login.txt"
	}
	log.Printf("OneSearch %s: http://%s | 首次登录信息: %s", mode, addr, filepath.Join(dir, loginFile))
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("服务退出: %v", err)
	}
	app.Close()
}
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
