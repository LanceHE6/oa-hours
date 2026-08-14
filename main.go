// oa-hours：泛微 e-cology 工时统计工具。
//
// 单二进制 Web 应用：Go 后端内嵌 React 前端，登录 OA 实时拉取考勤数据并计算工时。
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/LanceHE6/oa-hours/internal/auth"
	"github.com/LanceHE6/oa-hours/internal/server"
)

//go:embed web/dist
var webDist embed.FS

// buildTime 构建时间，通过 -ldflags "-X main.buildTime=..." 注入。
var buildTime = "unknown"

func main() {
	var (
		addr    = flag.String("addr", "0.0.0.0", "监听地址")
		port    = flag.String("port", "8080", "监听端口")
		oaURL   = flag.String("oa", "http://office.macrosan.com", "OA 系统地址")
		dataDir = flag.String("data", "", "数据目录（默认 ~/.oa-hours）")
	)
	flag.Parse()

	if *dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("获取用户主目录失败: %v", err)
		}
		*dataDir = filepath.Join(home, ".oa-hours")
	}

	store, err := auth.NewStore(*dataDir)
	if err != nil {
		log.Fatalf("初始化凭据存储失败: %v", err)
	}

	var staticFS fs.FS
	if sub, err := fs.Sub(webDist, "web/dist"); err == nil {
		staticFS = sub
	} else {
		log.Printf("警告：未找到前端资源（web/dist），仅提供 API。")
	}

	srv := server.New(*oaURL, store)
	srv.BuildTime = buildTime
	addrStr := *addr + ":" + *port
	log.Printf("oa-hours 已启动，监听 http://%s", addrStr)
	log.Printf("OA 地址: %s | 数据目录: %s | 构建时间: %s", *oaURL, *dataDir, buildTime)

	if err := http.ListenAndServe(addrStr, srv.Handler(staticFS)); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
