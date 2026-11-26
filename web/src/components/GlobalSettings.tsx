import { Button, Popover, PopoverContent, PopoverTrigger } from '@nextui-org/react'
import type { CalcMode } from '../oa/calc'
import HelpTip from './HelpTip'

interface Props {
  calcMode: CalcMode
  onCalcModeChange: (mode: CalcMode) => void
  standardHours: number
  onStandardHoursChange: (hours: number) => void
}

// SettingsIcon 设置齿轮图标（lucide settings 路径，内联避免新增依赖）。
function SettingsIcon({ className = 'h-4 w-4' }: { className?: string }) {
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
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

const CALC_MODE_OPTIONS: { key: CalcMode; label: string; desc: string }[] = [
  {
    key: 'A',
    label: '模式 A',
    desc: '9:00 及之前签到只扣午休 1.5h；9:00 后签到且 18:00 后签退额外扣晚饭 0.5h。',
  },
  {
    key: 'B',
    label: '模式 B',
    desc: '无论是否 9 点后签到，均只扣午休 1.5h，不扣晚饭 0.5h。',
  },
]

const STANDARD_HOUR_OPTIONS = [8.0, 8.5, 9.0]

// GlobalSettings 右上角全局设置浮层：集中配置工时计算方法与工时达标线。
export default function GlobalSettings({
  calcMode,
  onCalcModeChange,
  standardHours,
  onStandardHoursChange,
}: Props) {
  const activeMode = CALC_MODE_OPTIONS.find((m) => m.key === calcMode) ?? CALC_MODE_OPTIONS[0]

  return (
    <Popover placement="bottom-end">
      <PopoverTrigger>
        <Button isIconOnly size="sm" variant="flat" aria-label="全局设置">
          <SettingsIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-3">
        <div className="w-full space-y-3">
          <p className="text-sm font-semibold">全局设置</p>

          <div>
            <p className="flex items-center text-xs font-medium text-default-500">
              工时计算方法
              <HelpTip
                content={
                  <div className="space-y-1">
                    <div>模式 A（默认）：9:00 及之前签到只扣午休 1.5h；9:00 后签到且 18:00 后签退额外扣晚饭 0.5h。</div>
                    <div>模式 B：移除半小时差距，无论是否 9 点后签到，均只扣午休 1.5h，不扣晚饭 0.5h。</div>
                  </div>
                }
              />
            </p>
            <div className="mt-2 flex gap-1.5">
              {CALC_MODE_OPTIONS.map((m) => (
                <Button
                  key={m.key}
                  size="sm"
                  className="flex-1"
                  color={calcMode === m.key ? 'primary' : 'default'}
                  variant={calcMode === m.key ? 'solid' : 'flat'}
                  onPress={() => onCalcModeChange(m.key)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-default-400">
              当前{activeMode.label}{activeMode.key === 'A' ? '（默认）' : ''}：{activeMode.desc}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-default-500">工时达标线</p>
            <div className="mt-2 flex gap-1.5">
              {STANDARD_HOUR_OPTIONS.map((hours) => (
                <Button
                  key={hours}
                  size="sm"
                  className="flex-1"
                  color={standardHours === hours ? 'primary' : 'default'}
                  variant={standardHours === hours ? 'solid' : 'flat'}
                  onPress={() => onStandardHoursChange(hours)}
                >
                  {hours === 8 ? '8h' : hours === 9 ? '9h' : `${hours}h`}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
