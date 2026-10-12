// ============ Surface ============
// The card skin of the app: a border, the card radius, the card colour and the
// card shadow. A surface that is one whole link or button sets `interactive`
// and lifts on hover. A button surface always lifts and presses, because a
// button is one whole action. A details surface renders a <details> root, and
// its children set the <summary>. A surface that only holds content stays
// still. The caller owns the padding and the inner layout. Styles: the
// yf-surface rules in src/styles.css.
import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react'

/** The element a surface renders as. A button is one whole action. A details root folds its children. */
export type SurfaceTag = 'div' | 'article' | 'li' | 'section' | 'button' | 'details'

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> {
  as?: SurfaceTag
  className?: string
  /** True when the whole surface is one link or button. It then lifts on hover. A button surface lifts without it. */
  interactive?: boolean
  /** The place of this surface in a list. It sets the entrance delay. */
  enterIndex?: number
  /** The button type. Used only when `as` is 'button'. It defaults to 'button', so the surface never submits a form by accident. */
  type?: 'button' | 'submit' | 'reset'
  children?: ReactNode
}

/** The largest step of the entrance delay, so a long list does not wait. */
const MAX_ENTER_STEP = 8

/** A button is one whole action, so it lifts and presses like an interactive surface. */
export function surfaceIsInteractive(as: SurfaceTag, interactive: boolean): boolean {
  return interactive || as === 'button'
}

/** The type a button surface sets: the caller's type, or 'button'. Every other tag gets none. */
export function surfaceButtonType(as: SurfaceTag, type?: SurfaceProps['type']): SurfaceProps['type'] | undefined {
  if (as !== 'button') return undefined
  return type ?? 'button'
}

export function Surface({
  as = 'div',
  className,
  interactive = false,
  enterIndex,
  type,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const Tag: ElementType = as
  const hasEnter = enterIndex !== undefined
  const classNames = ['yf-surface']
  if (surfaceIsInteractive(as, interactive)) classNames.push('is-interactive')
  if (hasEnter) classNames.push('is-entering')
  if (className) classNames.push(className)
  const enterDelay: CSSProperties | undefined = hasEnter
    ? { animationDelay: `calc(var(--stagger-step) * ${Math.min(enterIndex, MAX_ENTER_STEP)})` }
    : undefined
  const buttonType = surfaceButtonType(as, type)
  return (
    <Tag
      className={classNames.join(' ')}
      style={enterDelay ? { ...enterDelay, ...style } : style}
      {...(buttonType ? { type: buttonType } : {})}
      {...rest}
    >
      {children}
    </Tag>
  )
}
