import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M21 3v6" />
      <path d="M21 3h-6" />
    </IconBase>
  )
}
