// 数据源抽象：组件层不感知数据来源。
//   WebProvider：浏览器模式，走自家 Go 服务的 /api（桌面 Web / 手机浏览器预览）
//   DirectProvider：App 模式，直连 OA（登录/会话/工时计算全部在本地）
// 按运行环境自动选择（Capacitor.isNativePlatform()）。

import { Capacitor } from '@capacitor/core'
import type { AuthResponse, BuildInfo, MonthResponse } from './api'
import { apiGet, apiPost } from './api'
import { buildDirectSource, OaClient } from './oa/client'
import { effectiveHours } from './oa/calc'

export interface DataProvider {
  login(account: string, password: string): Promise<void>
  logout(): Promise<void>
  isLoggedIn(): Promise<boolean>
  getMonth(month: string): Promise<MonthResponse>
  calcHours(signIn: string, signOut: string): Promise<{ hours: number }>
  getBuildInfo(): Promise<BuildInfo>
}

// Web 模式：调用自家 Go 服务 /api（CORS 由同源解决）。
export class WebProvider implements DataProvider {
  async login(account: string, password: string): Promise<void> {
    await apiPost('/api/login', { account, password })
  }

  async logout(): Promise<void> {
    await apiPost('/api/logout', {})
  }

  async isLoggedIn(): Promise<boolean> {
    return (await apiGet<AuthResponse>('/api/auth')).loggedIn
  }

  async getMonth(month: string): Promise<MonthResponse> {
    return apiGet<MonthResponse>(`/api/month?month=${month}`)
  }

  async calcHours(signIn: string, signOut: string): Promise<{ hours: number }> {
    return apiGet<{ hours: number }>(`/api/calc?signIn=${encodeURIComponent(signIn)}&signOut=${encodeURIComponent(signOut)}`)
  }

  async getBuildInfo(): Promise<BuildInfo> {
    return apiGet<BuildInfo>('/api/buildinfo')
  }
}

// App 模式：本地直连 OA（OaClient 持有会话与凭据，会话过期自动重登）。
export class DirectProvider implements DataProvider {
  readonly client: OaClient
  private info: BuildInfo

  constructor(client: OaClient, info: BuildInfo) {
    this.client = client
    this.info = info
  }

  async login(account: string, password: string): Promise<void> {
    await this.client.login(account, password)
  }

  async logout(): Promise<void> {
    this.client.logout()
  }

  async isLoggedIn(): Promise<boolean> {
    return this.client.isLoggedIn()
  }

  async getMonth(month: string): Promise<MonthResponse> {
    return this.client.fetchMonth(month)
  }

  async calcHours(signIn: string, signOut: string): Promise<{ hours: number }> {
    return { hours: effectiveHours(signIn, signOut) }
  }

  async getBuildInfo(): Promise<BuildInfo> {
    return this.info
  }
}

// createProvider 按运行环境创建数据源（应用启动时调用一次并复用）。
export function createProvider(): DataProvider {
  if (Capacitor.isNativePlatform()) {
    const src = buildDirectSource()
    return new DirectProvider(src.client, src.appInfo)
  }
  return new WebProvider()
}