// 工时计算规则（与 Go 端 internal/calc/hours.go 逐条移植）。
//
// 规则（与用户确认）：
//   - 签到时间 in <= 8:30：计薪起点 S = 8:30，扣午休 1.5h（早到不计额外工时）
//   - 8:30 < in <= 9:00：S = in，扣午休 1.5h
//   - in > 9:00：S = in，扣午休 1.5h，且仅当签退时间 out > 18:00 时额外扣晚饭 0.5h
//
// 达标工时 = 8.5h，用于计算当天目标签退时间。

export const STANDARD_HOURS = 8.5
export const EIGHT_HOURS = 8.0

// 各种时间阈值（以“自午夜起的秒数”表示）。
const startFloorSec = (8 * 60 + 30) * 60 // 8:30，早到计薪起点
const lateThresholdSec = 9 * 3600 // 9:00，工时计算里“9点后”扣晚饭的边界
const dinnerThreshold = 18 * 3600 // 18:00，签退超过才扣晚饭
const earliestSignOutSec = 18 * 3600 // 18:00，最早可签退时间（早于算早退）
const lunchBreakSec = 90 * 60 // 午休 12:00-13:30 = 1.5h
const dinnerBreakSec = 30 * 60 // 晚饭 18:00-18:30 = 0.5h

// lateGraceSec 迟到宽限秒数：9:00:00 起 59 秒内（即 9:00:59 及之前）不算“9点后”，
// 仅用于“迟到”标签，不影响工时计算里的晚饭扣除。
const lateGraceSec = 59

// parseClock 解析 "HH:MM:SS" 或 "HH:MM" 形式的时间，返回自午夜起的秒数。
// 格式非法时返回 null（前端数据异常按 0 处理，避免抛错中断页面）。
export function parseClock(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const parts = t.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isInteger(h) || h < 0 || h > 23) return null
  if (!Number.isInteger(m) || m < 0 || m > 59) return null
  let sec = 0
  if (parts.length === 3) {
    sec = Number(parts[2])
    if (!Number.isInteger(sec) || sec < 0 || sec > 59) return null
  }
  return h * 3600 + m * 60 + sec
}

// formatClock 将自午夜起的秒数格式化为 "HH:MM"。
export function formatClock(seconds: number): string {
  const s = ((seconds % 86400) + 86400) % 86400
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

// effectiveHours 计算某天有效工时（小时，浮点）。
//   in  签到时间 "HH:MM[:SS]"；out 签退时间，为空表示尚未签退（返回 0）。
export function effectiveHours(inTime: string, outTime: string): number {
  const inSec = parseClock(inTime)
  if (inSec == null) return 0
  const out = outTime.trim()
  if (out === '') return 0
  const outSec = parseClock(out)
  if (outSec == null) return 0

  // 计薪起点：早到封底在 8:30。
  let start = inSec
  if (inSec < startFloorSec) start = startFloorSec

  const elapsed = outSec - start
  if (elapsed < 0) {
    // 异常数据（签退早于计薪起点），按 0 处理。
    return 0
  }

  // 扣除午休（固定 1.5h）。
  let deduct = lunchBreakSec
  // 9 点后签到 且 18 点后签退，额外扣晚饭 0.5h。
  if (inSec > lateThresholdSec && outSec > dinnerThreshold) {
    deduct += dinnerBreakSec
  }

  const effective = elapsed - deduct
  return effective < 0 ? 0 : effective / 3600
}

// targetSignOut 计算当天目标签退时间，使有效工时达到达标工时（8.5h）。
export function targetSignOut(inTime: string): string {
  return targetSignOutFor(inTime, STANDARD_HOURS)
}

// targetSignOutFor 计算当天目标签退时间，使有效工时达到指定 targetHours。
// 规则（与 effectiveHours 一致，扣除项只取决于签到时间）：
//   - in <= 8:30 → 8:30 起步
//   - 8:30 < in <= 9:00 → in 起步，扣午休 1.5h
//   - in > 9:00 → in 起步，扣午休 1.5h + 晚饭 0.5h（此时目标签退必然 > 18:00）
export function targetSignOutFor(inTime: string, targetHours: number): string {
  const inSec = parseClock(inTime)
  if (inSec == null) return ''
  let start = inSec
  if (inSec < startFloorSec) start = startFloorSec

  const targetEffective = Math.round(targetHours * 3600)

  // 扣晚饭仅当 9 点后签到（此时目标签退必然 > 18:00）。
  let dinner = 0
  if (inSec > lateThresholdSec) dinner = dinnerBreakSec

  return formatClock(start + targetEffective + lunchBreakSec + dinner)
}

// avgTargetSignOut 计算使月平均工时达到 target 的最早签退时间。
//   sumHours 当月已完成天（不含今天）的有效工时总和；
//   doneDays 当月已完成天数（不含今天）。
// 今日需工时 need = target*(doneDays+1) - sumHours，且不得低于 8h：
//   - need 不足 8h 时按 8h 计（当日工时不得低于 8h）；
//   - 结果若早于 18:00 则取 18:00（早退下限）。
export function avgTargetSignOut(
  inTime: string,
  sumHours: number,
  doneDays: number,
  target: number,
): string {
  let need = target * (doneDays + 1) - sumHours
  // 当日工时不得低于 8h。
  if (need < EIGHT_HOURS) need = EIGHT_HOURS
  const out = targetSignOutFor(inTime, need)
  if (out === '') return ''
  const outSec = parseClock(out)
  if (outSec == null) return ''
  if (outSec < earliestSignOutSec) return formatClock(earliestSignOutSec)
  return out
}

// isLate 判断是否迟到：签到时间晚于 9:00:59（即 9:01:00 及以后）算迟到。
// 注意：仅用于“迟到”标签统计。工时计算里“9点后扣晚饭”的边界仍是 9:00:00（见 effectiveHours）。
export function isLate(inTime: string): boolean {
  const inSec = parseClock(inTime)
  if (inSec == null) return false
  return inSec > lateThresholdSec + lateGraceSec
}

// DayRecord 表示一天的考勤与工时。
export interface DayRecord {
  date: string // YYYY-MM-DD
  signIn: string // 签到时间 HH:MM:SS
  signOut: string // 签退时间 HH:MM:SS（可为空）
  hours: number // 有效工时
  leave: boolean // 是否请假天（请假天按 8h 计，无签退）
}

// averageHours 计算月平均工时：统计有签退数据的打卡天 + 请假天（8h），
// 无打卡且无请假的天（周末/未来/当天未签退）不计入分母。
export function averageHours(days: DayRecord[]): number {
  let sum = 0
  let n = 0
  for (const d of days) {
    if (d.signOut.trim() === '' && !d.leave) continue
    sum += d.hours
    n++
  }
  if (n === 0) return 0
  return sum / n
}