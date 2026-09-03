// OA 直连客户端验证脚本（Node 26 原生 TS type-stripping）。
//
// 用法：
//   node scripts/verify-oa.mjs --account=<账号> --password=<密码> [--month=2026-08] [--go] [--go-url=http://127.0.0.1:20000]
//
// --go 时额外登录生产 Go 服务拉同一月数据，逐日对比（两种实现的正确性验证）。
// 账号密码仅本次命令行传入，不落盘。
import { OaClient } from '../src/oa/client.ts'

function arg(name, def = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}

const account = arg('account')
const password = arg('password')
const month = arg('month', '')
const withGo = process.argv.includes('--go')
const goUrl = arg('go-url', 'http://127.0.0.1:20000')

if (!account || !password) {
  console.error('缺少 --account / --password')
  process.exit(2)
}

async function main() {
  const client = new OaClient()
  console.log(`[1] 登录 OA: ${account} ...`)
  const rid = await client.login(account, password)
  console.log(`    登录成功 resourceId=${rid}`)

  const useMonth = month || new Date().toISOString().slice(0, 7)
  console.log(`[2] 拉取 ${useMonth} 月数据（直连 OA，并发拉取）...`)
  const t0 = Date.now()
  const res = await client.fetchMonth(useMonth)
  console.log(`    完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，共 ${res.days.length} 天`)

  console.log(`[3] TS 直连结果: 姓名=${res.name} 部门=${res.department}`)
  console.log(`    达标线=${res.standardHours}h 月平均=${res.averageHours.toFixed(2)}h 总工时=${res.totalHours.toFixed(2)}h 迟到=${res.lateDays}天 请假=${res.leaveDays}天`)
  const found = res.days.filter((d) => d.found)
  console.log(`    有数据 ${found.length} 天；样例(前3天有数据):`)
  for (const d of found.slice(0, 3)) {
    console.log(`      ${d.date} ${d.weekday} 签到=${d.signIn || '—'} 签退=${d.signOut || '—'} 工时=${d.hours.toFixed(2)}${d.leave ? ` 请假(${d.leaveType})` : ''}${d.late ? ' 迟到' : ''}`)
  }

  if (withGo) {
    console.log(`[4] 对比生产 Go 服务 (${goUrl}) 同一月数据 ...`)
    const loginResp = await fetch(`${goUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
    })
    if (!loginResp.ok) {
      const body = await loginResp.text()
      console.error(`    Go 服务登录失败: HTTP ${loginResp.status} ${body.slice(0, 120)}`)
      process.exit(1)
    }
    const cookie = loginResp.headers.getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const goResp = await fetch(`${goUrl}/api/month?month=${useMonth}`, { headers: { Cookie: cookie } })
    if (!goResp.ok) {
      console.error(`    Go 服务拉取失败: HTTP ${goResp.status}`)
      process.exit(1)
    }
    const go = await goResp.json()

    // 对比
    let diffCount = 0
    const diffs = []
    for (const d of res.days) {
      const g = go.days.find((x) => x.date === d.date)
      if (!g) { diffs.push(`${d.date}: Go 缺少该日`); diffCount++; continue }
      const fields = ['found', 'signIn', 'signOut', 'hours', 'late', 'leave', 'leaveType']
      for (const f of fields) {
        const a = d[f] ?? ''
        const b = g[f] ?? ''
        if (String(a) !== String(b)) {
          diffs.push(`${d.date}.${f}: TS=${JSON.stringify(a)} Go=${JSON.stringify(b)}`)
          diffCount++
        }
      }
      if (d.isToday !== g.isToday) { diffs.push(`${d.date}.isToday: TS=${d.isToday} Go=${g.isToday}`); diffCount++ }
    }
    for (const k of ['averageHours', 'totalHours', 'lateDays', 'leaveDays', 'standardHours']) {
      if (Math.abs((res[k] ?? 0) - (go[k] ?? 0)) > 1e-9) {
        diffs.push(`字段 ${k}: TS=${res[k]} Go=${go[k]}`)
        diffCount++
      }
    }
    if (res.name !== go.name) { diffs.push(`姓名: TS=${res.name} Go=${go.name}`); diffCount++ }
    // 今天的目标时间（targetSignOut 等，两者都只对“今天”计算）
    const tTs = res.days.find((d) => d.isToday)
    const tGo = go.days.find((d) => d.isToday)
    if (tTs && tGo) {
      for (const k of ['targetSignOut', 'recommendSignOut', 'avgSignOut']) {
        if ((tTs[k] ?? '') !== (tGo[k] ?? '')) {
          diffs.push(`今天 ${k}: TS=${tTs[k]} Go=${tGo[k]}`)
          diffCount++
        }
      }
    }
    if (diffCount === 0) {
      console.log('    结论: TS 直连与 Go 服务输出完全一致 ✅')
    } else {
      console.log(`    发现 ${diffCount} 处差异:`)
      for (const d of diffs.slice(0, 30)) console.log(`      - ${d}`)
      process.exit(1)
    }
  }
}

main().catch((err) => {
  console.error(`验证失败: ${err.message}`)
  process.exit(1)
})