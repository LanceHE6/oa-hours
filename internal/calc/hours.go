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

	// EightHours 8 小时目标工时选项（小时）。
	EightHours = 8.0

	// 各种时间阈值（以“自午夜起的秒数”表示）。
	startFloorSec      = (8*60 + 30) * 60 // 8:30，早到计薪起点
	lateThresholdSec   = 9 * 3600         // 9:00，工时计算里“9点后”扣晚饭的边界
	dinnerThreshold    = 18 * 3600        // 18:00，签退超过才扣晚饭
	earliestSignOutSec = 18 * 3600        // 18:00，最早可签退时间（早于算早退）
	lunchBreakSec      = 90 * 60          // 午休 12:00-13:30 = 1.5h
	dinnerBreakSec     = 30 * 60          // 晚饭 18:00-18:30 = 0.5h

	// lateGraceSec 迟到宽限秒数：9:00:00 起 59 秒内（即 9:00:59 及之前）不算“9点后”，
	// 仅用于“迟到”标签，不影响工时计算里的晚饭扣除。
	lateGraceSec = 59
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

// TargetSignOut 计算当天目标签退时间，使有效工时达到 StandardHours（8.5h）。
func TargetSignOut(in string) (string, error) {
	return TargetSignOutFor(in, StandardHours)
}

// TargetSignOutFor 计算当天目标签退时间，使有效工时达到指定 targetHours。
//
// 规则（与 EffectiveHours 一致，扣除项只取决于签到时间）：
//   - in <= 8:30 → 8:30 起步
//   - 8:30 < in <= 9:00 → in 起步，扣午休 1.5h
//   - in > 9:00 → in 起步，扣午休 1.5h + 晚饭 0.5h（此时目标签退必然 > 18:00）
func TargetSignOutFor(in string, targetHours float64) (string, error) {
	inSec, err := ParseClock(in)
	if err != nil {
		return "", fmt.Errorf("签到时间: %w", err)
	}

	start := inSec
	if inSec < startFloorSec {
		start = startFloorSec
	}

	targetEffective := int(targetHours * 3600)

	// 扣晚饭仅当 9 点后签到（此时目标签退必然 > 18:00）。
	dinner := 0
	if inSec > lateThresholdSec {
		dinner = dinnerBreakSec
	}

	outSec := start + targetEffective + lunchBreakSec + dinner
	return FormatClock(outSec), nil
}

// AvgTargetSignOut 计算使月平均工时达到 target 的最早签退时间（不早于 18:00）。
//
//	sumHours 当月已完成天（不含今天）的有效工时总和；
//	doneDays 当月已完成天数（不含今天）。
//
// 今日需工时 need = target*(doneDays+1) - sumHours：
//   - need <= 0（平均已达标）：最早下班 18:00；
//   - 否则按 need 反推签退时间，若早于 18:00 则取 18:00（早退下限）。
func AvgTargetSignOut(in string, sumHours float64, doneDays int, target float64) (string, error) {
	need := target*float64(doneDays+1) - sumHours
	if need <= 0 {
		return FormatClock(earliestSignOutSec), nil
	}
	out, err := TargetSignOutFor(in, need)
	if err != nil {
		return "", err
	}
	outSec, err := ParseClock(out)
	if err != nil {
		return "", err
	}
	if outSec < earliestSignOutSec {
		return FormatClock(earliestSignOutSec), nil
	}
	return out, nil
}

// IsLate 判断是否迟到：签到时间晚于 9:00:59（即 9:01:00 及以后）算迟到。
//
// 注意：仅用于“迟到”标签统计。工时计算里“9点后扣晚饭”的边界仍是 9:00:00（见 EffectiveHours）。
func IsLate(in string) bool {
	inSec, err := ParseClock(in)
	if err != nil {
		return false
	}
	return inSec > lateThresholdSec+lateGraceSec
}

// DayRecord 表示一天的考勤与工时。
type DayRecord struct {
	Date    string  // YYYY-MM-DD
	SignIn  string  // 签到时间 HH:MM:SS
	SignOut string  // 签退时间 HH:MM:SS（可为空）
	Hours   float64 // 有效工时
	Leave   bool    // 是否请假天（请假天按 8h 计，无签退）
}

// AverageHours 计算月平均工时：统计有签退数据的打卡天 + 请假天（8h），
// 无打卡且无请假的天（周末/未来/当天未签退）不计入分母。
func AverageHours(days []DayRecord) float64 {
	var sum float64
	var n int
	for _, d := range days {
		if strings.TrimSpace(d.SignOut) == "" && !d.Leave {
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
