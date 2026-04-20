import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </IconBase>
  )
}
