type Props = { size?: number; className?: string }

export function IconPyramid({ size = 24, className }: Props) {
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
      <rect x="2" y="14" width="3" height="6" rx="1" opacity={0.5} />
      <rect x="6" y="10" width="3" height="10" rx="1" opacity={0.75} />
      <rect x="10" y="6" width="3" height="14" rx="1" />
      <rect x="14" y="10" width="3" height="10" rx="1" opacity={0.75} />
      <rect x="18" y="14" width="3" height="6" rx="1" opacity={0.5} />
    </svg>
  )
}
