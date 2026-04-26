type Props = { size?: number; className?: string }

export function IconInterval({ size = 24, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-hidden
      className={className}
    >
      <rect x="3" y="6" width="3.5" height="12" rx="1" />
      <rect x="8" y="13" width="3.5" height="5" rx="1" opacity={0.5} />
      <rect x="13" y="6" width="3.5" height="12" rx="1" />
      <rect x="18" y="13" width="3.5" height="5" rx="1" opacity={0.5} />
    </svg>
  )
}
