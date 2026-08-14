// Package calc 实现工时计算规则（纯函数，无外部依赖，便于单元测试）。
//
// 规则（与用户确认）：
//   - 签到时间 in <= 8:30：计薪起点 S = 8:30，扣午休 1.5h（早到不计额外工时）
//   - 8:30 < in <= 9:00：S = in，扣午休 1.5h
//   - in > 9:00：S = in，扣午休 1.5h，且仅当签退时间 out > 18:00 时额外扣晚饭 0.5h
//
// 达标工时 = 8.5h，用于计算当天目标签退时间。
package calc

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	// StandardHours 达标工时（小时）。
	StandardHours = 8.5

	// 各种时间阈值（以“自午夜起的秒数”表示）。
	startFloorSec    = (8*60 + 30) * 60 // 8:30，早到计薪起点
	lateThresholdSec = 9 * 3600         // 9:00，判定“迟到”从而可能扣晚饭
	dinnerThreshold  = 18 * 3600        // 18:00，签退超过才扣晚饭
	lunchBreakSec    = 90 * 60          // 午休 12:00-13:30 = 1.5h
	dinnerBreakSec   = 30 * 60          // 晚饭 18:00-18:30 = 0.5h
)

// ParseClock 解析 "HH:MM:SS" 或 "HH:MM" 形式的时间，返回自午夜起的秒数。
func ParseClock(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty time")
	}
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, fmt.Errorf("invalid time format %q", s)
	}
	h, err := strconv.Atoi(parts[0])
	if err != nil || h < 0 || h > 23 {
		return 0, fmt.Errorf("invalid hour in %q", s)
	}
	m, err := strconv.Atoi(parts[1])
	if err != nil || m < 0 || m > 59 {
		return 0, fmt.Errorf("invalid minute in %q", s)
	}
	sec := 0
	if len(parts) == 3 {
		sec, err = strconv.Atoi(parts[2])
		if err != nil || sec < 0 || sec > 59 {
			return 0, fmt.Errorf("invalid second in %q", s)
		}
	}
	return h*3600 + m*60 + sec, nil
}

// FormatClock 将自午夜起的秒数格式化为 "HH:MM"。
func FormatClock(seconds int) string {
	seconds = ((seconds % (24 * 3600)) + 24*3600) % (24 * 3600)
	return fmt.Sprintf("%02d:%02d", seconds/3600, (seconds%3600)/60)
}

// EffectiveHours 计算某天有效工时（小时，浮点，保留秒级精度）。
//
//	in  签到时间 "HH:MM[:SS]"
//	out 签退时间 "HH:MM[:SS]"，为空表示尚未签退（返回 0）
//
// 返回 (有效工时小时数, error)。out 为空时不报错，返回 (0, nil)。
func EffectiveHours(in, out string) (float64, error) {
	inSec, err := ParseClock(in)
	if err != nil {
		return 0, fmt.Errorf("签到时间: %w", err)
	}
	if strings.TrimSpace(out) == "" {
		return 0, nil
	}
	outSec, err := ParseClock(out)
	if err != nil {
		return 0, fmt.Errorf("签退时间: %w", err)
	}

	// 计薪起点：早到封底在 8:30。
	start := inSec
	if inSec < startFloorSec {
		start = startFloorSec
	}

	elapsed := outSec - start
	if elapsed < 0 {
		// 异常数据（签退早于计薪起点），按 0 处理。
		return 0, nil
	}

	// 扣除午休（固定 1.5h）。
	deduct := lunchBreakSec
	// 9 点后签到 且 18 点后签退，额外扣晚饭 0.5h。
	if inSec > lateThresholdSec && outSec > dinnerThreshold {
		deduct += dinnerBreakSec
	}

	effective := elapsed - deduct
	if effective < 0 {
		effective = 0
	}
	return float64(effective) / 3600.0, nil
}

// TargetSignOut 计算当天目标签退时间，使有效工时达到 StandardHours。
//
//	in 签到时间 "HH:MM[:SS]"
//
// 规则：
//   - in <= 8:30 → 18:30
//   - 8:30 < in <= 9:00 → in + 10h
//   - in > 9:00 → in + 10.5h
func TargetSignOut(in string) (string, error) {
	inSec, err := ParseClock(in)
	if err != nil {
		return "", fmt.Errorf("签到时间: %w", err)
	}

	start := inSec
	if inSec < startFloorSec {
		start = startFloorSec
	}

	// 目标有效秒数 = 8.5h。
	targetEffective := int(StandardHours * 3600)

	// 扣晚饭仅当 9 点后签到（此时目标签退必然 > 18:00）。
	dinner := 0
	if inSec > lateThresholdSec {
		dinner = dinnerBreakSec
	}

	outSec := start + targetEffective + lunchBreakSec + dinner
	return FormatClock(outSec), nil
}

// IsLate 判断签到时间是否晚于 9:00（视为迟到）。9:00 整不算迟到。
func IsLate(in string) bool {
	inSec, err := ParseClock(in)
	if err != nil {
		return false
	}
	return inSec > lateThresholdSec
}

// DayRecord 表示一天的考勤与工时。
type DayRecord struct {
	Date    string  // YYYY-MM-DD
	SignIn  string  // 签到时间 HH:MM:SS
	SignOut string  // 签退时间 HH:MM:SS（可为空）
	Hours   float64 // 有效工时
}

// AverageHours 计算月平均工时：只对有签退数据的天求平均，无打卡天不计入分母。
func AverageHours(days []DayRecord) float64 {
	var sum float64
	var n int
	for _, d := range days {
		if strings.TrimSpace(d.SignOut) == "" {
			continue
		}
		sum += d.Hours
		n++
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// Now 供测试注入当前时间用（生产环境为 time.Now）。
var Now = time.Now
