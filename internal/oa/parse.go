package oa

import (
	"regexp"
	"strings"
)

// tdRe 匹配 <td ...> 单元格文本 </td>。
var tdRe = regexp.MustCompile(`<td[^>]*>\s*([^<]*?)\s*</td>`)

// leaveTdRe 匹配请假记录表的完整单元格（含嵌套标签，如请求标题里的 <a>）。
var leaveTdRe = regexp.MustCompile(`(?s)<td[^>]*>(.*?)</td>`)

// stripTags 去除 HTML 标签，返回纯文本。
func stripTags(s string) string {
	return regexp.MustCompile(`<[^>]*>`).ReplaceAllString(s, "")
}

// Detail 是某天考勤明细的解析结果。
type Detail struct {
	Department string // 部门
	Name       string // 姓名
	Date       string // 日期 YYYY-MM-DD
	Period     string // 工作时段，如 "08:30-18:00"
	SignIn     string // 签到时间 HH:MM:SS
	SignOut    string // 签退时间 HH:MM:SS（可为空，表示尚未签退）
	Leave      bool   // 是否请假/外出天
	LeaveType  string // 请假类型（年休假/事假/出差等）
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
func parseDetail(html string) (d Detail, found bool) {
	idx := strings.Index(html, "签退时间")
	if idx < 0 {
		return Detail{}, false
	}
	rest := html[idx:]

	// 考勤明细表表头结束。
	theadEnd := strings.Index(rest, "</thead>")
	if theadEnd < 0 {
		return Detail{}, false
	}
	after := rest[theadEnd:]

	// 考勤明细表自己的 <tbody>（紧跟 </thead> 之后、第一个 </tbody> 之前）。
	tbodyStart := strings.Index(after, "<tbody>")
	if tbodyStart < 0 {
		return Detail{}, false
	}
	tbodyEnd := strings.Index(after[tbodyStart:], "</tbody>")
	if tbodyEnd < 0 {
		return Detail{}, false
	}
	tbody := after[tbodyStart : tbodyStart+tbodyEnd]

	matches := tdRe.FindAllStringSubmatch(tbody, 6)
	if len(matches) < 6 {
		// 请假/周末/无打卡：考勤表无数据行。
		return Detail{}, false
	}

	return Detail{
		Department: strings.TrimSpace(matches[0][1]),
		Name:       strings.TrimSpace(matches[1][1]),
		Date:       strings.TrimSpace(matches[2][1]),
		Period:     strings.TrimSpace(matches[3][1]),
		SignIn:     strings.TrimSpace(matches[4][1]),
		SignOut:    strings.TrimSpace(matches[5][1]),
	}, true
}

// parseLeave 解析每日明细页面的「考勤流程/请假记录」表，检测当天是否有请假/外出记录。
//
// 该表表头以「请假/外出天数」为标记（考勤明细表没有此表头，正常打卡天的页面也不含此表）。
// 列顺序：请求标题、姓名、开始时间、结束时间、审批状态、请假/外出天数、类型。
// 只要表里有数据行即视为“当天有请假记录”（所有类型都算）。
//
// 返回 (姓名, 请假类型, 是否有记录)。
func parseLeave(html string) (name, leaveType string, found bool) {
	idx := strings.Index(html, "请假/外出天数")
	if idx < 0 {
		return "", "", false
	}
	rest := html[idx:]

	tbodyStart := strings.Index(rest, "<tbody>")
	if tbodyStart < 0 {
		return "", "", false
	}
	after := rest[tbodyStart:]
	tbodyEnd := strings.Index(after, "</tbody>")
	if tbodyEnd < 0 {
		return "", "", false
	}
	tbody := after[:tbodyEnd]

	cells := leaveTdRe.FindAllStringSubmatch(tbody, -1)
	if len(cells) == 0 {
		return "", "", false
	}
	// 类型是最后一列，但行末可能有一个空单元格（操作列占位），
	// 因此取“最后一个非空单元格”作为类型。
	leaveType = ""
	for i := len(cells) - 1; i >= 0; i-- {
		t := strings.TrimSpace(stripTags(cells[i][1]))
		if t != "" {
			leaveType = t
			break
		}
	}
	// 姓名是第二列（第一列“请求标题”含链接）。
	if len(cells) >= 2 {
		name = strings.TrimSpace(stripTags(cells[1][1]))
	}
	return name, leaveType, true
}
