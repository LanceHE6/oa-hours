package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/LanceHE6/oa-hours/internal/auth"
	"github.com/LanceHE6/oa-hours/internal/calc"
)

func newTestServer(t *testing.T, oaBaseURL string) *Server {
	t.Helper()
	store, err := auth.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return New(oaBaseURL, store)
}

func TestHandleCalc(t *testing.T) {
	srv := newTestServer(t, "http://127.0.0.1:0")
	handler := srv.Handler(nil)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantMode   calc.CalcMode
		wantHours  float64
	}{
		{
			name:       "默认ModeA-9点后过18点扣晚饭",
			query:      "signIn=09:30:00&signOut=19:00:00",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  7.5,
		},
		{
			name:       "显式小写a规范化为ModeA",
			query:      "signIn=09:30:00&signOut=19:00:00&mode=a",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  7.5,
		},
		{
			name:       "ModeB-9点后过18点不扣晚饭",
			query:      "signIn=09:30:00&signOut=19:00:00&mode=B",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeB,
			wantHours:  8.0,
		},
		{
			name:       "小写b规范化为ModeB",
			query:      "signIn=09:30:00&signOut=19:00:00&mode=b",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeB,
			wantHours:  8.0,
		},
		{
			name:       "非法mode返回400",
			query:      "signIn=09:30:00&signOut=19:00:00&mode=invalid",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "缺少参数返回400",
			query:      "signIn=09:30:00",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "缺少signIn返回400",
			query:      "signOut=19:00:00",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "缺少全部时间参数返回400",
			query:      "",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "非法signIn时间返回400",
			query:      "signIn=25:00:00&signOut=18:00:00",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "非法signOut时间返回400",
			query:      "signIn=09:00:00&signOut=not-a-time",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "带空白mode=a规范化为ModeA",
			query:      "signIn=09:00:01&signOut=19:00:00&mode=%20a%20",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  8.0 - 1.0/3600.0,
		},
		{
			name:       "带空白mode=B规范化为ModeB",
			query:      "signIn=09:00:01&signOut=19:00:00&mode=%20B%20",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeB,
			wantHours:  8.5 - 1.0/3600.0,
		},
		{
			name:       "边界09:00:00签到+19:00:00签退ModeA与ModeB一致",
			query:      "signIn=09:00:00&signOut=19:00:00&mode=A",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  8.5,
		},
		{
			name:       "边界09:30:00签到+18:00:00签退ModeA不扣晚饭",
			query:      "signIn=09:30:00&signOut=18:00:00&mode=A",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  7.0,
		},
		{
			name:       "边界09:30:00签到+18:00:01签退ModeA扣晚饭",
			query:      "signIn=09:30:00&signOut=18:00:01&mode=A",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeA,
			wantHours:  6.5 + 1.0/3600.0,
		},
		{
			name:       "边界09:30:00签到+18:00:01签退ModeB不扣晚饭",
			query:      "signIn=09:30:00&signOut=18:00:01&mode=B",
			wantStatus: http.StatusOK,
			wantMode:   calc.ModeB,
			wantHours:  7.0 + 1.0/3600.0,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/calc?"+c.query, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantStatus != http.StatusOK {
				return
			}

			var body struct {
				Hours float64       `json:"hours"`
				Mode  calc.CalcMode `json:"mode"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Mode != c.wantMode {
				t.Errorf("mode = %q, want %q", body.Mode, c.wantMode)
			}
			if math.Abs(body.Hours-c.wantHours) > 1e-9 {
				t.Errorf("hours = %v, want %v", body.Hours, c.wantHours)
			}
		})
	}
}

func detailHTML(dept, name, date, signIn, signOut string) string {
	return fmt.Sprintf(`<!DOCTYPE html><html><body><table>
<thead><tr><th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th></tr></thead>
<tbody><tr><td>%s</td><td>%s</td><td>%s</td><td>08:30-18:00</td><td>%s</td><td>%s</td></tr></tbody>
</table></body></html>`, dept, name, date, signIn, signOut)
}

func loginCookie(t *testing.T, handler http.Handler) *http.Cookie {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{
		"account":  "alice",
		"password": "secret",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", rec.Code, rec.Body.String())
	}
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == sessionCookieName {
			return ck
		}
	}
	t.Fatal("missing session cookie")
	return nil
}

func TestHandleMonthModes(t *testing.T) {
	now := time.Now()
	curMonth := now.Format("2006-01")
	today := now.Format("2006-01-02")
	completedDate := curMonth + "-01"
	if completedDate == today {
		completedDate = curMonth + "-02"
	}

	oaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login/VerifyLogin.jsp":
			http.SetCookie(w, &http.Cookie{
				Name:  "loginidweaver",
				Value: "10086",
				Path:  "/",
			})
			w.WriteHeader(http.StatusFound)
		case "/hrm/report/schedulediff/HrmScheduleDiffMonthAttDateDetail.jsp":
			date := r.URL.Query().Get("curDate")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			switch date {
			case completedDate:
				_, _ = w.Write([]byte(detailHTML("研发部", "张三", date, "09:30:00", "19:00:00")))
			case today:
				_, _ = w.Write([]byte(detailHTML("研发部", "张三", date, "09:30:00", "")))
			default:
				_, _ = w.Write([]byte(`<html><body><table><thead><tr><th>部门</th></tr></thead><tbody></tbody></table></body></html>`))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer oaServer.Close()

	srv := newTestServer(t, oaServer.URL)
	handler := srv.Handler(nil)

	// 未登录返回 401。
	unauthReq := httptest.NewRequest(http.MethodGet, "/api/month", nil)
	unauthRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", unauthRec.Code)
	}

	sessCookie := loginCookie(t, handler)

	// 非法 mode 返回 400。
	badReq := httptest.NewRequest(http.MethodGet, "/api/month?month="+curMonth+"&mode=X", nil)
	badReq.AddCookie(sessCookie)
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid mode status = %d, want 400; body=%s", badRec.Code, badRec.Body.String())
	}

	cases := []struct {
		name              string
		query             string
		wantMode          calc.CalcMode
		wantCompletedHour float64
		wantAvgHour       float64
		wantNineOut       string
		wantTargetOut     string
		wantRecOut        string
		wantAvgOut        string
	}{
		{
			name:              "默认ModeA",
			query:             "month=" + curMonth,
			wantMode:          calc.ModeA,
			wantCompletedHour: 7.5,
			wantAvgHour:       7.5,
			wantNineOut:       "20:30",
			wantTargetOut:     "20:00",
			wantRecOut:        "19:30",
			wantAvgOut:        "21:00",
		},
		{
			name:              "ModeB-小写b",
			query:             "month=" + curMonth + "&mode=b",
			wantMode:          calc.ModeB,
			wantCompletedHour: 8.0,
			wantAvgHour:       8.0,
			wantNineOut:       "20:00",
			wantTargetOut:     "19:30",
			wantRecOut:        "19:00",
			wantAvgOut:        "20:00",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/month?"+c.query, nil)
			req.AddCookie(sessCookie)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}

			var resp monthResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.Mode != c.wantMode {
				t.Errorf("mode = %q, want %q", resp.Mode, c.wantMode)
			}
			if math.Abs(resp.AverageHours-c.wantAvgHour) > 1e-9 {
				t.Errorf("averageHours = %v, want %v", resp.AverageHours, c.wantAvgHour)
			}

			var completedDay, todayResp *dayResponse
			for i := range resp.Days {
				switch resp.Days[i].Date {
				case completedDate:
					completedDay = &resp.Days[i]
				case today:
					todayResp = &resp.Days[i]
				}
			}
			if completedDay == nil {
				t.Fatalf("completedDate %s not found in days", completedDate)
			}
			if math.Abs(completedDay.Hours-c.wantCompletedHour) > 1e-9 {
				t.Errorf("completedDay.Hours = %v, want %v", completedDay.Hours, c.wantCompletedHour)
			}
			if todayResp == nil {
				t.Fatalf("today %s not found in days", today)
			}
			if todayResp.NineSignOut != c.wantNineOut ||
				todayResp.TargetSignOut != c.wantTargetOut ||
				todayResp.RecommendSignOut != c.wantRecOut ||
				todayResp.AvgSignOut != c.wantAvgOut {
				t.Errorf("today sign-outs = (%q, %q, %q, %q), want (%q, %q, %q, %q)",
					todayResp.NineSignOut, todayResp.TargetSignOut, todayResp.RecommendSignOut, todayResp.AvgSignOut,
					c.wantNineOut, c.wantTargetOut, c.wantRecOut, c.wantAvgOut)
			}
		})
	}
}

func leaveHTML(name, leaveType string) string {
	return fmt.Sprintf(`<!DOCTYPE html><html><body>
<table><thead><tr><th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th></tr></thead><tbody></tbody></table>
<table><thead><tr><th>请求标题</th><th>姓名</th><th>开始时间</th><th>结束时间</th><th>审批状态</th><th>请假/外出天数</th><th>类型</th></tr></thead>
<tbody><tr><td><a href="#">请假申请</a></td><td>%s</td><td>2026-01-01 08:30</td><td>2026-01-01 18:00</td><td>归档</td><td>1.0</td><td>%s</td></tr></tbody></table>
</body></html>`, name, leaveType)
}

func TestHandleMonthLeaveLateAndTotals(t *testing.T) {
	now := time.Now()
	curMonth := now.Format("2006-01")
	today := now.Format("2006-01-02")

	var nonToday []string
	for d := 1; d <= 28 && len(nonToday) < 3; d++ {
		ds := fmt.Sprintf("%s-%02d", curMonth, d)
		if ds != today {
			nonToday = append(nonToday, ds)
		}
	}
	graceDay, lateDay, leaveDay := nonToday[0], nonToday[1], nonToday[2]

	oaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login/VerifyLogin.jsp":
			http.SetCookie(w, &http.Cookie{
				Name:  "loginidweaver",
				Value: "20001",
				Path:  "/",
			})
			w.WriteHeader(http.StatusFound)
		case "/hrm/report/schedulediff/HrmScheduleDiffMonthAttDateDetail.jsp":
			date := r.URL.Query().Get("curDate")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			switch date {
			case graceDay:
				// 09:00:59 不算迟到，但 > 9:00 触发 ModeA 扣晚饭
				_, _ = w.Write([]byte(detailHTML("研发部", "李四", date, "09:00:59", "19:00:00")))
			case lateDay:
				// 09:01:00 算迟到
				_, _ = w.Write([]byte(detailHTML("研发部", "李四", date, "09:01:00", "19:00:00")))
			case leaveDay:
				// 请假天固定 8h
				_, _ = w.Write([]byte(leaveHTML("李四", "年休假")))
			case today:
				// 今天 09:00:01 签到，未签退
				_, _ = w.Write([]byte(detailHTML("研发部", "李四", date, "09:00:01", "")))
			default:
				_, _ = w.Write([]byte(`<html><body><table><thead><tr><th>部门</th></tr></thead><tbody></tbody></table></body></html>`))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer oaServer.Close()

	srv := newTestServer(t, oaServer.URL)
	handler := srv.Handler(nil)
	sessCookie := loginCookie(t, handler)

	graceHoursA := 8.0 - 59.0/3600.0
	graceHoursB := 8.5 - 59.0/3600.0
	lateHoursA := 8.0 - 60.0/3600.0
	lateHoursB := 8.5 - 60.0/3600.0

	totalA := graceHoursA + lateHoursA + 8.0
	totalB := graceHoursB + lateHoursB + 8.0

	// ModeA: need = 8.5*4 - totalA = 34 - (24 - 119/3600) = 10 + 119/3600 -> +1.5h + 0.5h + 09:00:01 = 21:02:00 -> 21:02
	// ModeB: need = 8.5*4 - totalB = 34 - (25 - 119/3600) = 9 + 119/3600 -> +1.5h + 09:00:01 = 19:32:00 -> 19:32
	cases := []struct {
		mode           calc.CalcMode
		query          string
		wantGraceHours float64
		wantLateHours  float64
		wantTotal      float64
		wantAvg        float64
		wantNineOut    string
		wantTargetOut  string
		wantRecOut     string
		wantAvgOut     string
	}{
		{
			mode:           calc.ModeA,
			query:          "month=" + curMonth + "&mode=A",
			wantGraceHours: graceHoursA,
			wantLateHours:  lateHoursA,
			wantTotal:      totalA,
			wantAvg:        totalA / 3.0,
			wantNineOut:    "20:00",
			wantTargetOut:  "19:30",
			wantRecOut:     "19:00",
			wantAvgOut:     "21:02",
		},
		{
			mode:           calc.ModeB,
			query:          "month=" + curMonth + "&mode=B",
			wantGraceHours: graceHoursB,
			wantLateHours:  lateHoursB,
			wantTotal:      totalB,
			wantAvg:        totalB / 3.0,
			wantNineOut:    "19:30",
			wantTargetOut:  "19:00",
			wantRecOut:     "18:30",
			wantAvgOut:     "19:32",
		},
	}

	for _, c := range cases {
		t.Run("Mode_"+string(c.mode), func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/month?"+c.query, nil)
			req.AddCookie(sessCookie)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}

			var resp monthResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.Mode != c.mode {
				t.Errorf("mode = %q, want %q", resp.Mode, c.mode)
			}
			if resp.LateDays != 1 {
				t.Errorf("lateDays = %d, want 1", resp.LateDays)
			}
			if resp.LeaveDays != 1 {
				t.Errorf("leaveDays = %d, want 1", resp.LeaveDays)
			}
			if math.Abs(resp.TotalHours-c.wantTotal) > 1e-9 {
				t.Errorf("totalHours = %.9f, want %.9f", resp.TotalHours, c.wantTotal)
			}
			if math.Abs(resp.AverageHours-c.wantAvg) > 1e-9 {
				t.Errorf("averageHours = %.9f, want %.9f", resp.AverageHours, c.wantAvg)
			}

			byDate := map[string]dayResponse{}
			for _, d := range resp.Days {
				byDate[d.Date] = d
			}

			gd := byDate[graceDay]
			if gd.Late {
				t.Errorf("graceDay (%s, 09:00:59) Late = true, want false", graceDay)
			}
			if math.Abs(gd.Hours-c.wantGraceHours) > 1e-9 {
				t.Errorf("graceDay.Hours = %.9f, want %.9f", gd.Hours, c.wantGraceHours)
			}

			ld := byDate[lateDay]
			if !ld.Late {
				t.Errorf("lateDay (%s, 09:01:00) Late = false, want true", lateDay)
			}
			if math.Abs(ld.Hours-c.wantLateHours) > 1e-9 {
				t.Errorf("lateDay.Hours = %.9f, want %.9f", ld.Hours, c.wantLateHours)
			}

			lvd := byDate[leaveDay]
			if !lvd.Leave || lvd.LeaveType != "年休假" || math.Abs(lvd.Hours-8.0) > 1e-9 {
				t.Errorf("leaveDay = %+v, want Leave=true LeaveType=年休假 Hours=8", lvd)
			}

			td := byDate[today]
			if td.Late {
				t.Errorf("today (09:00:01) Late = true, want false")
			}
			if td.NineSignOut != c.wantNineOut ||
				td.TargetSignOut != c.wantTargetOut ||
				td.RecommendSignOut != c.wantRecOut ||
				td.AvgSignOut != c.wantAvgOut {
				t.Errorf("today sign-outs = (%q, %q, %q, %q), want (%q, %q, %q, %q)",
					td.NineSignOut, td.TargetSignOut, td.RecommendSignOut, td.AvgSignOut,
					c.wantNineOut, c.wantTargetOut, c.wantRecOut, c.wantAvgOut)
			}
		})
	}
}
