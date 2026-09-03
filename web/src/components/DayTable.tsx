import { useEffect, useState } from 'react'
import { Button, Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@nextui-org/react'
import type { DayStat } from '../api'
import { formatHours, shortTime } from '../format'

interface Props {
  days: DayStat[]
  standardHours: number
}

// 早退阈值：工时不满 8h。
const EARLY_LEAVE_HOURS = 8

type StatusKey = 'all' | 'met' | 'notMet' | 'earlyLeave' | 'late' | 'leave'

export default function DayTable({ days, standardHours }: Props) {
  const [status, setStatus] = useState<StatusKey>('all')
  // 窄屏（<640px，手机）用卡片列表替代表格。
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // 只展示有数据的日期（打卡或请假；周末/未来/无数据不展示）。
  const workdays = days.filter((d) => d.found)

  function match(d: DayStat, key: StatusKey): boolean {
    const isFull = d.signOut !== ''
    switch (key) {
      case 'all':
        return true
      case 'leave':
        return d.leave
      case 'late':
        return !d.leave && d.late
      case 'met':
        return !d.leave && isFull && d.hours >= standardHours
      case 'notMet':
        return !d.leave && isFull && d.hours >= EARLY_LEAVE_HOURS && d.hours < standardHours
      case 'earlyLeave':
        return !d.leave && isFull && d.hours < EARLY_LEAVE_HOURS
    }
  }

  const statuses: { key: StatusKey; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'met', label: '达标' },
    { key: 'notMet', label: '未达标' },
    { key: 'earlyLeave', label: '早退' },
    { key: 'late', label: '迟到' },
    { key: 'leave', label: '请假' },
  ]

  const counts = statuses.map((s) => ({
    ...s,
    count: workdays.filter((d) => match(d, s.key)).length,
  }))

  const filtered = workdays.filter((d) => match(d, status))

  return (
    <div className="mt-4">
      {/* 状态筛选 + 天数统计 */}
      <div className="flex flex-wrap gap-2">
        {counts.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={status === s.key ? 'solid' : 'flat'}
            color={status === s.key ? 'primary' : 'default'}
            onPress={() => setStatus(s.key)}
          >
            {s.label} {s.count}
          </Button>
        ))}
      </div>

      {isMobile ? (
        /* 手机窄屏：卡片列表 */
        <div className="mt-3 space-y-2">
          {filtered.map((d) => {
            const isFull = d.signOut !== ''
            return (
              <div
                key={d.date}
                className={`rounded-xl border border-default-100 p-3 ${d.isToday ? 'bg-primary/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{d.date.slice(8)} 日</span>
                    <span className="text-xs text-default-500">{d.weekday}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">{statusChips(d, standardHours)}</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-default-400">签到</p>
                    {d.leave ? (
                      <span className="text-default-400">—</span>
                    ) : (
                      <span className={d.late ? 'font-semibold text-danger' : ''}>{shortTime(d.signIn)}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-default-400">签退</p>
                    {d.leave ? (
                      <span className="text-default-400">—</span>
                    ) : d.isToday && d.targetSignOut ? (
                      <span className="font-semibold text-warning">{d.targetSignOut}</span>
                    ) : isFull ? (
                      shortTime(d.signOut)
                    ) : (
                      <span className="text-warning">未签退</span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-default-400">工时</p>
                    <span className="font-semibold">{d.leave || isFull ? formatHours(d.hours) : '—'}</span>
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-default-400">无匹配数据</p>
          )}
        </div>
      ) : (
        /* 桌面宽屏：表格 */
        <Table aria-label="每日工时" removeWrapper className="mt-3">
          <TableHeader>
            <TableColumn>日期</TableColumn>
            <TableColumn>周几</TableColumn>
            <TableColumn>签到</TableColumn>
            <TableColumn>签退</TableColumn>
            <TableColumn>有效工时</TableColumn>
            <TableColumn>状态</TableColumn>
          </TableHeader>
          <TableBody emptyContent="无匹配数据">
            {filtered.map((d) => {
              const isFull = d.signOut !== ''
              return (
                <TableRow
                  key={d.date}
                  className={d.isToday ? 'bg-primary/10' : undefined}
                >
                  <TableCell>
                    <span className="font-medium">{d.date.slice(8)} 日</span>
                  </TableCell>
                  <TableCell className="text-default-500">{d.weekday}</TableCell>
                  <TableCell>
                    {d.leave ? (
                      <span className="text-default-400">—</span>
                    ) : (
                      <span className={d.late ? 'font-semibold text-danger' : ''}>
                        {shortTime(d.signIn)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {d.leave ? (
                      <span className="text-default-400">—</span>
                    ) : d.isToday && d.targetSignOut ? (
                      <span className="font-semibold text-warning">{d.targetSignOut}</span>
                    ) : isFull ? (
                      shortTime(d.signOut)
                    ) : (
                      <span className="text-warning">未签退</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">
                      {d.leave || isFull ? formatHours(d.hours) : '—'}
                    </span>
                  </TableCell>
                  <TableCell>{statusChips(d, standardHours)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// statusChips 渲染一天的状态标签（请假/迟到/进行中/未签退/早退/达标/未达标）。
// 卡片列表与表格共用，保证两种形态展示一致。
function statusChips(d: DayStat, standardHours: number) {
  const isFull = d.signOut !== ''
  const met = isFull && d.hours >= standardHours
  const leaveLabel = d.leaveType ? `请假·${d.leaveType}` : '请假'
  return (
    <>
      {d.leave && (
        <Chip size="sm" color="primary" variant="flat">
          {leaveLabel}
        </Chip>
      )}
      {!d.leave && d.late && (
        <Chip size="sm" color="danger" variant="flat">
          迟到
        </Chip>
      )}
      {!d.leave &&
        (d.isToday ? (
          <Chip size="sm" color="primary" variant="flat">
            进行中
          </Chip>
        ) : !isFull ? (
          <Chip size="sm" color="default" variant="flat">
            未签退
          </Chip>
        ) : d.hours < EARLY_LEAVE_HOURS ? (
          <Chip size="sm" color="danger" variant="flat">
            早退
          </Chip>
        ) : met ? (
          <Chip size="sm" color="success" variant="flat">
            达标
          </Chip>
        ) : (
          <Chip size="sm" color="warning" variant="flat">
            未达标
          </Chip>
        ))}
    </>
  )
}
