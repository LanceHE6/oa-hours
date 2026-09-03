// OA 每日考勤明细页面的 HTML 解析（与 Go 端 internal/oa/parse.go 逐条移植）。

// tdRe 匹配 <td ...> 单元格文本 </td>（无嵌套标签的简单单元格）。
const tdRe = /<td[^>]*>\s*([^<]*?)\s*<\/td>/g

// leaveTdRe 匹配请假记录表的完整单元格（含嵌套标签，如请求标题里的 <a>）。
const leaveTdRe = /<td[^>]*>(.*?)<\/td>/gs

// stripTags 去除 HTML 标签，返回纯文本。
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

// OaDetail 是某天考勤明细的解析结果。
export interface OaDetail {
  department: string // 部门
  name: string // 姓名
  date: string // 日期 YYYY-MM-DD
  period: string // 工作时段，如 "08:30-18:00"
  signIn: string // 签到时间 HH:MM:SS
  signOut: string // 签退时间 HH:MM:SS（可为空，表示尚未签退）
  leave: boolean // 是否请假/外出天
  leaveType: string // 请假类型（年休假/事假/出差等）
}

// parseDetail 解析每日考勤明细接口返回的 HTML。
//
// 页面结构：考勤明细表（表头 部门/姓名/日期/工作时段/签到时间/签退时间），
// 数据行紧跟在该表 </thead> 之后的 <tbody> 内；考勤明细表之后才可能出现
// 「考勤流程 / 请假记录」等其它表。
//
// 关键：请假/年休假等天，考勤明细表的 <tbody> 为空（无打卡数据），
// 此时绝不能把后面请假记录表的单元格误当作考勤数据。
// 因此这里只解析考勤明细表自身的 <tbody>，为空即视为无打卡（found=false）。
export function parseDetail(html: string): { detail: OaDetail | null; found: boolean } {
  let idx = html.indexOf('签退时间')
  if (idx < 0) return { detail: null, found: false }
  const rest = html.slice(idx)

  // 考勤明细表表头结束。
  const theadEnd = rest.indexOf('</thead>')
  if (theadEnd < 0) return { detail: null, found: false }
  const after = rest.slice(theadEnd)

  // 考勤明细表自己的 <tbody>（紧跟 </thead> 之后、第一个 </tbody> 之前）。
  const tbodyStart = after.indexOf('<tbody>')
  if (tbodyStart < 0) return { detail: null, found: false }
  const tbodyEnd = after.indexOf('</tbody>', tbodyStart)
  if (tbodyEnd < 0) return { detail: null, found: false }
  const tbody = after.slice(tbodyStart, tbodyEnd)

  const matches = matchAll(tdRe, tbody).slice(0, 6)
  if (matches.length < 6) {
    // 请假/周末/无打卡：考勤表无数据行。
    return { detail: null, found: false }
  }

  return {
    detail: {
      department: matches[0][1].trim(),
      name: matches[1][1].trim(),
      date: matches[2][1].trim(),
      period: matches[3][1].trim(),
      signIn: matches[4][1].trim(),
      signOut: matches[5][1].trim(),
      leave: false,
      leaveType: '',
    },
    found: true,
  }
}

// parseLeave 解析每日明细页面的「考勤流程/请假记录」表，检测当天是否有请假/外出记录。
//
// 该表表头以「请假/外出天数」为标记（考勤明细表没有此表头，正常打卡天的页面也不含此表）。
// 列顺序：请求标题、姓名、开始时间、结束时间、审批状态、请假/外出天数、类型。
// 只要表里有数据行即视为“当天有请假记录”（所有类型都算）。
//
// 返回 (姓名, 请假类型, 是否有记录)。
export function parseLeave(html: string): { name: string; leaveType: string; found: boolean } {
  const idx = html.indexOf('请假/外出天数')
  if (idx < 0) return { name: '', leaveType: '', found: false }
  const rest = html.slice(idx)

  const tbodyStart = rest.indexOf('<tbody>')
  if (tbodyStart < 0) return { name: '', leaveType: '', found: false }
  const after = rest.slice(tbodyStart)
  const tbodyEnd = after.indexOf('</tbody>')
  if (tbodyEnd < 0) return { name: '', leaveType: '', found: false }
  const tbody = after.slice(0, tbodyEnd)

  const cells = matchAll(leaveTdRe, tbody)
  if (cells.length === 0) return { name: '', leaveType: '', found: false }
  // 类型是最后一列，但行末可能有一个空单元格（操作列占位），
  // 因此取“最后一个非空单元格”作为类型。
  let leaveType = ''
  for (let i = cells.length - 1; i >= 0; i--) {
    const t = stripTags(cells[i][1]).trim()
    if (t !== '') {
      leaveType = t
      break
    }
  }
  // 姓名是第二列（第一列“请求标题”含链接）。
  let name = ''
  if (cells.length >= 2) {
    name = stripTags(cells[1][1]).trim()
  }
  return { name, leaveType, found: true }
}

// matchAll 返回全部（含空结果跳过重叠）匹配的捕获组数组。
function matchAll(re: RegExp, s: string): string[][] {
  const out: string[][] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    out.push(Array.from(m))
    if (m[0] === '') re.lastIndex++ // 防死循环
  }
  return out
}