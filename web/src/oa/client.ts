// OA 直连客户端（与 Go 端 internal/oa/client.go + internal/server 的 handleMonth 移植）。
//
// transport 可插拔：
//   - FetchTransport：Node 验证脚本 / 浏览器调试（无 CORS 限制的环境）
//   - CapacitorTransport：Android App 内走 Capacitor 原生 HTTP，绕过 WebView 的 CORS 限制
//
// Cookie 由 CookieJar 统一管理（手动解析 Set-Cookie），两种 transport 行为一致。

import type { BuildInfo, DayStat, MonthResponse } from '../api.ts'
import { averageHours, effectiveHours, isLate, targetSignOut, targetSignOutFor, avgTargetSignOut, EIGHT_HOURS, STANDARD_HOURS, type DayRecord } from './calc.ts'
import { parseDetail, parseLeave, type OaDetail } from './parse.ts'

export const OA_BASE_URL = 'http://office.macrosan.com'
const LOGIN_PATH = '/login/VerifyLogin.jsp'
const DETAIL_PATH = '/hrm/report/schedulediff/HrmScheduleDiffMonthAttDateDetail.jsp'
const LOGIN_REDIRECT_MARKER = "location.href='/login/Login.jsp"
const FETCH_CONCURRENCY = 6
const RELOGIN_GRACE_MS = 5000

export interface OaResponse {
  status: number
  body: string
  setCookies: string[]
}

export interface OaTransport {
  get(url: string, headers?: Record<string, string>): Promise<OaResponse>
  postForm(url: string, data: Record<string, string>, headers?: Record<string, string>): Promise<OaResponse>
  /** 返回 transport 内部的 CookieJar（会话 cookie 统一由 transport 维护）。 */
  getJar(): CookieJar
}

// CookieJar 手动管理 OA 会话 Cookie。
export class CookieJar {
  private cookies = new Map<string, string>()

  apply(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const pair = header.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq > 0 && pair.length > eq + 1) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      } else if (eq > 0 && pair.length === eq + 1) {
        this.cookies.delete(pair.slice(0, eq).trim()) // 值为空视为删除
      }
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  get(name: string): string {
    return this.cookies.get(name) ?? ''
  }

  clear(): void {
    this.cookies.clear()
  }
}

// FetchTransport 基于标准 fetch（Node 18+ / 浏览器）。
export class FetchTransport implements OaTransport {
  private jar = new CookieJar()

  getJar(): CookieJar {
    return this.jar
  }

  private extractSetCookies(headers: Headers): string[] {
    // 直接调用保留 this 绑定（解构后调用会触发 Illegal invocation）。
    if (typeof (headers as { getSetCookie?: unknown }).getSetCookie === 'function') {
      return (headers as { getSetCookie: () => string[] }).getSetCookie()
    }
    const sc = headers.get('set-cookie')
    return sc ? [sc] : []
  }

  private async request(url: string, init: RequestInit & { data?: string }): Promise<OaResponse> {
    const headers = new Headers(init.headers as HeadersInit | undefined)
    const jarHeader = this.jar.header()
    if (jarHeader) headers.set('Cookie', jarHeader)
    // 与 Go 端 CheckRedirect: ErrUseLastResponse 对齐：不跟随重定向，
    // 只取第一跳响应的 Set-Cookie（OA 登录成功标志 loginidweaver 就落在 302 第一跳上，
    // follow 会改到最后一跳而丢掉它）。
    const resp = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.data,
      redirect: 'manual',
    })
    const setCookies = this.extractSetCookies(resp.headers)
    this.jar.apply(setCookies)
    return { status: resp.status, body: await resp.text(), setCookies }
  }

  async get(url: string, headers?: Record<string, string>): Promise<OaResponse> {
    return this.request(url, { headers })
  }

  async postForm(url: string, data: Record<string, string>): Promise<OaResponse> {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams(data).toString(),
    })
  }
}

// CapacitorTransport 走 Capacitor 原生 HTTP（Android WebView 内绕过 CORS）。
export class CapacitorTransport implements OaTransport {
  private jar = new CookieJar()

  getJar(): CookieJar {
    return this.jar
  }

  private extractSetCookies(headers: Record<string, unknown>): string[] {
    // 键大小写不敏感：Android 原生返回的 header 键保留原始大小写（Set-Cookie），
    // 而 Node/undici 的 Headers 键是小写；两者都要能取到。
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie')
    const sc = key ? headers[key] : undefined
    if (Array.isArray(sc)) return sc as string[]
    // 原生层会把多个 Set-Cookie 用 ", " 拼成一个字符串，按 "名字=值" 边界切回多条。
    if (typeof sc === 'string') return sc.split(/,(?=\s*\w+=)/)
    return []
  }

  private async request(url: string, method: 'GET' | 'POST', headers: Record<string, string>, data?: string): Promise<OaResponse> {
    const { CapacitorHttp } = await import('@capacitor/core')
    const jarHeader = this.jar.header()
    const allHeaders: Record<string, string> = { ...headers }
    if (jarHeader) allHeaders.Cookie = jarHeader
    const res = await CapacitorHttp.request({
      url,
      method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', ...allHeaders },
      data,
    })
    const setCookies = this.extractSetCookies(res.headers as Record<string, unknown>)
    this.jar.apply(setCookies)
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return { status: res.status, body, setCookies }
  }

  async get(url: string, headers?: Record<string, string>): Promise<OaResponse> {
    return this.request(url, 'GET', headers ?? {})
  }

  async postForm(url: string, data: Record<string, string>): Promise<OaResponse> {
    return this.request(url, 'POST', { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams(data).toString())
  }
}

// OaClient 直连 OA 的客户端（登录/明细/月统计/会话过期自动重登）。
export class OaClient {
  private transport: OaTransport
  readonly baseURL: string

  private resourceId = ''
  private account = ''
  private password = ''
  private lastLogin = 0

  constructor(baseURL = OA_BASE_URL, transport: OaTransport = new FetchTransport()) {
    this.baseURL = baseURL.replace(/\/+$/, '')
    this.transport = transport
  }

  /** 登录 OA，成功返回 resourceId（loginidweaver cookie，纯数字）。 */
  async login(account: string, password: string): Promise<string> {
    const form: Record<string, string> = {
      loginfile: '/wui/theme/ecology8/page/login.jsp?templateId=3&logintype=1&gopage=',
      logintype: '1',
      fontName: '微软雅黑',
      message: '',
      gopage: '',
      formmethod: 'get',
      isie: '',
      islanguid: '7',
      loginid: account,
      userpassword: password,
      tokenAuthKey: '',
    }
    // 登录成功后，OA 在 200 响应里依次写入 loginidweaver=<账号>、loginidweaver=<数字resourceId>，
    // 后者覆盖前者；cookie 由 transport 的 jar 收集，这里从同一 jar 读取。
    const resp = await this.transport.postForm(this.baseURL + LOGIN_PATH, form)
    const rid = this.transport.getJar().get('loginidweaver')
    if (!/^\d+$/.test(rid)) {
      throw new Error(`登录失败：账号或密码错误（HTTP ${resp.status}）`)
    }
    this.resourceId = rid
    this.account = account
    this.password = password
    this.lastLogin = Date.now()
    return rid
  }

  /** 会话是否已登录（内存中已取得 resourceId）。 */
  isLoggedIn(): boolean {
    return this.resourceId !== ''
  }

  /** 登出：清除内存会话与 Cookie（OA 无独立登出接口）。 */
  logout(): void {
    this.transport.getJar().clear()
    this.resourceId = ''
    this.account = ''
    this.password = ''
    this.lastLogin = 0
  }

  /** 使用已保存的凭据重新登录（带去重，避免并发重复登录）。 */
  private async relogin(): Promise<void> {
    if (this.account === '' || this.password === '') {
      throw new Error('缺少凭据，无法自动重新登录')
    }
    // 刚重登过（并发 worker 同时触发），直接复用，不再重复登录。
    if (Date.now() - this.lastLogin < RELOGIN_GRACE_MS) return
    await this.login(this.account, this.password)
  }

  /**
   * 拉取某天（YYYY-MM-DD）的考勤明细。
   * 返回 null 表示该天无数据（周末/未来）。
   * 有打卡返回考勤明细；无打卡但有请假记录返回请假明细（leave=true）。
   * 会话过期时自动用保存的凭据重登并重试一次。
   */
  async fetchDayDetail(date: string): Promise<OaDetail | null> {
    let body = await this.fetchDetailOnce(date)
    if (body.includes(LOGIN_REDIRECT_MARKER)) {
      // 会话过期，自动重登后重试一次。
      await this.relogin()
      body = await this.fetchDetailOnce(date)
      if (body.includes(LOGIN_REDIRECT_MARKER)) {
        throw new Error('会话已过期，重登后仍失败')
      }
    }
    // 优先检测请假：只要当天有请假/外出记录，就按请假（8h）算，忽略打卡。
    const leave = parseLeave(body)
    if (leave.found) {
      return { department: '', name: leave.name, date, period: '', signIn: '', signOut: '', leave: true, leaveType: leave.leaveType }
    }
    const parsed = parseDetail(body)
    if (parsed.found && parsed.detail) {
      return parsed.detail
    }
    return null
  }

  private async fetchDetailOnce(date: string): Promise<string> {
    const url = `${this.baseURL}${DETAIL_PATH}?isdialog=1&curDate=${encodeURIComponent(date)}&resourceId=${encodeURIComponent(this.resourceId)}&status=8&fromHrmDialogTab=1`
    return (await this.transport.get(url)).body
  }

  /** 拉取某月（YYYY-MM）每天的考勤明细并计算工时（并发 6 拉取）。返回与 Web 版一致的 MonthResponse。 */
  async fetchMonth(month: string): Promise<MonthResponse> {
    const match = /^(\d{4})-(\d{2})$/.exec(month)
    if (!match) throw new Error(`月份格式错误 ${month}`)
    const year = Number(match[1])
    const mon = Number(match[2])
    const days = new Date(year, mon, 0).getDate()
    const today = todayStr()

    const stats: DayStat[] = new Array<DayStat>(days)
    let name = ''
    let department = ''
    let next = 1

    const worker = async () => {
      for (;;) {
        const d = next++
        if (d > days) return
        const date = `${month}-${String(d).padStart(2, '0')}`
        const ds: DayStat = {
          date,
          weekday: weekdayCN[new Date(year, mon - 1, d).getDay()],
          signIn: '',
          signOut: '',
          hours: 0,
          found: false,
          late: false,
          leave: false,
          isToday: date === today,
        }
        const detail = await this.fetchDayDetail(date)
        if (detail) {
          ds.found = true
          if (detail.leave) {
            // 请假/外出天：统一按 8h 计，不管请假时长。
            ds.leave = true
            ds.leaveType = detail.leaveType
            ds.hours = 8.0
          } else {
            ds.signIn = detail.signIn
            ds.signOut = detail.signOut
            ds.hours = effectiveHours(detail.signIn, detail.signOut)
            ds.late = isLate(detail.signIn)
          }
          if (name === '') {
            name = detail.name
            department = detail.department
          }
        }
        stats[d - 1] = ds
      }
    }
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()))

    // 统计迟到/请假天数，并计算月平均工时（打卡天 + 请假天 8h，不含今天）。
    let lateDays = 0
    let leaveDays = 0
    const records: DayRecord[] = []
    let sumHours = 0
    let doneCount = 0
    for (const d of stats) {
      if (d.late) lateDays++
      if (d.leave) leaveDays++
      if (d.found && d.date !== today) {
        records.push({ date: d.date, signIn: d.signIn, signOut: d.signOut, hours: d.hours, leave: d.leave })
      }
      if (d.date !== today && (d.leave || d.signOut !== '')) {
        sumHours += d.hours
        doneCount++
      }
    }
    const average = averageHours(records)

    // 当天：只要已签到，就计算三种目标工时的签退时间（8.5h / 8h / 平均工时）。
    for (const d of stats) {
      if (d.isToday && d.found && d.signIn !== '') {
        d.targetSignOut = targetSignOut(d.signIn) || undefined
        d.recommendSignOut = targetSignOutFor(d.signIn, EIGHT_HOURS) || undefined
        d.avgSignOut = avgTargetSignOut(d.signIn, sumHours, doneCount, STANDARD_HOURS) || undefined
      }
    }

    return {
      month,
      name,
      department,
      standardHours: STANDARD_HOURS,
      averageHours: average,
      totalHours: sumHours,
      lateDays,
      leaveDays,
      today,
      days: stats,
    }
  }
}

const weekdayCN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface DirectDataSource {
  client: OaClient
  appInfo: BuildInfo
}

// buildDirectSource 创建直连数据源（App 模式入口）。
// transport 参数供测试注入；默认按运行环境选择 Capacitor/Fetch。
export function buildDirectSource(transport?: OaTransport): DirectDataSource {
  const isNative =
    typeof window !== 'undefined' &&
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true
  const t = transport ?? (isNative ? new CapacitorTransport() : new FetchTransport())
  return {
    client: new OaClient(OA_BASE_URL, t),
    appInfo: { author: 'Hycer', buildTime: 'Android v1.0.0' },
  }
}