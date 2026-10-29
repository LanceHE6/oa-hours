import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, CardBody, Select, SelectItem, Spinner } from '@nextui-org/react'
import type { BuildInfo, MonthResponse } from '../api'
import type { DataProvider } from '../provider'
import { formatHours, hoursToHm, shortTime } from '../format'
import SummaryCard from '../components/SummaryCard'
import DayTable from '../components/DayTable'
import HoursChart from '../components/HoursChart'
import HelpTip from '../components/HelpTip'
import { avgTargetSignOut } from '../oa/calc'

interface Props {
  provider: DataProvider
  onLogout: () => void
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// RefreshIcon 刷新图标（lucide refresh-cw 路径，内联避免新增依赖）。
function RefreshIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

// AlertIcon 警告图标（lucide alert-triangle 路径）。
function AlertIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

const TARGET_STANDARD_KEY = 'target_standard_hours'
const DEFAULT_STANDARD_HOURS = 8.5

export default function Dashboard({ provider, onLogout }: Props) {
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState<MonthResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [targetOption, setTargetOption] = useState<'nine' | 'standard' | 'eight' | 'avg'>('standard')
  const [userStandardHours, setUserStandardHours] = useState<number>(() => {
    const saved = localStorage.getItem(TARGET_STANDARD_KEY)
    if (saved) {
      const val = parseFloat(saved)
      if (val === 8.0 || val === 8.5 || val === 9.0) return val
    }
    return DEFAULT_STANDARD_HOURS
  })
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const [calcSignOut, setCalcSignOut] = useState('')
  const [calcHours, setCalcHours] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleStandardHoursChange = (val: number) => {
    setUserStandardHours(val)
    localStorage.setItem(TARGET_STANDARD_KEY, String(val))
  }

  const load = useCallback(async (m: string, background = false) => {
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError('')
    try {
      const res = await provider.getMonth(m)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [provider])

  useEffect(() => {
    load(month)
  }, [month, load])

  useEffect(() => {
    provider.getBuildInfo()
      .then(setBuildInfo)
      .catch(() => {})
  }, [provider])

  const logout = async () => {
    try {
      await provider.logout()
    } finally {
      onLogout()
    }
  }

  const todayStat = useMemo(() => {
    if (!data) return undefined
    const today = data.days.find((d) => d.isToday)
    if (!today || !today.signIn) return today

    // 基于用户设置的达标线动态重算平均工时达标签退时间
    let sumHours = 0
    let doneCount = 0
    for (const d of data.days) {
      if (d.date !== data.today && (d.leave || d.signOut !== '')) {
        sumHours += d.hours
        doneCount++
      }
    }
    const dynamicAvgSignOut = avgTargetSignOut(today.signIn, sumHours, doneCount, userStandardHours)
    return {
      ...today,
      avgSignOut: dynamicAvgSignOut || undefined,
    }
  }, [data, userStandardHours])

  const completedDays = useMemo(
    () => data?.days.filter((d) => d.found && d.signOut !== '') ?? [],
    [data],
  )
  const metDays = useMemo(
    () => completedDays.filter((d) => d.hours >= userStandardHours),
    [completedDays, userStandardHours],
  )

  useEffect(() => {
    if (!calcSignOut || !todayStat?.signIn) {
      setCalcHours(null)
      return
    }
    provider.calcHours(todayStat.signIn, calcSignOut)
      .then((res) => setCalcHours(res.hours))
      .catch(() => setCalcHours(null))
  }, [calcSignOut, todayStat?.signIn, provider])

  const calcMonthAvg = useMemo(() => {
    if (calcHours == null || !data) return null
    let sumHours = 0
    let doneCount = 0
    for (const d of data.days) {
      if (d.date !== data.today && (d.leave || d.signOut !== '')) {
        sumHours += d.hours
        doneCount++
      }
    }
    const newTotal = sumHours + calcHours
    const newCount = doneCount + 1
    return newCount > 0 ? newTotal / newCount : 0
  }, [calcHours, data])

  const targetValue =
    targetOption === 'nine'
      ? todayStat?.nineSignOut
      : targetOption === 'standard'
        ? todayStat?.targetSignOut
        : targetOption === 'eight'
          ? todayStat?.recommendSignOut
          : todayStat?.avgSignOut
  const targetDesc =
    targetOption === 'nine'
      ? '9 小时工时'
      : targetOption === 'standard'
        ? `8.5h 达标工时`
        : targetOption === 'eight'
          ? '8 小时工时'
          : `使本月平均达 ${userStandardHours}h`

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

        {/* 月份导航与达标线设置 */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
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
            <Button
              size="sm"
              variant="flat"
              isLoading={refreshing}
              startContent={<RefreshIcon />}
              onPress={() => load(month, true)}
            >
              刷新
            </Button>
          </div>

          {/* 达标线选择 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-default-500">工时达标线</span>
            <div className="flex gap-1">
              {[8.0, 8.5, 9.0].map((hours) => (
                <Button
                  key={hours}
                  size="sm"
                  color={userStandardHours === hours ? 'primary' : 'default'}
                  variant={userStandardHours === hours ? 'solid' : 'flat'}
                  onPress={() => handleStandardHoursChange(hours)}
                >
                  {hours === 8 ? '8h' : hours === 9 ? '9h' : `${hours}h`}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div className="mt-16 flex justify-center">
            <Spinner label="正在从 OA 拉取数据…" color="primary" />
          </div>
        )}

        {error && !data && (
          <Card className="mt-6">
            <CardBody className="text-danger">{error}</CardBody>
          </Card>
        )}

        {!loading && data && (
          <>
            {/* 刷新/加载失败提示（已有数据时保留旧数据） */}
            {error && (
              <div className="mt-4 flex justify-center">
                <Card className="w-full max-w-md">
                  <CardBody className="flex items-center gap-2 px-4 py-3 text-sm text-danger">
                    <AlertIcon />
                    <span>{error}</span>
                  </CardBody>
                </Card>
              </div>
            )}

            {/* 汇总卡片 */}
            <div className="mt-6 flex flex-wrap gap-4">
              <SummaryCard
                title="月平均工时"
                value={data.averageHours > 0 ? formatHours(data.averageHours) : '—'}
                subtitle={`达标线 ${userStandardHours}h`}
                color={data.averageHours >= userStandardHours ? 'success' : 'warning'}
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
                            四档目标工时：9h / 8.5h / 8h / 平均工时。
                            <br />
                            平均工时 = 使本月平均达当前设置达标线（{userStandardHours}h）的最早下班时间（当日 ≥8h，不早于 18:00）。
                          </div>
                        }
                      />
                    </p>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        color={targetOption === 'nine' ? 'primary' : 'default'}
                        variant={targetOption === 'nine' ? 'solid' : 'flat'}
                        onPress={() => setTargetOption('nine')}
                      >
                        9h
                      </Button>
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
                  <div className="flex flex-wrap items-center gap-4">
                    <input
                      type="time"
                      value={calcSignOut}
                      onChange={(e) => setCalcSignOut(e.target.value)}
                      className="rounded-lg border border-default-200 bg-default-100 px-3 py-1.5 text-sm text-foreground outline-none [color-scheme:dark] focus:border-primary"
                    />
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm text-default-500">当日有效工时</span>
                      <span className="text-xl font-semibold text-primary">
                        {calcHours != null ? formatHours(calcHours) : '—'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm text-default-500">截至今日月平均</span>
                      <span
                        className={`text-xl font-semibold ${
                          calcMonthAvg != null
                            ? calcMonthAvg >= userStandardHours
                              ? 'text-success'
                              : 'text-warning'
                            : 'text-default-400'
                        }`}
                      >
                        {calcMonthAvg != null ? formatHours(calcMonthAvg) : '—'}
                      </span>
                    </div>
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
                        签到时间按实际起算；午休固定扣 1.5h。
                        <br />
                        9 点后签到且 18 点后签退，另扣晚饭 0.5h。
                        <br />
                        请假/外出天按 8h 计。
                      </div>
                    }
                  />
                </p>
                <HoursChart days={data.days} standardHours={userStandardHours} month={data.month} today={data.today} />
              </CardBody>
            </Card>

            {/* 明细表 */}
            <Card className="mt-4">
              <CardBody>
                <p className="text-sm font-medium text-default-500">
                  每日明细（平均 {data.averageHours > 0 ? hoursToHm(data.averageHours) : '—'}）
                </p>
                <DayTable days={data.days} standardHours={userStandardHours} />
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
