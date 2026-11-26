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
		// 8:30 前签到：按实际签到起算，只扣午休 1.5h。
		{"早到-准点下班", "08:00:00", "18:00:00", 8.5},
		{"早到-18:30下班", "08:00:00", "18:30:00", 9.0},
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
		{"08:00:00", "18:00"}, // 8:00 签到 + 8.5h + 1.5h = 18:00
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
		{"09:00:01", false}, // 宽限期内，不算迟到
		{"09:00:53", false}, // 宽限期内，不算迟到
		{"09:00:59", false}, // 9:00:59 及之前不算“9点后”
		{"09:01:00", true},  // 9:01:00 起算迟到
		{"09:30:00", true},
	}
	for _, c := range cases {
		if got := IsLate(c.in); got != c.want {
			t.Errorf("IsLate(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestTargetSignOutFor(t *testing.T) {
	cases := []struct {
		in          string
		targetHours float64
		want        string
	}{
		// 周五 8h 推荐：8:30~9:00 签到，+9.5h。
		{"08:55:44", 8.0, "18:25"},
		{"08:30:00", 8.0, "18:00"}, // 8:30 起步 + 1.5h 午休 + 8h
		{"09:30:00", 8.0, "19:30"}, // 9:30 起步 + 1.5h + 0.5h + 8h = +10h
		// 8.5h 达标（与 TargetSignOut 一致）。
		{"08:55:44", 8.5, "18:55"},
	}
	for _, c := range cases {
		got, err := TargetSignOutFor(c.in, c.targetHours)
		if err != nil {
			t.Fatalf("TargetSignOutFor(%q,%v) error: %v", c.in, c.targetHours, err)
		}
		if got != c.want {
			t.Errorf("TargetSignOutFor(%q,%v) = %q, want %q", c.in, c.targetHours, got, c.want)
		}
	}
}

func TestAvgTargetSignOut(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		sumHours float64
		doneDays int
		target   float64
		want     string
	}{
		// 平均没达标（4天×8h=32h，平均8h），需补足。
		{"需补足", "08:30:00", 32, 4, 8.5, "20:30"}, // need=10.5h → 8:30+10.5+1.5=20:30
		// 平均已超标（4天×10h=40h，平均10h），need=2.5h<8h，按 8h 下限 → 18:00。
		{"已超标按8h下限", "08:30:00", 40, 4, 8.5, "18:00"}, // need=2.5h→8h → 8:30+8+1.5=18:00
		// need<=0（平均远超），按 8h 下限 → 18:00。
		{"平均远超", "08:30:00", 50, 4, 8.5, "18:00"},
		// 无已完成天（月初第一天），need=8.5h。
		{"月初第一天", "08:30:00", 0, 0, 8.5, "18:30"},
		// 用户场景：平均已够（need=7.71h<8h），按 8h 下限 → 18:25。
		{"8h下限晚于18点", "08:55:44", 77.286, 9, 8.5, "18:25"}, // 8:55:44+8+1.5=18:25:44
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := AvgTargetSignOut(c.in, c.sumHours, c.doneDays, c.target)
			if err != nil {
				t.Fatalf("AvgTargetSignOut error: %v", err)
			}
			if got != c.want {
				t.Errorf("AvgTargetSignOut(%q,%v,%d,%v) = %q, want %q", c.in, c.sumHours, c.doneDays, c.target, got, c.want)
			}
		})
	}
}

func TestAverageHours(t *testing.T) {
	days := []DayRecord{
		{Date: "2026-08-03", SignIn: "08:55:12", SignOut: "20:42:53", Hours: 10.0},
		{Date: "2026-08-09", SignOut: "", Hours: 8.0, Leave: true}, // 请假天 8h，计入平均
		{Date: "2026-08-13", SignIn: "09:01:18", SignOut: "19:02:54", Hours: 8.0},
		{Date: "2026-08-14", SignIn: "08:55:44", SignOut: "", Hours: 0}, // 当天未签退，不计入
	}
	got := AverageHours(days)
	// (10 + 8 + 8) / 3 = 8.667。
	if !closeTo(got, 26.0/3.0, 1e-9) {
		t.Errorf("AverageHours = %.6f, want %.6f", got, 26.0/3.0)
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

func TestParseCalcMode(t *testing.T) {
	valid := []struct {
		in   string
		want CalcMode
	}{
		{"", ModeA},
		{"  ", ModeA},
		{"A", ModeA},
		{"a", ModeA},
		{" a ", ModeA},
		{"B", ModeB},
		{"b", ModeB},
		{" B ", ModeB},
	}
	for _, c := range valid {
		got, err := ParseCalcMode(c.in)
		if err != nil {
			t.Errorf("ParseCalcMode(%q) unexpected error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ParseCalcMode(%q) = %q, want %q", c.in, got, c.want)
		}
	}

	for _, bad := range []string{"C", "AB", "modeA", "1"} {
		if _, err := ParseCalcMode(bad); err == nil {
			t.Errorf("ParseCalcMode(%q) expected error, got nil", bad)
		}
	}
}

func TestEffectiveHoursWithMode(t *testing.T) {
	cases := []struct {
		name string
		in   string
		out  string
		mode CalcMode
		want float64
	}{
		{"ModeA-9点后过18点扣晚饭", "09:30:00", "18:30:00", ModeA, 7.0},
		{"空模式规范化为ModeA", "09:30:00", "18:30:00", "", 7.0},
		{"ModeB-9点后过18点不扣晚饭", "09:30:00", "18:30:00", ModeB, 7.5},
		{"ModeB-9点内只扣午休", "08:55:00", "19:00:00", ModeB, 8.5 + 5.0/60.0},
		{"ModeA-9点后18点整不扣晚饭", "09:30:00", "18:00:00", ModeA, 7.0},
		{"ModeB-9点后18点整只扣午休", "09:30:00", "18:00:00", ModeB, 7.0},
		{"ModeB-未签退", "09:30:00", "", ModeB, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := EffectiveHoursWithMode(c.in, c.out, c.mode)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !closeTo(got, c.want, 1e-9) {
				t.Errorf("EffectiveHoursWithMode(%q,%q,%q) = %.6f, want %.6f", c.in, c.out, c.mode, got, c.want)
			}
		})
	}

	if _, err := EffectiveHoursWithMode("09:30:00", "", CalcMode("X")); err == nil {
		t.Error("expected error for unknown mode even with empty signOut")
	}
}

func TestTargetSignOutForWithMode(t *testing.T) {
	cases := []struct {
		name   string
		in     string
		target float64
		mode   CalcMode
		want   string
	}{
		{"ModeA-9点后含晚饭", "09:30:00", StandardHours, ModeA, "20:00"},
		{"空模式规范化为ModeA", "09:30:00", StandardHours, "", "20:00"},
		{"ModeB-9点后不含晚饭", "09:30:00", StandardHours, ModeB, "19:30"},
		{"ModeB-9点后9h目标", "09:01:18", NineHours, ModeB, "19:31"},
		{"ModeA-9点后9h目标", "09:01:18", NineHours, ModeA, "20:01"},
		{"ModeB-9点前8h受18点下限保护", "08:00:00", EightHours, ModeB, "18:00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := TargetSignOutForWithMode(c.in, c.target, c.mode)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("TargetSignOutForWithMode(%q,%v,%q) = %q, want %q", c.in, c.target, c.mode, got, c.want)
			}
		})
	}

	if _, err := TargetSignOutForWithMode("09:30:00", StandardHours, CalcMode("C")); err == nil {
		t.Error("expected error for unknown mode")
	}
}

func TestAvgTargetSignOutWithMode(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		sumHours float64
		doneDays int
		target   float64
		mode     CalcMode
		want     string
	}{
		{"ModeA-9点后需补足", "09:30:00", 32, 4, StandardHours, ModeA, "22:00"},
		{"空模式规范化为ModeA", "09:30:00", 32, 4, StandardHours, "", "22:00"},
		{"ModeB-9点后需补足", "09:30:00", 32, 4, StandardHours, ModeB, "21:30"},
		{"ModeA-9点后已超标按8h下限", "09:30:00", 40, 4, StandardHours, ModeA, "19:30"},
		{"ModeB-9点后已超标按8h下限", "09:30:00", 40, 4, StandardHours, ModeB, "19:00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := AvgTargetSignOutWithMode(c.in, c.sumHours, c.doneDays, c.target, c.mode)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}

	if _, err := AvgTargetSignOutWithMode("09:30:00", 32, 4, StandardHours, CalcMode("invalid")); err == nil {
		t.Error("expected error for unknown mode")
	}
}

func TestModeBoundaryComparison(t *testing.T) {
	// 重点边界对比：09:00:00 / 09:00:01 / 09:00:59 / 09:01:00 与 18:00:00 / 18:00:01
	cases := []struct {
		name     string
		in       string
		out      string
		wantLate bool
		wantA    float64
		wantB    float64
	}{
		{
			name:     "09:00:00签到+19:00:00签退(A=B)",
			in:       "09:00:00",
			out:      "19:00:00",
			wantLate: false,
			wantA:    8.5,
			wantB:    8.5,
		},
		{
			name:     "09:00:01签到+19:00:00签退(不迟到但A扣晚饭B不扣)",
			in:       "09:00:01",
			out:      "19:00:00",
			wantLate: false,
			wantA:    8.0 - 1.0/3600.0,
			wantB:    8.5 - 1.0/3600.0,
		},
		{
			name:     "09:00:59签到+19:00:00签退(宽限末秒不迟到但A扣晚饭B不扣)",
			in:       "09:00:59",
			out:      "19:00:00",
			wantLate: false,
			wantA:    8.0 - 59.0/3600.0,
			wantB:    8.5 - 59.0/3600.0,
		},
		{
			name:     "09:01:00签到+19:00:00签退(迟到且A扣晚饭B不扣)",
			in:       "09:01:00",
			out:      "19:00:00",
			wantLate: true,
			wantA:    8.0 - 60.0/3600.0,
			wantB:    8.5 - 60.0/3600.0,
		},
		{
			name:     "09:00:01签到+18:00:00签退(未超18:00则A=B)",
			in:       "09:00:01",
			out:      "18:00:00",
			wantLate: false,
			wantA:    26999.0 / 3600.0,
			wantB:    26999.0 / 3600.0,
		},
		{
			name:     "09:00:01签到+18:00:01签退(超18:00则A扣晚饭B不扣)",
			in:       "09:00:01",
			out:      "18:00:01",
			wantLate: false,
			wantA:    7.0,
			wantB:    7.5,
		},
		{
			name:     "09:30:00签到+18:00:00签退(未超18:00则A=B)",
			in:       "09:30:00",
			out:      "18:00:00",
			wantLate: true,
			wantA:    7.0,
			wantB:    7.0,
		},
		{
			name:     "09:30:00签到+18:00:01签退(超18:00则A扣晚饭B不扣)",
			in:       "09:30:00",
			out:      "18:00:01",
			wantLate: true,
			wantA:    6.5 + 1.0/3600.0,
			wantB:    7.0 + 1.0/3600.0,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if gotLate := IsLate(c.in); gotLate != c.wantLate {
				t.Errorf("IsLate(%q) = %v, want %v", c.in, gotLate, c.wantLate)
			}
			gotA, err := EffectiveHoursWithMode(c.in, c.out, ModeA)
			if err != nil {
				t.Fatalf("ModeA error: %v", err)
			}
			gotB, err := EffectiveHoursWithMode(c.in, c.out, ModeB)
			if err != nil {
				t.Fatalf("ModeB error: %v", err)
			}
			if !closeTo(gotA, c.wantA, 1e-9) {
				t.Errorf("ModeA(%q,%q) = %.9f, want %.9f", c.in, c.out, gotA, c.wantA)
			}
			if !closeTo(gotB, c.wantB, 1e-9) {
				t.Errorf("ModeB(%q,%q) = %.9f, want %.9f", c.in, c.out, gotB, c.wantB)
			}
		})
	}

	// 目标签退时间在 9:00 边界上的 ModeA vs ModeB 对比
	targetCases := []struct {
		in    string
		wantA string
		wantB string
	}{
		{"09:00:00", "19:00", "19:00"},
		{"09:00:01", "19:30", "19:00"},
		{"09:00:59", "19:30", "19:00"},
		{"09:01:00", "19:31", "19:01"},
	}
	for _, tc := range targetCases {
		t.Run("TargetSignOut_"+tc.in, func(t *testing.T) {
			gotA, err := TargetSignOutForWithMode(tc.in, StandardHours, ModeA)
			if err != nil {
				t.Fatalf("ModeA error: %v", err)
			}
			gotB, err := TargetSignOutForWithMode(tc.in, StandardHours, ModeB)
			if err != nil {
				t.Fatalf("ModeB error: %v", err)
			}
			if gotA != tc.wantA || gotB != tc.wantB {
				t.Errorf("in=%q: ModeA=%q (want %q), ModeB=%q (want %q)", tc.in, gotA, tc.wantA, gotB, tc.wantB)
			}
		})
	}
}

func TestBackwardCompatibilityWithModeA(t *testing.T) {
	pairs := [][2]string{
		{"08:00:00", "18:00:00"},
		{"08:55:44", "19:00:00"},
		{"09:00:00", "19:00:00"},
		{"09:00:01", "18:00:00"},
		{"09:00:01", "18:00:01"},
		{"09:00:59", "19:00:00"},
		{"09:01:00", "19:00:00"},
		{"09:30:00", ""},
		{"09:30:00", "09:00:00"},
	}
	for _, p := range pairs {
		gotLegacy, err1 := EffectiveHours(p[0], p[1])
		gotA, err2 := EffectiveHoursWithMode(p[0], p[1], ModeA)
		if (err1 != nil) != (err2 != nil) || !closeTo(gotLegacy, gotA, 1e-12) {
			t.Errorf("EffectiveHours(%q,%q) = (%v,%v), ModeA = (%v,%v)", p[0], p[1], gotLegacy, err1, gotA, err2)
		}
	}

	ins := []string{"07:30:00", "08:30:00", "09:00:00", "09:00:01", "09:01:00", "10:00:00"}
	for _, in := range ins {
		t1, e1 := TargetSignOut(in)
		t2, e2 := TargetSignOutForWithMode(in, StandardHours, ModeA)
		if (e1 != nil) != (e2 != nil) || t1 != t2 {
			t.Errorf("TargetSignOut(%q) = (%q,%v), ModeA = (%q,%v)", in, t1, e1, t2, e2)
		}
		for _, target := range []float64{EightHours, StandardHours, NineHours} {
			f1, fe1 := TargetSignOutFor(in, target)
			f2, fe2 := TargetSignOutForWithMode(in, target, ModeA)
			if (fe1 != nil) != (fe2 != nil) || f1 != f2 {
				t.Errorf("TargetSignOutFor(%q,%v) = (%q,%v), ModeA = (%q,%v)", in, target, f1, fe1, f2, fe2)
			}
			a1, ae1 := AvgTargetSignOut(in, 32, 4, target)
			a2, ae2 := AvgTargetSignOutWithMode(in, 32, 4, target, ModeA)
			if (ae1 != nil) != (ae2 != nil) || a1 != a2 {
				t.Errorf("AvgTargetSignOut(%q,%v) = (%q,%v), ModeA = (%q,%v)", in, target, a1, ae1, a2, ae2)
			}
		}
	}
}

func TestAdversarialCalcInputs(t *testing.T) {
	// 空白签退与异常签退早于签到
	for _, mode := range []CalcMode{"", ModeA, ModeB} {
		if got, err := EffectiveHoursWithMode("09:30:00", "   ", mode); err != nil || got != 0 {
			t.Errorf("empty whitespace out mode=%q: got (%v,%v), want (0,nil)", mode, got, err)
		}
		if got, err := EffectiveHoursWithMode("10:00:00", "09:00:00", mode); err != nil || got != 0 {
			t.Errorf("out<in mode=%q: got (%v,%v), want (0,nil)", mode, got, err)
		}
		if got, err := EffectiveHoursWithMode("09:30:00", "10:30:00", mode); err != nil || got != 0 {
			t.Errorf("elapsed<deduct mode=%q: got (%v,%v), want (0,nil)", mode, got, err)
		}
	}

	// 非法签到/签退时间
	badTimes := []string{"", "   ", "24:00:00", "09:60:00", "09:00:60", "abc", "09:00:00:00", "09"}
	for _, bt := range badTimes {
		if _, err := EffectiveHoursWithMode(bt, "18:00:00", ModeA); err == nil {
			t.Errorf("EffectiveHoursWithMode(bad in=%q) should error", bt)
		}
		if _, err := EffectiveHoursWithMode("09:00:00", bt, ModeB); bt != "" && bt != "   " && err == nil {
			t.Errorf("EffectiveHoursWithMode(bad out=%q) should error", bt)
		}
		if _, err := TargetSignOutForWithMode(bt, StandardHours, ModeB); err == nil {
			t.Errorf("TargetSignOutForWithMode(bad in=%q) should error", bt)
		}
	}

	// 非法 CalcMode（未经过 ParseCalcMode 的小写/空白/未知字符）
	for _, badMode := range []CalcMode{"a", "b", " A ", "C", "AB"} {
		if _, err := EffectiveHoursWithMode("09:00:00", "18:00:00", badMode); err == nil {
			t.Errorf("EffectiveHoursWithMode(%q) should error", badMode)
		}
		if _, err := TargetSignOutForWithMode("09:00:00", StandardHours, badMode); err == nil {
			t.Errorf("TargetSignOutForWithMode(%q) should error", badMode)
		}
		if _, err := AvgTargetSignOutWithMode("09:00:00", 17, 2, StandardHours, badMode); err == nil {
			t.Errorf("AvgTargetSignOutWithMode(%q) should error", badMode)
		}
	}

	// 早退下限 18:00 保护（ModeA 与 ModeB）
	for _, mode := range []CalcMode{ModeA, ModeB} {
		got, err := TargetSignOutForWithMode("07:00:00", StandardHours, mode)
		if err != nil || got != "18:00" {
			t.Errorf("early signIn floor mode=%q: got (%q,%v), want (18:00,nil)", mode, got, err)
		}
		got2, err := AvgTargetSignOutWithMode("08:00:00", 100, 5, StandardHours, mode)
		if err != nil || got2 != "18:00" {
			t.Errorf("avg 8h+18:00 floor mode=%q: got (%q,%v), want (18:00,nil)", mode, got2, err)
		}
	}

	// 跨天格式化
	gotA, err := TargetSignOutForWithMode("22:00:00", StandardHours, ModeA)
	if err != nil || gotA != "次日 08:30" {
		t.Errorf("cross midnight ModeA = (%q,%v), want 次日 08:30", gotA, err)
	}
	gotB, err := TargetSignOutForWithMode("22:00:00", StandardHours, ModeB)
	if err != nil || gotB != "次日 08:00" {
		t.Errorf("cross midnight ModeB = (%q,%v), want 次日 08:00", gotB, err)
	}

	// 浮点精度边界：连续两天工作 8h20m (08:30:00 -> 18:20:00, 30000s/天)，第 3 天需补足 8h50m (31800s) 达标 8.5h
	// 08:30:00 + 1.5h + 8h50m = 18:50
	dayHours, err := EffectiveHoursWithMode("08:30:00", "18:20:00", ModeA)
	if err != nil {
		t.Fatal(err)
	}
	sum2Days := dayHours + dayHours
	gotAvgOut, err := AvgTargetSignOutWithMode("08:30:00", sum2Days, 2, StandardHours, ModeA)
	if err != nil {
		t.Fatal(err)
	}
	if gotAvgOut != "18:50" {
		t.Errorf("AvgTargetSignOutWithMode float precision: sum2Days=%.17g -> got %q, want %q", sum2Days, gotAvgOut, "18:50")
	}
}
