type Props = { size?: number; className?: string }

// Rowing silhouette (Drive position) from workout_icon_final.svg, 24px
// variant. Uses currentColor so the BottomNav active/inactive color
// rules apply like the other icons.
export function IconWorkout({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(12, 12)" fill="currentColor" stroke="currentColor">
        <circle cx="1.5" cy="-8" r="2" stroke="none" />
        <path d="M 0 -6 L 3 -6 L 3.5 -2 L 2 -0.5 L 0.5 -0.5 L -1 -3 Z" stroke="none" />
        <path d="M 1 -1.5 L 7 -0.5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <rect x="6" y="-2" width="5" height="2" rx="1" stroke="none" />
        <path d="M 0 -0.5 L -5 5.5" strokeWidth="2.3" strokeLinecap="round" fill="none" />
        <rect x="-7" y="4.5" width="3" height="1.5" rx="0.5" stroke="none" />
      </g>
    </svg>
  )
}
