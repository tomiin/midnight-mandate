/**
 * The Mandate mark, direction 1a "Ceiling": a faceless head under a hard
 * bar. The bar is the spending cap; the gap beneath it is the budget left.
 * The head has no face on purpose — on-chain an agent is only a one-way
 * hash of its key.
 *
 * Geometry is copied from the Claude Design export. It inherits
 * `currentColor`, so colour it with a text-* class (text-seal for the
 * brand red, text-foreground for flat ink).
 */
export function Mark({
  size = 32,
  className,
  title = "Mandate",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      role="img"
      aria-label={title}
      className={className}
    >
      <rect x="4" y="3" width="24" height="4" />
      <circle cx="16" cy="21" r="8" />
    </svg>
  );
}
