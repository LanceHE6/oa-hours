export interface DayStat {
  date: string
  weekday: string
  signIn: string
  signOut: string
  hours: number
  found: boolean
  late: boolean
  isToday: boolean
  targetSignOut?: string
}

export interface MonthResponse {
  month: string
  name: string
  department: string
  standardHours: number
  averageHours: number
  lateDays: number
  today: string
  days: DayStat[]
}

export interface AuthResponse {
  loggedIn: boolean
  account?: string
  resourceId?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg = (data as { error?: string }).error || `请求失败（HTTP ${resp.status}）`
    throw new Error(msg)
  }
  return data as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
