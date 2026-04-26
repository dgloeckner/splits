type Props = { size?: number; className?: string }

export function IconJustRow({ size = 24, className }: Props) {
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
      <path d="M 3 8 Q 6 5, 9 8 T 15 8 T 21 8" />
      <path d="M 3 12 Q 6 9, 9 12 T 15 12 T 21 12" opacity={0.75} />
      <path d="M 3 16 Q 6 13, 9 16 T 15 16 T 21 16" opacity={0.5} />
    </svg>
  )
}
