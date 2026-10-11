// ============ Surface ============
// The card skin of the app: a border, the card radius, the card colour and the
// card shadow. A surface that is one whole link or button sets `interactive`
// and lifts on hover. A surface that only holds content stays still. The
// caller owns the padding and the inner layout. Styles: the yf-surface rules
// in src/styles.css.
import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react'

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> {
  as?: 'div' | 'article' | 'li' | 'section'
  className?: string
  /** True when the whole surface is one link or button. It then lifts on hover. */
  interactive?: boolean
  /** The place of this surface in a list. It sets the entrance delay. */
  enterIndex?: number
  children?: ReactNode
}

/** The largest step of the entrance delay, so a long list does not wait. */
const MAX_ENTER_STEP = 8

export function Surface({
  as = 'div',
  className,
  interactive = false,
  enterIndex,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const Tag: ElementType = as
  const hasEnter = enterIndex !== undefined
  const classNames = ['yf-surface']
  if (interactive) classNames.push('is-interactive')
  if (hasEnter) classNames.push('is-entering')
  if (className) classNames.push(className)
  const enterDelay: CSSProperties | undefined = hasEnter
    ? { animationDelay: `calc(var(--stagger-step) * ${Math.min(enterIndex, MAX_ENTER_STEP)})` }
    : undefined
  return (
    <Tag className={classNames.join(' ')} style={enterDelay ? { ...enterDelay, ...style } : style} {...rest}>
      {children}
    </Tag>
  )
}
