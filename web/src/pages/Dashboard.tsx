import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, CardBody, Select, SelectItem, Spinner } from '@nextui-org/react'
import { apiGet, apiPost, type BuildInfo, type MonthResponse } from '../api'
import { formatHours, hoursToHm, shortTime } from '../format'
import SummaryCard from '../components/SummaryCard'
import DayTable from '../components/DayTable'
import HoursChart from '../components/HoursChart'
import HelpTip from '../components/HelpTip'

interface Props {
  onLogout: () => void
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard({ onLogout }: Props) {
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState<MonthResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [targetOption, setTargetOption] = useState<'standard' | 'eight' | 'avg'>('standard')
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const [calcSignOut, setCalcSignOut] = useState('')
  const [calcHours, setCalcHours] = useState<number | null>(null)

  const load = useCallback(async (m: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGet<MonthResponse>(`/api/month?month=${m}`)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(month)
  }, [month, load])

  useEffect(() => {
    apiGet<BuildInfo>('/api/buildinfo')
      .then(setBuildInfo)
      .catch(() => {})
  }, [])

  const logout = async () => {
    try {
      await apiPost('/api/logout', {})
    } finally {
      onLogout()
    }
  }

  const todayStat = useMemo(() => data?.days.find((d) => d.isToday), [data])
  const completedDays = useMemo(
    () => data?.days.filter((d) => d.found && d.signOut !== '') ?? [],
    [data],
  )
  const metDays = useMemo(
    () => completedDays.filter((d) => d.hours >= (data?.standardHours ?? 8.5)),
    [completedDays, data],
  )

  useEffect(() => {
    if (!calcSignOut || !todayStat?.signIn) {
      setCalcHours(null)
      return
    }
    const q = `signIn=${encodeURIComponent(todayStat.signIn)}&signOut=${encodeURIComponent(calcSignOut)}`
    apiGet<{ hours: number }>(`/api/calc?${q}`)
      .then((res) => setCalcHours(res.hours))
      .catch(() => setCalcHours(null))
  }, [calcSignOut, todayStat?.signIn])

  const targetValue =
    targetOption === 'standard'
      ? todayStat?.targetSignOut
      : targetOption === 'eight'
        ? todayStat?.recommendSignOut
        : todayStat?.avgSignOut
  const targetDesc =
    targetOption === 'standard'
      ? `8.5h 达标工时`
      : targetOption === 'eight'
        ? '8 小时工时'
        : '使本月平均达 8.5h'

  const year = month.slice(0, 4)
  const monthNum = month.slice(5, 7)
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i)

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">工时统计</h1>
            {data && (
              <p className="mt-1 text-sm text-default-500">
                {data.name} · {data.department}
              </p>
            )}
          </div>
          <Button size="sm" color="danger" variant="solid" onClick={logout}>
            退出登录
          </Button>
        </div>

        {/* 月份导航 */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <Select
            aria-label="年份"
            size="sm"
            className="w-28"
            selectedKeys={new Set([year])}
            onSelectionChange={(keys) => {
              const v = Array.from(keys as Set<string>)[0]
              if (v) setMonth(`${v}-${monthNum}`)
            }}
          >
            {years.map((y) => (
              <SelectItem key={String(y)} textValue={`${y} 年`}>{y} 年</SelectItem>
            ))}
          </Select>
          <Select
            aria-label="月份"
            size="sm"
            className="w-24"
            selectedKeys={new Set([monthNum])}
            onSelectionChange={(keys) => {
              const v = Array.from(keys as Set<string>)[0]
              if (v) setMonth(`${year}-${String(v).padStart(2, '0')}`)
            }}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <SelectItem key={String(m).padStart(2, '0')} textValue={`${m} 月`}>{m} 月</SelectItem>
            ))}
          </Select>
        </div>

        {loading && (
          <div className="mt-16 flex justify-center">
            <Spinner label="正在从 OA 拉取数据…" color="primary" />
          </div>
        )}

        {error && (
          <Card className="mt-6">
            <CardBody className="text-danger">{error}</CardBody>
          </Card>
        )}

        {!loading && !error && data && (
          <>
            {/* 汇总卡片 */}
            <div className="mt-6 flex flex-wrap gap-4">
              <SummaryCard
                title="月平均工时"
                value={data.averageHours > 0 ? formatHours(data.averageHours) : '—'}
                subtitle={`达标线 ${data.standardHours}h`}
                color={data.averageHours >= data.standardHours ? 'success' : 'warning'}
                tip={<div>月平均 =（打卡天工时 + 请假天×8h）÷（打卡天数 + 请假天数），不含今天</div>}
              />
              <SummaryCard
                title="本月总工时"
                value={formatHours(data.totalHours)}
                subtitle="不含今天"
                color="primary"
                tip={<div>已完成打卡天 + 请假天（8h）的工时总和，不含今天</div>}
              />
              <SummaryCard
                title="已打卡天数"
                value={String(completedDays.length)}
                subtitle={`其中达标 ${metDays.length} 天`}
                color="primary"
              />
              <SummaryCard
                title="请假天数"
                value={String(data.leaveDays)}
                subtitle="请假/外出按 8h 计"
                color={data.leaveDays > 0 ? 'primary' : 'default'}
              />
              <SummaryCard
                title="迟到天数"
                value={String(data.lateDays)}
                subtitle="签到晚于 9:00"
                color={data.lateDays > 0 ? 'danger' : 'success'}
              />
            </div>

            {/* 推荐下班时间选择器 */}
            {todayStat?.targetSignOut ? (
              <Card className="mt-4">
                <CardBody className="gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center text-sm font-medium text-default-500">
                      推荐下班时间
                      <HelpTip
                        content={
                          <div>
                            三档目标工时：8.5h 达标 / 8h / 平均工时。
                            <br />
                            平均工时 = 使本月平均达 8.5h 的最早下班时间（当日 ≥8h，不早于 18:00）。
                          </div>
                        }
                      />
                    </p>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        color={targetOption === 'standard' ? 'primary' : 'default'}
                        variant={targetOption === 'standard' ? 'solid' : 'flat'}
                        onPress={() => setTargetOption('standard')}
                      >
                        8.5h
                      </Button>
                      <Button
                        size="sm"
                        color={targetOption === 'eight' ? 'primary' : 'default'}
                        variant={targetOption === 'eight' ? 'solid' : 'flat'}
                        onPress={() => setTargetOption('eight')}
                      >
                        8h
                      </Button>
                      <Button
                        size="sm"
                        color={targetOption === 'avg' ? 'primary' : 'default'}
                        variant={targetOption === 'avg' ? 'solid' : 'flat'}
                        onPress={() => setTargetOption('avg')}
                      >
                        平均工时
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-semibold text-warning">{targetValue ?? '—'}</span>
                    <span className="text-sm text-default-500">{targetDesc}</span>
                  </div>
                  <p className="text-sm text-default-500">
                    今天签到 <span className="font-medium text-foreground">{shortTime(todayStat.signIn)}</span>
                    {targetOption === 'avg' && '，不早于 18:00（早退下限）'}
                  </p>
                </CardBody>
              </Card>
            ) : null}

            {/* 工时计算 */}
            {todayStat?.signIn && (
              <Card className="mt-4">
                <CardBody className="gap-3">
                  <p className="flex items-center text-sm font-medium text-default-500">
                    工时计算
                    <HelpTip
                      content={
                        <div>
                          输入下班时间，根据当天签到时间计算当日有效工时。
                          <br />
                          扣除规则与每日工时一致（午休 1.5h，9 点后签到且 18 点后签退另扣晚饭 0.5h）。
                        </div>
                      }
                    />
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="time"
                      value={calcSignOut}
                      onChange={(e) => setCalcSignOut(e.target.value)}
                      className="rounded-lg border border-default-200 bg-default-100 px-3 py-1.5 text-sm text-foreground outline-none [color-scheme:dark] focus:border-primary"
                    />
                    <span className="text-sm text-default-500">当日有效工时</span>
                    <span className="text-xl font-semibold text-primary">
                      {calcHours != null ? formatHours(calcHours) : '—'}
                    </span>
                  </div>
                  <p className="text-xs text-default-400">今天签到 {shortTime(todayStat.signIn)}</p>
                </CardBody>
              </Card>
            )}

            {/* 每日工时图 */}
            <Card className="mt-4">
              <CardBody>
                <p className="flex items-center text-sm font-medium text-default-500">
                  每日有效工时
                  <HelpTip
                    content={
                      <div>
                        8:30 前签到按 8:30 起算；午休固定扣 1.5h。
                        <br />
                        9 点后签到且 18 点后签退，另扣晚饭 0.5h。
                        <br />
                        请假/外出天按 8h 计。
                      </div>
                    }
                  />
                </p>
                <HoursChart days={data.days} standardHours={data.standardHours} month={data.month} today={data.today} />
              </CardBody>
            </Card>

            {/* 明细表 */}
            <Card className="mt-4">
              <CardBody>
                <p className="text-sm font-medium text-default-500">
                  每日明细（平均 {data.averageHours > 0 ? hoursToHm(data.averageHours) : '—'}）
                </p>
                <DayTable days={data.days} standardHours={data.standardHours} />
              </CardBody>
            </Card>

            <p className="mt-6 text-center text-xs text-default-500">
              数据实时从 OA 拉取，仅本次会话展示，不会保存在本地。
            </p>
          </>
        )}
      </div>
      <footer className="border-t border-default-100 py-4 text-center text-xs text-default-500">
        {buildInfo ? `Author: ${buildInfo.author} · Built on ${buildInfo.buildTime}` : 'Author: Hycer'}
      </footer>
    </div>
  )
}
