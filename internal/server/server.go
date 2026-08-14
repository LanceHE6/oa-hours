// Package server 提供 HTTP API 与前端静态资源服务。
package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/LanceHE6/oa-hours/internal/auth"
	"github.com/LanceHE6/oa-hours/internal/calc"
	"github.com/LanceHE6/oa-hours/internal/oa"
)

const sessionCookieName = "oa_hours_session"

// Server 是 HTTP 服务。
type Server struct {
	oaBaseURL string
	store     *auth.Store

	mu       sync.Mutex
	sessions map[string]*session
}

type session struct {
	client  *oa.Client
	account string
}

// New 创建一个 Server。
func New(oaBaseURL string, store *auth.Store) *Server {
	return &Server{
		oaBaseURL: oaBaseURL,
		store:     store,
		sessions:  map[string]*session{},
	}
}

// Handler 返回完整的 HTTP Handler（API + 前端静态资源）。
func (s *Server) Handler(staticFS fs.FS) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/api/logout", s.handleLogout)
	mux.HandleFunc("/api/auth", s.handleAuth)
	mux.HandleFunc("/api/month", s.handleMonth)
	mux.HandleFunc("/api/relogin", s.handleRelogin)

	if staticFS != nil {
		fileServer := http.FileServer(http.FS(staticFS))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			// SPA 回退：非 /api 且非文件请求时返回 index.html。
			if r.URL.Path != "/" {
				if f, err := staticFS.Open(strings.TrimPrefix(r.URL.Path, "/")); err == nil {
					_ = f.Close()
					fileServer.ServeHTTP(w, r)
					return
				}
			}
			// 回退到 index.html。
			idx, err := staticFS.Open("index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer idx.Close()
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(readAll(idx))
		})
	}

	return logMiddleware(mux)
}

func readAll(f fs.File) []byte {
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := f.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	return buf
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

// --- 工具方法 ---

func sendJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func sendError(w http.ResponseWriter, status int, msg string) {
	sendJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) getSession(r *http.Request) (*session, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[cookie.Value]
	return sess, ok
}

func (s *Server) newSession(account string, client *oa.Client) string {
	id := randomToken()
	s.mu.Lock()
	s.sessions[id] = &session{client: client, account: account}
	s.mu.Unlock()
	return id
}

func (s *Server) deleteSession(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- 处理器 ---

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Account  string `json:"account"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	req.Account = strings.TrimSpace(req.Account)
	if req.Account == "" || req.Password == "" {
		sendError(w, http.StatusBadRequest, "账号和密码不能为空")
		return
	}

	client := oa.NewClient(s.oaBaseURL)
	rid, err := client.Login(req.Account, req.Password)
	if err != nil {
		sendError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// 持久化凭据（加密落盘），用于会话过期/重启后的自动重登。
	if err := s.store.Set(req.Account, req.Password); err != nil {
		log.Printf("持久化凭据失败: %v", err)
	}

	sid := s.newSession(req.Account, client)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   0, // 会话级，随浏览器关闭失效
	})

	sendJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"account":    req.Account,
		"resourceId": rid,
	})
}

func (s *Server) handleRelogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	// 使用已保存的凭据自动登录（用于“记住密码”场景）。
	var req struct {
		Account string `json:"account"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.Account = strings.TrimSpace(req.Account)
	if req.Account == "" {
		sendError(w, http.StatusBadRequest, "账号不能为空")
		return
	}
	password, ok := s.store.Get(req.Account)
	if !ok {
		sendError(w, http.StatusNotFound, "未找到该账号的已保存凭据")
		return
	}
	client := oa.NewClient(s.oaBaseURL)
	rid, err := client.Login(req.Account, password)
	if err != nil {
		sendError(w, http.StatusUnauthorized, err.Error())
		return
	}
	sid := s.newSession(req.Account, client)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	sendJSON(w, http.StatusOK, map[string]any{"status": "ok", "resourceId": rid})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		s.deleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	sendJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAuth(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.getSession(r)
	if !ok {
		sendJSON(w, http.StatusOK, map[string]any{"loggedIn": false})
		return
	}
	sendJSON(w, http.StatusOK, map[string]any{
		"loggedIn":   true,
		"account":    sess.account,
		"resourceId": sess.client.ResourceID(),
	})
}

func (s *Server) handleMonth(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.getSession(r)
	if !ok {
		sendError(w, http.StatusUnauthorized, "未登录")
		return
	}
	month := r.URL.Query().Get("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	stats, err := sess.client.FetchMonth(month)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	today := time.Now().Format("2006-01-02")

	days := make([]dayResponse, 0, len(stats.Days))
	for _, d := range stats.Days {
		dr := dayResponse{
			Date:    d.Date,
			Weekday: d.Weekday,
			SignIn:  d.SignIn,
			SignOut: d.SignOut,
			Hours:   d.Hours,
			Found:   d.Found,
			Late:    d.Late,
			IsToday: d.Date == today,
		}
		// 当天：只要已签到，就计算达标目标签退时间（不管是否已打第二次卡）。
		if dr.IsToday && d.Found && d.SignIn != "" {
			if target, err := calc.TargetSignOut(d.SignIn); err == nil {
				dr.TargetSignOut = target
			}
		}
		days = append(days, dr)
	}

	sendJSON(w, http.StatusOK, monthResponse{
		Month:         stats.Month,
		Name:          stats.Name,
		Department:    stats.Department,
		StandardHours: stats.StandardHours,
		AverageHours:  stats.AverageHours,
		LateDays:      stats.LateDays,
		Today:         today,
		Days:          days,
	})
}

type monthResponse struct {
	Month         string        `json:"month"`
	Name          string        `json:"name"`
	Department    string        `json:"department"`
	StandardHours float64       `json:"standardHours"`
	AverageHours  float64       `json:"averageHours"`
	LateDays      int           `json:"lateDays"`
	Today         string        `json:"today"`
	Days          []dayResponse `json:"days"`
}

type dayResponse struct {
	Date          string  `json:"date"`
	Weekday       string  `json:"weekday"`
	SignIn        string  `json:"signIn"`
	SignOut       string  `json:"signOut"`
	Hours         float64 `json:"hours"`
	Found         bool    `json:"found"`
	Late          bool    `json:"late"`
	IsToday       bool    `json:"isToday"`
	TargetSignOut string  `json:"targetSignOut,omitempty"`
}
