import { Tooltip } from '@nextui-org/react'
import type { ReactNode } from 'react'

interface Props {
  content: ReactNode
}

// HelpTip 一个 "!" 图标，光标悬浮弹出说明提示。
export default function HelpTip({ content }: Props) {
  return (
    <Tooltip
      content={content}
      placement="top"
      showArrow
      classNames={{ content: 'max-w-[260px] text-xs' }}
    >
      <span className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-default-200 text-[10px] font-bold leading-none text-default-600">
        !
      </span>
    </Tooltip>
  )
}
