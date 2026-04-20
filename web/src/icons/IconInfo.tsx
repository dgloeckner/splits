import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconInfo(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.5v.01" />
      <path d="M12 12v4" />
    </IconBase>
  )
}
