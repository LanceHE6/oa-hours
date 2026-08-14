package calc

import (
	"math"
	"testing"
)

func closeTo(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

func TestEffectiveHours(t *testing.T) {
	cases := []struct {
		name string
		in   string
		out  string
		want float64
	}{
		// 8:30 前签到：封底 8:30，只扣午休 1.5h。
		{"早到-准点下班", "08:00:00", "18:00:00", 8.0},
		{"早到-18:30下班", "08:00:00", "18:30:00", 8.5},
		// 8:30~9:00 签到：按实际签到，只扣午休（即使 18 点后下班也不扣晚饭）。
		{"9点内-18点下班", "08:55:44", "18:00:00", 27256.0 / 3600.0},
		{"9点内-19点下班不扣晚饭", "08:55:44", "19:00:00", 30856.0 / 3600.0},
		// 真实数据：08-03 签到 08:55:12 签退 20:42:53（9点内，不扣晚饭）。
		{"真实08-03", "08:55:12", "20:42:53", 37061.0 / 3600.0},
		// 9 点后签到：扣午休+晚饭。
		{"真实08-13", "09:01:18", "19:02:54", 28896.0 / 3600.0},
		// 9 点后签到但 18 点前签退：只扣午休。
		{"9点后-17点下班不扣晚饭", "09:30:00", "17:00:00", 6.0},
		// 未签退：返回 0。
		{"未签退", "08:55:44", "", 0},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := EffectiveHours(c.in, c.out)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !closeTo(got, c.want, 1e-9) {
				t.Errorf("EffectiveHours(%q,%q) = %.6f, want %.6f", c.in, c.out, got, c.want)
			}
		})
	}
}

func TestEffectiveHoursBoundary(t *testing.T) {
	// 9:00 整签到不属于“9 点后”，即使 18 点后下班也不扣晚饭。
	got, err := EffectiveHours("09:00:00", "19:00:00")
	if err != nil {
		t.Fatal(err)
	}
	// 19:00 - 9:00 = 10h，扣午休 1.5h = 8.5h。
	if !closeTo(got, 8.5, 1e-9) {
		t.Errorf("boundary 09:00 got %.6f want 8.5", got)
	}

	// 18:00 整签退不算“超过 18:00”，9 点后签到只扣午休。
	got, err = EffectiveHours("09:30:00", "18:00:00")
	if err != nil {
		t.Fatal(err)
	}
	// 18:00 - 9:30 = 8.5h，扣午休 1.5h = 7.0h。
	if !closeTo(got, 7.0, 1e-9) {
		t.Errorf("boundary 18:00 got %.6f want 7.0", got)
	}
}

func TestTargetSignOut(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"08:00:00", "18:30"}, // 早到封底 8:30，+10h
		{"08:30:00", "18:30"},
		{"08:55:44", "18:55"}, // +10h
		{"09:00:00", "19:00"}, // 9:00 整不算“9 点后”，+10h
		{"09:01:18", "19:31"}, // +10.5h
		{"09:30:00", "20:00"}, // +10.5h
	}

	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			got, err := TargetSignOut(c.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("TargetSignOut(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestIsLate(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"08:55:44", false},
		{"08:59:59", false},
		{"09:00:00", false}, // 9:00 整不算迟到
		{"09:00:01", true},
		{"09:00:53", true},
		{"09:30:00", true},
	}
	for _, c := range cases {
		if got := IsLate(c.in); got != c.want {
			t.Errorf("IsLate(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestAverageHours(t *testing.T) {
	days := []DayRecord{
		{Date: "2026-08-03", SignIn: "08:55:12", SignOut: "20:42:53", Hours: 10.0},
		{Date: "2026-08-13", SignIn: "09:01:18", SignOut: "19:02:54", Hours: 8.0},
		{Date: "2026-08-14", SignIn: "08:55:44", SignOut: "", Hours: 0}, // 当天未签退，不计入
	}
	got := AverageHours(days)
	// (10 + 8) / 2 = 9。
	if !closeTo(got, 9.0, 1e-9) {
		t.Errorf("AverageHours = %.6f, want 9.0", got)
	}

	if got := AverageHours(nil); got != 0 {
		t.Errorf("AverageHours(nil) = %f, want 0", got)
	}
}

func TestParseAndFormatClock(t *testing.T) {
	if sec, err := ParseClock("08:30"); err != nil || sec != 8*3600+30*60 {
		t.Errorf("ParseClock(08:30) = %d,%v", sec, err)
	}
	if sec, err := ParseClock("08:30:05"); err != nil || sec != 8*3600+30*60+5 {
		t.Errorf("ParseClock(08:30:05) = %d,%v", sec, err)
	}
	if _, err := ParseClock(""); err == nil {
		t.Error("ParseClock(empty) should error")
	}
	if _, err := ParseClock("25:00"); err == nil {
		t.Error("ParseClock(25:00) should error")
	}
	if got := FormatClock(18*3600 + 30*60); got != "18:30" {
		t.Errorf("FormatClock = %q, want 18:30", got)
	}
}
