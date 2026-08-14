/** 将小时数格式化为 "8.50h"。 */
export function formatHours(h: number): string {
  return `${h.toFixed(2)}h`
}

/** 将小时数格式化为 "8h30m"。 */
export function hoursToHm(h: number): string {
  const totalMin = Math.round(h * 60)
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return mm === 0 ? `${hh}h` : `${hh}h${mm}m`
}

/** 将 "HH:MM:SS" 或 "HH:MM" 截断为 "HH:MM"。 */
export function shortTime(t?: string): string {
  if (!t) return '—'
  const parts = t.split(':')
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : t
}
