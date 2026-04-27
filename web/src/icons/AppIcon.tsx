type Props = { size?: number; className?: string }

// Brand mark: three ascending bars (splits).
export function AppIcon({ size = 28, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="splits"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="14" width="4" height="7" rx="1" fill="currentColor" />
      <rect x="10" y="9" width="4" height="12" rx="1" fill="currentColor" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" />
    </svg>
  )
}
