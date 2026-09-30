import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Insert thousands separators into a digit string.
 *
 * Takes a string rather than a number because these values are bigints —
 * converting through Number would lose precision on large balances, which
 * is exactly the wrong trade for a figure someone is checking against
 * their wallet.
 */
export function groupDigits(digits: string): string {
  const negative = digits.startsWith("-");
  const body = negative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

/** Middle-truncate a long hash or address: keeps the start and end, which
 *  is what people compare by eye. The design uses first 12 / last 8 for
 *  hashes. */
export function truncateMiddle(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
