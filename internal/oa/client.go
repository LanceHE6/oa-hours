// Package oa 封装对泛微 e-cology OA 的登录、会话管理与考勤数据拉取。
package oa

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/LanceHE6/oa-hours/internal/calc"
)

const (
	loginPath = "/login/VerifyLogin.jsp"

	// 每日考勤明细接口。
	detailPath = "/hrm/report/schedulediff/HrmScheduleDiffMonthAttDateDetail.jsp"

	// 会话过期时，OA 返回的 JS 跳转标记。
	loginRedirectMarker = "location.href='/login/Login.jsp"

	// fetchConcurrency 并行拉取每日明细的并发数。
	fetchConcurrency = 6

	// reloginGracePeriod 重登去重窗口：此时间内的重复重登请求直接跳过。
	reloginGracePeriod = 5 * time.Second
)

// Client 表示一个已登录 OA 的客户端（每个用户一个实例，独立 Cookie 与会话）。
type Client struct {
	baseURL    string
	httpClient *http.Client

	mu         sync.RWMutex // 保护登录相关字段
	resourceID string
	account    string
	password   string // 内存中保留，用于会话过期后自动重登
	lastLogin  time.Time
}

// NewClient 创建一个 OA 客户端。
func NewClient(baseURL string) *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Jar:     jar,
			Timeout: 20 * time.Second,
			// 不跟随重定向：登录失败会返回 302，需要自行判断。
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Login 使用账号密码登录 OA，成功返回 resourceId。
func (c *Client) Login(account, password string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.account = account
	c.password = password
	if err := c.loginLocked(account, password); err != nil {
		return "", err
	}
	c.lastLogin = time.Now()
	return c.resourceID, nil
}

// loginLocked 执行登录（调用方需持有写锁）。
func (c *Client) loginLocked(account, password string) error {
	form := url.Values{}
	form.Set("loginfile", "/wui/theme/ecology8/page/login.jsp?templateId=3&logintype=1&gopage=")
	form.Set("logintype", "1")
	form.Set("fontName", "微软雅黑")
	form.Set("message", "")
	form.Set("gopage", "")
	form.Set("formmethod", "get")
	form.Set("isie", "")
	form.Set("islanguid", "7")
	form.Set("loginid", account)
	form.Set("userpassword", password)
	form.Set("tokenAuthKey", "")

	resp, err := c.httpClient.PostForm(c.baseURL+loginPath, form)
	if err != nil {
		return fmt.Errorf("登录请求失败: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	// 登录成功后，OA 会设置 loginidweaver=<内部userid>（数字）。
	rid := c.cookie("loginidweaver")
	if !isNumeric(rid) {
		return fmt.Errorf("登录失败：账号或密码错误（HTTP %d）", resp.StatusCode)
	}
	c.resourceID = rid
	return nil
}

// ResourceID 返回当前用户的 resourceId。
func (c *Client) ResourceID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.resourceID
}

// HasCredentials 返回是否已保存可用于自动重登的凭据。
func (c *Client) HasCredentials() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.account != "" && c.password != ""
}

// cookie 从 CookieJar 中读取指定名称的 Cookie 值。
func (c *Client) cookie(name string) string {
	u, _ := url.Parse(c.baseURL)
	for _, ck := range c.httpClient.Jar.Cookies(u) {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// doGet 执行 GET 请求并返回响应体（无锁，CookieJar 并发安全）。
func (c *Client) doGet(rawURL string) ([]byte, error) {
	resp, err := c.httpClient.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// relogin 使用已保存的凭据重新登录（带去重，避免并发重复登录）。
func (c *Client) relogin() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.account == "" || c.password == "" {
		return fmt.Errorf("缺少凭据，无法自动重新登录")
	}
	// 刚重登过（并发 worker 同时触发），直接复用，不再重复登录。
	if time.Since(c.lastLogin) < reloginGracePeriod {
		return nil
	}
	if err := c.loginLocked(c.account, c.password); err != nil {
		return err
	}
	c.lastLogin = time.Now()
	return nil
}

// FetchDayDetail 拉取某天（YYYY-MM-DD）的考勤明细。
//
// 返回 (nil, nil) 表示该天无打卡数据（周末/未来/无打卡）。
// 会话过期时会自动用保存的凭据重登并重试一次。
func (c *Client) FetchDayDetail(date string) (*Detail, error) {
	body, err := c.fetchDayDetailOnce(date)
	if err != nil {
		return nil, err
	}
	if isLoginRedirect(body) {
		// 会话过期，自动重登后重试一次。
		if err := c.relogin(); err != nil {
			return nil, fmt.Errorf("会话已过期，自动重登失败: %w", err)
		}
		body, err = c.fetchDayDetailOnce(date)
		if err != nil {
			return nil, err
		}
		if isLoginRedirect(body) {
			return nil, fmt.Errorf("会话已过期，重登后仍失败")
		}
	}
	d, found := parseDetail(string(body))
	if !found {
		return nil, nil
	}
	return &d, nil
}

func (c *Client) fetchDayDetailOnce(date string) ([]byte, error) {
	c.mu.RLock()
	rid := c.resourceID
	c.mu.RUnlock()
	u := fmt.Sprintf("%s%s?isdialog=1&curDate=%s&resourceId=%s&status=8&fromHrmDialogTab=1",
		c.baseURL, detailPath, url.QueryEscape(date), url.QueryEscape(rid))
	return c.doGet(u)
}

func isLoginRedirect(body []byte) bool {
	return strings.Contains(string(body), loginRedirectMarker)
}

// MonthStats 是某月的工时统计结果。
type MonthStats struct {
	Month         string    `json:"month"`
	Name          string    `json:"name"`
	Department    string    `json:"department"`
	StandardHours float64   `json:"standardHours"`
	Days          []DayStat `json:"days"`
	AverageHours  float64   `json:"averageHours"`
	LateDays      int       `json:"lateDays"` // 迟到天数（签到晚于 9:00）
}

// DayStat 是一天的统计结果。
type DayStat struct {
	Date    string  `json:"date"`    // YYYY-MM-DD
	Weekday string  `json:"weekday"` // 周几（中文）
	SignIn  string  `json:"signIn"`  // 签到时间 HH:MM:SS
	SignOut string  `json:"signOut"` // 签退时间 HH:MM:SS
	Hours   float64 `json:"hours"`   // 有效工时
	Found   bool    `json:"found"`   // 是否有打卡数据
	Late    bool    `json:"late"`    // 是否迟到（签到晚于 9:00）
}

var weekdayCN = [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

// FetchMonth 拉取某月（YYYY-MM）每天的考勤明细并计算工时（并行拉取）。
func (c *Client) FetchMonth(month string) (*MonthStats, error) {
	t, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, fmt.Errorf("月份格式错误 %q: %w", month, err)
	}
	days := time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.Local).Day()

	stats := &MonthStats{
		Month:         month,
		StandardHours: calc.StandardHours,
		Days:          make([]DayStat, days),
	}

	// 并行拉取每日明细。
	type result struct {
		idx    int
		detail *Detail
		err    error
	}
	jobs := make(chan int)
	results := make(chan result, days)

	var wg sync.WaitGroup
	for w := 0; w < fetchConcurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range jobs {
				date := fmt.Sprintf("%s-%02d", month, d)
				detail, err := c.FetchDayDetail(date)
				results <- result{idx: d - 1, detail: detail, err: err}
			}
		}()
	}

	go func() {
		for d := 1; d <= days; d++ {
			jobs <- d
		}
		close(jobs)
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	for r := range results {
		if r.err != nil {
			return nil, r.err
		}
		ds := DayStat{
			Date:    fmt.Sprintf("%s-%02d", month, r.idx+1),
			Weekday: weekdayCN[weekdayOf(t, r.idx+1)],
		}
		if r.detail != nil {
			ds.Found = true
			ds.SignIn = r.detail.SignIn
			ds.SignOut = r.detail.SignOut
			ds.Hours, _ = calc.EffectiveHours(r.detail.SignIn, r.detail.SignOut)
			ds.Late = calc.IsLate(r.detail.SignIn)
			if stats.Name == "" {
				stats.Name = r.detail.Name
				stats.Department = r.detail.Department
			}
		}
		stats.Days[r.idx] = ds
	}

	// 统计迟到天数。
	for _, d := range stats.Days {
		if d.Late {
			stats.LateDays++
		}
	}

	// 计算月平均工时（只对有签退数据的天，且不含今天——今天的数据可能不完整）。
	today := time.Now().Format("2006-01-02")
	records := make([]calc.DayRecord, 0, days)
	for _, d := range stats.Days {
		if d.Found && d.Date != today {
			records = append(records, calc.DayRecord{
				Date:    d.Date,
				SignIn:  d.SignIn,
				SignOut: d.SignOut,
				Hours:   d.Hours,
			})
		}
	}
	stats.AverageHours = calc.AverageHours(records)

	return stats, nil
}

// weekdayOf 返回某天是星期几（0=周日）。
func weekdayOf(month time.Time, day int) int {
	return int(time.Date(month.Year(), month.Month(), day, 0, 0, 0, 0, time.Local).Weekday())
}
