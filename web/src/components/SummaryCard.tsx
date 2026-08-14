import { Card, CardBody } from '@nextui-org/react'
import type { ReactNode } from 'react'
import HelpTip from './HelpTip'

interface Props {
  title: string
  value: string
  subtitle?: string
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'default'
  tip?: ReactNode
}

const colorClass: Record<NonNullable<Props['color']>, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  default: 'text-foreground',
}

export default function SummaryCard({ title, value, subtitle, color = 'default', tip }: Props) {
  return (
    <Card className="flex-1">
      <CardBody className="gap-1 py-4">
        <p className="flex items-center text-xs text-default-500">
          {title}
          {tip && <HelpTip content={tip} />}
        </p>
        <p className={`text-2xl font-semibold ${colorClass[color]}`}>{value}</p>
        {subtitle && <p className="text-xs text-default-400">{subtitle}</p>}
      </CardBody>
    </Card>
  )
}
