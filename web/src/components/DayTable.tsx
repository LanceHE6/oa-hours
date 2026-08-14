import { Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@nextui-org/react'
import type { DayStat } from '../api'
import { formatHours, shortTime } from '../format'

interface Props {
  days: DayStat[]
  standardHours: number
}

export default function DayTable({ days, standardHours }: Props) {
  // 只展示有数据的日期（打卡或请假；周末/未来/无数据不展示）。
  const workdays = days.filter((d) => d.found)

  return (
    <Table aria-label="每日工时" removeWrapper className="mt-4">
      <TableHeader>
        <TableColumn>日期</TableColumn>
        <TableColumn>周几</TableColumn>
        <TableColumn>签到</TableColumn>
        <TableColumn>签退</TableColumn>
        <TableColumn>有效工时</TableColumn>
        <TableColumn>状态</TableColumn>
      </TableHeader>
      <TableBody emptyContent="本月暂无数据">
        {workdays.map((d) => {
          const isFull = d.signOut !== ''
          const met = isFull && d.hours >= standardHours
          const leaveLabel = d.leaveType ? `请假·${d.leaveType}` : '请假'
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
              <TableCell>
                <div className="flex flex-wrap gap-1">
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
                    ) : met ? (
                      <Chip size="sm" color="success" variant="flat">
                        达标
                      </Chip>
                    ) : (
                      <Chip size="sm" color="warning" variant="flat">
                        未达标
                      </Chip>
                    ))}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
