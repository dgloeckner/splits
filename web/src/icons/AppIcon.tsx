type Props = { size?: number; className?: string }

// Brand mark: three solid vertical bars in pyramid form (small-big-small)
// over a teal waterline. Simplified from home_ergo_pyramid_logo_family.svg.
export function AppIcon({ size = 28, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-40 -40 80 80"
      role="img"
      aria-label="home-ergo"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="-26" y="-8" width="12" height="28" rx="2" fill="currentColor" />
      <rect x="-6" y="-28" width="12" height="48" rx="2" fill="currentColor" />
      <rect x="14" y="-8" width="12" height="28" rx="2" fill="currentColor" />
      <line
        x1="-32"
        y1="28"
        x2="32"
        y2="28"
        stroke="var(--color-primary, #14B8A6)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}
