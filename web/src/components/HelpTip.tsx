import { Tooltip } from '@nextui-org/react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  content: ReactNode
}

// HelpTip 一个 "!" 图标，支持桌面端悬浮、键盘聚焦及移动端点击弹出说明提示。
export default function HelpTip({ content }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // 记录按下前是否已打开，避免 Tooltip 内置 onPressStart 先关闭后触发 onClick 立即重新打开。
  const wasOpenOnPressRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDownOutside = (e: PointerEvent) => {
      if (triggerRef.current && e.target instanceof Node && !triggerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDownOutside)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [isOpen])

  const handlePointerDown = () => {
    wasOpenOnPressRef.current = isOpen
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      wasOpenOnPressRef.current = isOpen
    }
  }

  const handleClick = () => {
    if (wasOpenOnPressRef.current) {
      wasOpenOnPressRef.current = false
      setIsOpen(false)
      return
    }
    setIsOpen(true)
  }

  return (
    <Tooltip
      content={content}
      placement="top"
      showArrow
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      classNames={{ content: 'max-w-[260px] text-xs' }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="查看说明"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onBlur={() => setIsOpen(false)}
        className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-default-200 text-[10px] font-bold leading-none text-default-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        !
      </button>
    </Tooltip>
  )
}
