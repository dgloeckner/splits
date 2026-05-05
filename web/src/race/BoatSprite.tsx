import type { JSX } from 'react'

type Props = { variant?: 'full' | 'hull'; flipped?: boolean }

export function BoatSprite({ variant = 'full', flipped = false }: Props): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 24"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      role="img"
      aria-label="Boat"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path
        d="M 2 11 Q 28 7 56 8 L 70 11 L 56 14 Q 28 15 2 11 Z"
        fill="currentColor"
        fillOpacity="0.16"
        strokeWidth="1.5"
      />
      {variant === 'full' && (
        <>
          <path d="M 30 8 Q 35 2 40 6" strokeWidth="1.6" />
          <circle cx="40" cy="3" r="2" fill="currentColor" stroke="none" />
          <line x1="34" y1="6" x2="14" y2="20" strokeWidth="1.2" />
          <ellipse cx="11" cy="20.5" rx="3" ry="1" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}
