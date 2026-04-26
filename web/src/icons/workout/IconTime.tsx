type Props = { size?: number; className?: string }

export function IconTime({ size = 24, className }: Props) {
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
      <circle cx="12" cy="13" r="7" />
      <line x1="10" y1="3" x2="14" y2="3" />
      <line x1="12" y1="3" x2="12" y2="6" />
      <line x1="12" y1="13" x2="12" y2="9" />
      <line x1="12" y1="13" x2="15.5" y2="14.5" />
    </svg>
  )
}
