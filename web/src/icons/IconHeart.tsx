import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconHeart(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9Z" />
    </IconBase>
  )
}
