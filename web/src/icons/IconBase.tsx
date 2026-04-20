import type { SVGProps, ReactNode } from 'react'

type Props = SVGProps<SVGSVGElement> & { title?: string; children: ReactNode }

export function IconBase({ title, children, ...rest }: Props) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {children}
    </svg>
  )
}
