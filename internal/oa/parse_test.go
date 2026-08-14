package oa

import "testing"

const detailFixture = `<!DOCTYPE html><html><head><title>考勤明细</title></head><body>
<table>
<thead><tr>
<th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th>
</tr></thead>
<tbody><tr>
<td style="display:" class="fieldName" colspan="1">
云平台测试部
</td>
<td style="display:" class="fieldName" colspan="1">
何明礼
</td>
<td style="display:" class="fieldName" colspan="1">
2026-08-13
</td>
<td style="display:" class="fieldName" colspan="1">
08:30-18:00
</td>
<td style="display:" class="fieldName" colspan="1">
09:01:18
</td>
<td style="display:" class="fieldName" colspan="1">
19:02:54
</td>
</tr>
</tbody></table>
</body></html>`

func TestParseDetail(t *testing.T) {
	d, found := parseDetail(detailFixture)
	if !found {
		t.Fatal("should be found")
	}
	if d.Department != "云平台测试部" || d.Name != "何明礼" {
		t.Errorf("dept/name = %q/%q", d.Department, d.Name)
	}
	if d.Date != "2026-08-13" || d.Period != "08:30-18:00" {
		t.Errorf("date/period = %q/%q", d.Date, d.Period)
	}
	if d.SignIn != "09:01:18" || d.SignOut != "19:02:54" {
		t.Errorf("in/out = %q/%q", d.SignIn, d.SignOut)
	}
}

func TestParseDetailEmptySignOut(t *testing.T) {
	// 当天只签到未签退：签退单元格为空。
	fixture := `<th>签到时间</th><th>签退时间</th></tr></thead><tbody><tr>
<td>云平台测试部</td><td>何明礼</td><td>2026-08-14</td><td>08:30-18:00</td><td>08:55:44</td><td></td>
</tr></tbody>`
	d, found := parseDetail(fixture)
	if !found {
		t.Fatal("should be found")
	}
	if d.SignIn != "08:55:44" {
		t.Errorf("signIn = %q", d.SignIn)
	}
	if d.SignOut != "" {
		t.Errorf("signOut should be empty, got %q", d.SignOut)
	}
}

func TestParseDetailNoData(t *testing.T) {
	// 无打卡数据的日期（周末/未来）不含“签退时间”表头。
	_, found := parseDetail(`<html><body><table><thead><tr><th>部门</th></tr></thead><tbody></tbody></table></body></html>`)
	if found {
		t.Error("should not be found")
	}
}

func TestParseDetailLeaveDay(t *testing.T) {
	// 请假天：考勤明细表的 tbody 为空，真正的数据在后面的“请假记录”表里。
	// 不能把请假记录表的单元格（含“年休假”类型）误当作考勤数据。
	fixture := `<table>
<thead><tr><th>部门</th><th>姓名</th><th>日期</th><th>工作时段</th><th>签到时间</th><th>签退时间</th></tr></thead>
<tbody>
</tbody>
</table>
<table>
<thead><tr><th>请求标题</th><th>姓名</th><th>开始时间</th><th>结束时间</th><th>审批状态</th><th>请假/外出天数</th><th>类型</th></tr></thead>
<tbody><tr>
<td>请假流程</td><td>何明礼</td><td>2026-07-09 08:30</td><td>2026-07-09 18:00</td><td>09归档</td><td>1.00</td><td>年休假</td>
</tr></tbody>
</table>`
	_, found := parseDetail(fixture)
	if found {
		t.Error("请假天不应被判定为有打卡数据")
	}
}

func TestIsLoginRedirect(t *testing.T) {
	if !isLoginRedirect([]byte(`<script>try{top.location.href='/login/Login.jsp?gopage=&_rnd_=x';}catch(e){}</script>`)) {
		t.Error("should detect login redirect")
	}
	if isLoginRedirect([]byte(`<th>签到时间</th>`)) {
		t.Error("should not flag normal response")
	}
}
