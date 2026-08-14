import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayStat } from '../api'

interface Props {
  days: DayStat[]
  standardHours: number
  month: string
  today: string
}

export default function HoursChart({ days, standardHours, month, today }: Props) {
  // 展示所有“已过去”的天（含周末），无完整打卡数据的天（周末/当天未签退）显示为空缺，
  // 便于一眼看出每周的工作日分布。
  const data = days
    .filter((d) => d.date <= today)
    .map((d) => ({
      date: d.date.slice(8), // 日号
      hours: d.found && d.signOut !== '' ? Number(d.hours.toFixed(2)) : null,
      full: d.date,
    }))

  return (
    <div className="mt-4 h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
          <XAxis dataKey="date" stroke="#888" fontSize={11} tickLine={false} axisLine={false} interval={0} />
          <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} domain={[0, 'auto']} />
          <Tooltip
            formatter={(value: number | string) => [`${Number(value).toFixed(2)}h`, '有效工时']}
            labelFormatter={(label) => `${month}-${label}`}
            contentStyle={{ background: '#18181b', border: '1px solid #333', borderRadius: 8 }}
            labelStyle={{ color: '#e4e4e7' }}
            itemStyle={{ color: '#e4e4e7' }}
            cursor={{ fill: 'rgba(255,255,255,0.06)' }}
          />
          <ReferenceLine y={standardHours} stroke="#f5a524" strokeDasharray="4 4" label={{ value: '达标', fill: '#f5a524', fontSize: 12 }} />
          <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.full}
                fill={d.hours == null ? 'transparent' : d.hours >= standardHours ? '#17c964' : '#f31260'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
