import { Card, CardBody } from '@nextui-org/react'

interface Props {
  title: string
  value: string
  subtitle?: string
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'default'
}

const colorClass: Record<NonNullable<Props['color']>, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  default: 'text-foreground',
}

export default function SummaryCard({ title, value, subtitle, color = 'default' }: Props) {
  return (
    <Card className="flex-1">
      <CardBody className="gap-1 py-4">
        <p className="text-xs text-default-500">{title}</p>
        <p className={`text-2xl font-semibold ${colorClass[color]}`}>{value}</p>
        {subtitle && <p className="text-xs text-default-400">{subtitle}</p>}
      </CardBody>
    </Card>
  )
}
