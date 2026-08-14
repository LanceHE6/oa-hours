import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, CardBody, Chip, Spinner } from '@nextui-org/react'
import { apiGet, apiPost, type MonthResponse } from '../api'
import { formatHours, hoursToHm, shortTime } from '../format'
import SummaryCard from '../components/SummaryCard'
import DayTable from '../components/DayTable'
import HoursChart from '../components/HoursChart'

interface Props {
  onLogout: () => void
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard({ onLogout }: Props) {
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState<MonthResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-4xl px-4 py-6">
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
          <Button size="sm" variant="flat" onClick={logout}>
            退出登录
          </Button>
        </div>

        {/* 月份导航 */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button size="sm" variant="flat" isIconOnly onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </Button>
          <span className="w-28 text-center text-lg font-semibold">{month}</span>
          <Button size="sm" variant="flat" isIconOnly onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </Button>
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
              />
              <SummaryCard
                title="已打卡天数"
                value={String(completedDays.length)}
                subtitle={`其中达标 ${metDays.length} 天`}
                color="primary"
              />
              <SummaryCard
                title="迟到天数"
                value={String(data.lateDays)}
                subtitle="签到晚于 9:00"
                color={data.lateDays > 0 ? 'danger' : 'success'}
              />
              <SummaryCard
                title="今天目标签退"
                value={todayStat?.targetSignOut ?? '—'}
                subtitle={
                  todayStat?.found
                    ? `已签到 ${shortTime(todayStat.signIn)}`
                    : '今日暂无打卡'
                }
                color={todayStat?.targetSignOut ? 'warning' : 'default'}
              />
            </div>

            {/* 当天目标提示 */}
            {todayStat?.targetSignOut && (
              <Card className="mt-4 border border-warning/40 bg-warning/5">
                <CardBody>
                  <p className="text-sm">
                    今天签到 <span className="font-semibold">{shortTime(todayStat.signIn)}</span>
                    ，要达到 {data.standardHours}h 达标工时，需在{' '}
                    <Chip size="sm" color="warning" variant="flat">
                      {todayStat.targetSignOut}
                    </Chip>{' '}
                    之后签退。
                  </p>
                </CardBody>
              </Card>
            )}

            {/* 每日工时图 */}
            <Card className="mt-4">
              <CardBody>
                <p className="text-sm font-medium text-default-500">每日有效工时</p>
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
    </div>
  )
}
