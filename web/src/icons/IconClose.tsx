import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5 5 19 19" />
      <path d="M19 5 5 19" />
    </IconBase>
  )
}
