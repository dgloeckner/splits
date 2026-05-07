type Props = { size?: number; className?: string }

export function IconRace({ size = 24, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden
      className={className}
    >
      {/* Hull */}
      <path d="M 3 14 Q 12 11 21 14 L 19 17 Q 12 18 5 17 Z" fill="currentColor" fillOpacity={0.18} />
      {/* Mast / rower */}
      <line x1="12" y1="14" x2="12" y2="7" />
      {/* Oar */}
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  )
}
