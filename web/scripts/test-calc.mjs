// TS 计算层与 Go 端双端一致性 & OaClient.fetchMonth 集成测试（Node 26 原生 TS type-stripping）。
// 运行方式：node web/scripts/test-calc.mjs  或  cd web && node scripts/test-calc.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EIGHT_HOURS,
  NINE_HOURS,
  STANDARD_HOURS,
  averageHours,
  avgTargetSignOut,
  effectiveHours,
  isLate,
  parseCalcMode,
  parseClock,
  targetSignOut,
  targetSignOutFor,
} from '../src/oa/calc.ts'
import { CookieJar, OaClient } from '../src/oa/client.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

// 调用真实 Go internal/calc 包执行同一组输入，验证双端一致性。
// 注意：Go 编译器禁止模块外部路径导入 internal/ 包，因此临时目录建在仓库根目录下并在 finally 立即清理。
function runGoCalcBatch(payload) {
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.oa-calc-parity-'))
  const goFile = path.join(tmpDir, 'main.go')
  const goCode = `package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/LanceHE6/oa-hours/internal/calc"
)

type EffCase struct {
	In   string        \`json:"in"\`
	Out  string        \`json:"out"\`
	Mode calc.CalcMode \`json:"mode"\`
}

type TargetCase struct {
	In     string        \`json:"in"\`
	Target float64       \`json:"target"\`
	Mode   calc.CalcMode \`json:"mode"\`
}

type AvgCase struct {
	In       string        \`json:"in"\`
	SumHours float64       \`json:"sumHours"\`
	DoneDays int           \`json:"doneDays"\`
	Target   float64       \`json:"target"\`
	Mode     calc.CalcMode \`json:"mode"\`
}

type Req struct {
	EffCases    []EffCase        \`json:"effCases"\`
	TargetCases []TargetCase     \`json:"targetCases"\`
	AvgCases    []AvgCase        \`json:"avgCases"\`
	LateIns     []string         \`json:"lateIns"\`
	AvgDays     [][]calc.DayRecord \`json:"avgDays"\`
}

type Resp struct {
	EffResults       []float64 \`json:"effResults"\`
	TargetResults    []string  \`json:"targetResults"\`
	TargetDefResults []string  \`json:"targetDefResults"\`
	AvgResults       []string  \`json:"avgResults"\`
	LateResults      []bool    \`json:"lateResults"\`
	AvgHoursResults  []float64 \`json:"avgHoursResults"\`
}

func main() {
	var req Req
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var resp Resp
	for _, c := range req.EffCases {
		h, err := calc.EffectiveHoursWithMode(c.In, c.Out, c.Mode)
		if err != nil {
			h = 0
		}
		resp.EffResults = append(resp.EffResults, h)
	}
	for _, c := range req.TargetCases {
		out, err := calc.TargetSignOutForWithMode(c.In, c.Target, c.Mode)
		if err != nil {
			out = ""
		}
		resp.TargetResults = append(resp.TargetResults, out)

		defOut, err := calc.TargetSignOutForWithMode(c.In, calc.StandardHours, c.Mode)
		if err != nil {
			defOut = ""
		}
		resp.TargetDefResults = append(resp.TargetDefResults, defOut)
	}
	for _, c := range req.AvgCases {
		out, err := calc.AvgTargetSignOutWithMode(c.In, c.SumHours, c.DoneDays, c.Target, c.Mode)
		if err != nil {
			out = ""
		}
		resp.AvgResults = append(resp.AvgResults, out)
	}
	for _, in := range req.LateIns {
		resp.LateResults = append(resp.LateResults, calc.IsLate(in))
	}
	for _, days := range req.AvgDays {
		resp.AvgHoursResults = append(resp.AvgHoursResults, calc.AverageHours(days))
	}
	_ = json.NewEncoder(os.Stdout).Encode(resp)
}
`
  try {
    fs.writeFileSync(goFile, goCode, 'utf8')
    const out = execFileSync('go', ['run', goFile], {
      cwd: repoRoot,
      input: JSON.stringify(payload),
      encoding: 'utf8',
    })
    return JSON.parse(out)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

test('parseCalcMode 容错与大小写空白处理', () => {
  assert.equal(parseCalcMode('A'), 'A')
  assert.equal(parseCalcMode('a'), 'A')
  assert.equal(parseCalcMode(' a '), 'A')
  assert.equal(parseCalcMode('B'), 'B')
  assert.equal(parseCalcMode('b'), 'B')
  assert.equal(parseCalcMode(' \tb\n '), 'B')
  assert.equal(parseCalcMode(''), 'A')
  assert.equal(parseCalcMode('   '), 'A')
  assert.equal(parseCalcMode(null), 'A')
  assert.equal(parseCalcMode(undefined), 'A')
  assert.equal(parseCalcMode('C'), 'A')
  assert.equal(parseCalcMode('invalid'), 'A')
})

test('parseClock 畸形时间拦截与合法格式解析', () => {
  assert.equal(parseClock('09:00'), 9 * 3600)
  assert.equal(parseClock(' 08:30:05 '), 8 * 3600 + 30 * 60 + 5)

  for (const bad of [
    '',
    '   ',
    '::',
    ':',
    ':30',
    '09:30:',
    '09::00',
    '+09:00',
    '-01:00',
    '09: 30',
    '09.5:00',
    '24:00',
    '09:60',
    '09:00:60',
    '09:00:00:00',
    'abc',
  ]) {
    assert.equal(parseClock(bad), null, `parseClock(${JSON.stringify(bad)}) 应返回 null`)
  }
})

test('TS 与 Go 双端计算函数一致性（全部边界样例）', () => {
  const effCases = [
    // 9:00 边界与晚饭边界
    { in: '08:00:00', out: '18:00:00', mode: 'A' },
    { in: '08:00:00', out: '18:00:00', mode: 'B' },
    { in: '08:55:44', out: '19:00:00', mode: 'A' },
    { in: '08:55:44', out: '19:00:00', mode: 'B' },
    { in: '09:00:00', out: '19:00:00', mode: 'A' },
    { in: '09:00:00', out: '19:00:00', mode: 'B' },
    { in: '09:00:01', out: '19:00:00', mode: 'A' },
    { in: '09:00:01', out: '19:00:00', mode: 'B' },
    { in: '09:00:59', out: '19:00:00', mode: 'A' },
    { in: '09:00:59', out: '19:00:00', mode: 'B' },
    { in: '09:01:00', out: '19:00:00', mode: 'A' },
    { in: '09:01:00', out: '19:00:00', mode: 'B' },
    // 18:00 边界
    { in: '09:00:01', out: '18:00:00', mode: 'A' },
    { in: '09:00:01', out: '18:00:00', mode: 'B' },
    { in: '09:00:01', out: '18:00:01', mode: 'A' },
    { in: '09:00:01', out: '18:00:01', mode: 'B' },
    { in: '09:30:00', out: '18:00:00', mode: 'A' },
    { in: '09:30:00', out: '18:00:00', mode: 'B' },
    { in: '09:30:00', out: '18:00:01', mode: 'A' },
    { in: '09:30:00', out: '18:00:01', mode: 'B' },
    // 异常/空值
    { in: '09:30:00', out: '', mode: 'A' },
    { in: '09:30:00', out: '   ', mode: 'B' },
    { in: '10:00:00', out: '09:00:00', mode: 'A' },
    { in: '09:30:00', out: '10:30:00', mode: 'B' },
    { in: 'bad', out: '18:00:00', mode: 'A' },
    { in: '09:00:00', out: '25:00:00', mode: 'B' },
  ]

  const targetCases = [
    { in: '07:00:00', target: STANDARD_HOURS, mode: 'A' },
    { in: '07:00:00', target: STANDARD_HOURS, mode: 'B' },
    { in: '08:00:00', target: EIGHT_HOURS, mode: 'A' },
    { in: '08:00:00', target: EIGHT_HOURS, mode: 'B' },
    { in: '08:55:44', target: STANDARD_HOURS, mode: 'A' },
    { in: '08:55:44', target: STANDARD_HOURS, mode: 'B' },
    { in: '09:00:00', target: STANDARD_HOURS, mode: 'A' },
    { in: '09:00:00', target: STANDARD_HOURS, mode: 'B' },
    { in: '09:00:01', target: STANDARD_HOURS, mode: 'A' },
    { in: '09:00:01', target: STANDARD_HOURS, mode: 'B' },
    { in: '09:00:59', target: STANDARD_HOURS, mode: 'A' },
    { in: '09:00:59', target: STANDARD_HOURS, mode: 'B' },
    { in: '09:01:00', target: STANDARD_HOURS, mode: 'A' },
    { in: '09:01:00', target: STANDARD_HOURS, mode: 'B' },
    { in: '09:01:18', target: NINE_HOURS, mode: 'A' },
    { in: '09:01:18', target: NINE_HOURS, mode: 'B' },
    { in: '22:00:00', target: STANDARD_HOURS, mode: 'A' },
    { in: '22:00:00', target: STANDARD_HOURS, mode: 'B' },
  ]

  const avgCases = [
    { in: '08:30:00', sumHours: 32, doneDays: 4, target: STANDARD_HOURS, mode: 'A' },
    { in: '08:30:00', sumHours: 32, doneDays: 4, target: STANDARD_HOURS, mode: 'B' },
    { in: '08:30:00', sumHours: 40, doneDays: 4, target: STANDARD_HOURS, mode: 'A' },
    { in: '08:30:00', sumHours: 50, doneDays: 4, target: STANDARD_HOURS, mode: 'B' },
    { in: '09:00:01', sumHours: 32, doneDays: 4, target: STANDARD_HOURS, mode: 'A' },
    { in: '09:00:01', sumHours: 32, doneDays: 4, target: STANDARD_HOURS, mode: 'B' },
    { in: '09:30:00', sumHours: 40, doneDays: 4, target: STANDARD_HOURS, mode: 'A' },
    { in: '09:30:00', sumHours: 40, doneDays: 4, target: STANDARD_HOURS, mode: 'B' },
    { in: '08:55:44', sumHours: 77.286, doneDays: 9, target: STANDARD_HOURS, mode: 'A' },
    { in: '08:55:44', sumHours: 77.286, doneDays: 9, target: STANDARD_HOURS, mode: 'B' },
  ]

  const lateIns = [
    '08:55:44',
    '08:59:59',
    '09:00:00',
    '09:00:01',
    '09:00:59',
    '09:01:00',
    '09:30:00',
    'invalid',
  ]

  const avgDays = [
    [],
    [
      { date: '2026-11-02', signIn: '09:00:01', signOut: '19:00:00', hours: 8.0 - 1 / 3600, leave: false },
      { date: '2026-11-03', signIn: '', signOut: '', hours: 8.0, leave: true },
      { date: '2026-11-04', signIn: '09:01:00', signOut: '19:00:00', hours: 8.0 - 60 / 3600, leave: false },
      { date: '2026-11-05', signIn: '09:00:01', signOut: '', hours: 0, leave: false },
    ],
  ]

  const go = runGoCalcBatch({
    effCases,
    targetCases,
    avgCases,
    lateIns,
    avgDays: avgDays.map((arr) =>
      arr.map((d) => ({
        Date: d.date,
        SignIn: d.signIn,
        SignOut: d.signOut,
        Hours: d.hours,
        Leave: d.leave,
      })),
    ),
  })

  effCases.forEach((c, i) => {
    const tsVal = effectiveHours(c.in, c.out, c.mode)
    assert.ok(
      Math.abs(tsVal - go.effResults[i]) <= 1e-12,
      `effectiveHours(${c.in}, ${c.out}, ${c.mode}): TS=${tsVal}, Go=${go.effResults[i]}`,
    )
  })

  targetCases.forEach((c, i) => {
    const tsVal = targetSignOutFor(c.in, c.target, c.mode)
    assert.equal(
      tsVal,
      go.targetResults[i],
      `targetSignOutFor(${c.in}, ${c.target}, ${c.mode}): TS=${tsVal}, Go=${go.targetResults[i]}`,
    )
    const tsDef = targetSignOut(c.in, c.mode)
    assert.equal(
      tsDef,
      go.targetDefResults[i],
      `targetSignOut(${c.in}, ${c.mode}): TS=${tsDef}, Go=${go.targetDefResults[i]}`,
    )
  })

  avgCases.forEach((c, i) => {
    const tsVal = avgTargetSignOut(c.in, c.sumHours, c.doneDays, c.target, c.mode)
    assert.equal(
      tsVal,
      go.avgResults[i],
      `avgTargetSignOut(${c.in}, ${c.sumHours}, ${c.doneDays}, ${c.target}, ${c.mode}): TS=${tsVal}, Go=${go.avgResults[i]}`,
    )
  })

  lateIns.forEach((inTime, i) => {
    assert.equal(isLate(inTime), go.lateResults[i], `isLate(${inTime})`)
  })

  avgDays.forEach((days, i) => {
    const tsAvg = averageHours(days)
    assert.ok(
      Math.abs(tsAvg - go.avgHoursResults[i]) <= 1e-12,
      `averageHours case ${i}: TS=${tsAvg}, Go=${go.avgHoursResults[i]}`,
    )
  })
})

test('TS 与 Go 浮点精度边界一致性（两天 8h20m 后第 3 天 avgTargetSignOut）', () => {
  const h = effectiveHours('08:30:00', '18:20:00', 'A')
  const sum2Days = h + h
  const tsVal = avgTargetSignOut('08:30:00', sum2Days, 2, STANDARD_HOURS, 'A')
  const go = runGoCalcBatch({
    effCases: [],
    targetCases: [],
    avgCases: [{ in: '08:30:00', sumHours: sum2Days, doneDays: 2, target: STANDARD_HOURS, mode: 'A' }],
    lateIns: [],
    avgDays: [],
  })
  assert.equal(tsVal, '18:50')
  assert.equal(
    go.avgResults[0],
    tsVal,
    `TS=${tsVal} vs Go=${go.avgResults[0]} (Go int()截断导致少 1 分钟)`,
  )
})

function detailHTML(dept, name, date, signIn, signOut) {
  return `<!DOCTYPE html><html><body><table>
<thead><tr><th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th></tr></thead>
<tbody><tr><td>${dept}</td><td>${name}</td><td>${date}</td><td>08:30-18:00</td><td>${signIn}</td><td>${signOut}</td></tr></tbody>
</table></body></html>`
}

function leaveHTML(name, leaveType) {
  return `<!DOCTYPE html><html><body>
<table><thead><tr><th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th></tr></thead><tbody></tbody></table>
<table><thead><tr><th>请求标题</th><th>姓名</th><th>开始时间</th><th>结束时间</th><th>审批状态</th><th>请假/外出天数</th><th>类型</th></tr></thead>
<tbody><tr><td><a href="#">请假申请</a></td><td>${name}</td><td>2026-01-01 08:30</td><td>2026-01-01 18:00</td><td>归档</td><td>1.0</td><td>${leaveType}</td></tr></tbody></table>
</body></html>`
}

test('OaClient.fetchMonth 在 Mode A / B 下的行为验证（仅 mock transport）', async () => {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const today = `${month}-${String(now.getDate()).padStart(2, '0')}`

  const nonToday = []
  for (let d = 1; d <= 28 && nonToday.length < 5; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`
    if (ds !== today) nonToday.push(ds)
  }
  const [dExact9, dGrace9, dLate9, dExact18, dLeave] = nonToday

  const jar = new CookieJar()
  const mockTransport = {
    getJar: () => jar,
    async postForm() {
      jar.apply(['loginidweaver=10086; Path=/'])
      return { status: 302, body: '', setCookies: ['loginidweaver=10086; Path=/'] }
    },
    async get(url) {
      const u = new URL(url)
      const curDate = u.searchParams.get('curDate')
      let body = '<html><body><table><thead><tr><th>部门</th></tr></thead><tbody></tbody></table></body></html>'
      if (curDate === dExact9) body = detailHTML('研发部', '王五', curDate, '09:00:00', '19:00:00')
      else if (curDate === dGrace9) body = detailHTML('研发部', '王五', curDate, '09:00:59', '19:00:00')
      else if (curDate === dLate9) body = detailHTML('研发部', '王五', curDate, '09:01:00', '19:00:00')
      else if (curDate === dExact18) body = detailHTML('研发部', '王五', curDate, '09:30:00', '18:00:00')
      else if (curDate === dLeave) body = leaveHTML('王五', '年休假')
      else if (curDate === today) body = detailHTML('研发部', '王五', curDate, '09:00:01', '')
      return { status: 200, body, setCookies: [] }
    },
  }

  const client = new OaClient('http://mock-oa.local', mockTransport)
  await client.login('wangwu', 'pw')

  const resA = await client.fetchMonth(month, 'A')
  const resB = await client.fetchMonth(month, 'B')
  // 非法 mode 字符串安全回退为 'A'
  const resFallback = await client.fetchMonth(month, 'INVALID')

  assert.equal(resA.mode, 'A')
  assert.equal(resB.mode, 'B')
  assert.equal(resFallback.mode, 'A')

  // 迟到与请假统计在两种模式下完全一致
  assert.equal(resA.lateDays, 2)
  assert.equal(resB.lateDays, 2)
  assert.equal(resA.leaveDays, 1)
  assert.equal(resB.leaveDays, 1)

  const byDateA = Object.fromEntries(resA.days.map((d) => [d.date, d]))
  const byDateB = Object.fromEntries(resB.days.map((d) => [d.date, d]))

  // 09:00:00 -> 19:00:00：A 与 B 均为 8.5h
  assert.ok(Math.abs(byDateA[dExact9].hours - 8.5) <= 1e-12)
  assert.ok(Math.abs(byDateB[dExact9].hours - 8.5) <= 1e-12)
  assert.equal(byDateA[dExact9].late, false)

  // 09:00:59 -> 19:00:00：不迟到，但 A 扣晚饭 B 不扣
  assert.equal(byDateA[dGrace9].late, false)
  assert.equal(byDateB[dGrace9].late, false)
  assert.ok(Math.abs(byDateA[dGrace9].hours - (8.0 - 59 / 3600)) <= 1e-12)
  assert.ok(Math.abs(byDateB[dGrace9].hours - (8.5 - 59 / 3600)) <= 1e-12)

  // 09:01:00 -> 19:00:00：迟到，A 扣晚饭 B 不扣
  assert.equal(byDateA[dLate9].late, true)
  assert.equal(byDateB[dLate9].late, true)
  assert.ok(Math.abs(byDateA[dLate9].hours - (8.0 - 60 / 3600)) <= 1e-12)
  assert.ok(Math.abs(byDateB[dLate9].hours - (8.5 - 60 / 3600)) <= 1e-12)

  // 09:30:00 -> 18:00:00：未超 18:00，A=B=7.0h
  assert.ok(Math.abs(byDateA[dExact18].hours - 7.0) <= 1e-12)
  assert.ok(Math.abs(byDateB[dExact18].hours - 7.0) <= 1e-12)

  // 请假天固定 8h
  assert.equal(byDateA[dLeave].leave, true)
  assert.equal(byDateA[dLeave].hours, 8.0)
  assert.equal(byDateB[dLeave].leave, true)
  assert.equal(byDateB[dLeave].hours, 8.0)

  // 汇总 totalHours 与 averageHours
  const expectedTotalA = 8.5 + (8.0 - 59 / 3600) + (8.0 - 60 / 3600) + 7.0 + 8.0
  const expectedTotalB = 8.5 + (8.5 - 59 / 3600) + (8.5 - 60 / 3600) + 7.0 + 8.0
  assert.ok(Math.abs(resA.totalHours - expectedTotalA) <= 1e-12)
  assert.ok(Math.abs(resB.totalHours - expectedTotalB) <= 1e-12)
  assert.ok(Math.abs(resA.averageHours - expectedTotalA / 5) <= 1e-12)
  assert.ok(Math.abs(resB.averageHours - expectedTotalB / 5) <= 1e-12)

  // 当天 09:00:01 签到 4 档签退时间：
  // ModeA: +2h 扣除; ModeB: +1.5h 扣除
  // 需补足: A need = 8.5*6 - expectedTotalA = 51 - (39.5 - 119/3600) = 11.5 + 119/3600 -> +11.5h + 2h + 09:00:01 = 22:32
  // B need = 8.5*6 - expectedTotalB = 51 - (40.5 - 119/3600) = 10.5 + 119/3600 -> +10.5h + 1.5h + 09:00:01 = 21:02
  const todayA = byDateA[today]
  const todayB = byDateB[today]
  assert.equal(todayA.late, false)
  assert.equal(todayA.nineSignOut, '20:00')
  assert.equal(todayA.targetSignOut, '19:30')
  assert.equal(todayA.recommendSignOut, '19:00')
  assert.equal(todayA.avgSignOut, '22:32')

  assert.equal(todayB.late, false)
  assert.equal(todayB.nineSignOut, '19:30')
  assert.equal(todayB.targetSignOut, '19:00')
  assert.equal(todayB.recommendSignOut, '18:30')
  assert.equal(todayB.avgSignOut, '21:02')
})
