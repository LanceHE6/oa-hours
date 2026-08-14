package oa

import (
	"os"
	"testing"
)

// TestLiveFetch 真实集成测试：需要设置环境变量 OA_ACCOUNT / OA_PASSWORD 才会运行。
func TestLiveFetch(t *testing.T) {
	account := os.Getenv("OA_ACCOUNT")
	password := os.Getenv("OA_PASSWORD")
	if account == "" || password == "" {
		t.Skip("未设置 OA_ACCOUNT/OA_PASSWORD，跳过真实集成测试")
	}

	c := NewClient("http://office.macrosan.com")
	rid, err := c.Login(account, password)
	if err != nil {
		t.Fatalf("登录失败: %v", err)
	}
	t.Logf("登录成功，resourceId=%s", rid)

	// 拉取已知有数据的日期。
	d, err := c.FetchDayDetail("2026-08-13")
	if err != nil {
		t.Fatalf("拉取 08-13 失败: %v", err)
	}
	if d == nil {
		t.Fatal("08-13 应有数据")
	}
	t.Logf("08-13: %s %s 签到=%s 签退=%s", d.Department, d.Name, d.SignIn, d.SignOut)

	// 拉取无数据的日期（周末）。
	d, err = c.FetchDayDetail("2026-08-15")
	if err != nil {
		t.Fatalf("拉取 08-15 失败: %v", err)
	}
	if d != nil {
		t.Errorf("08-15(周六) 应无数据，实际: %+v", d)
	}

	// 拉取整月。
	stats, err := c.FetchMonth("2026-08")
	if err != nil {
		t.Fatalf("拉取整月失败: %v", err)
	}
	t.Logf("月份=%s 姓名=%s 部门=%s 平均工时=%.3f", stats.Month, stats.Name, stats.Department, stats.AverageHours)
	for _, d := range stats.Days {
		if d.Found {
			t.Logf("  %s %s 签到=%s 签退=%s 工时=%.3f", d.Date, d.Weekday, d.SignIn, d.SignOut, d.Hours)
		}
	}
}
