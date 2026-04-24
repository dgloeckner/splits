type Props = { size?: number; className?: string }

// Pyramid + waterline mark from home_ergo_pyramid_logo_family.svg,
// dark variant: five bars ascending-then-descending, teal waterline.
export function AppIcon({ size = 28, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-60 -40 120 110"
      role="img"
      aria-label="home-ergo"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="-55" y="-5" width="10" height="26" rx="5" fill="currentColor" opacity="0.35" />
      <rect x="-33" y="-15" width="10" height="46" rx="5" fill="currentColor" opacity="0.6" />
      <rect x="-11" y="-30" width="10" height="76" rx="5" fill="currentColor" />
      <rect x="11" y="-15" width="10" height="46" rx="5" fill="currentColor" opacity="0.6" />
      <rect x="33" y="-5" width="10" height="26" rx="5" fill="currentColor" opacity="0.35" />
      <line x1="-60" y1="56" x2="60" y2="56" stroke="var(--color-primary, #14B8A6)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}
