import type { ReactNode } from "react";

/** Numbered section heading from the design: a small mono index ("01"),
 *  then the title in heavy Archivo. Anything passed as children sits to the
 *  right (tags, or an action pushed over with ml-auto). */
export function SectionHeading({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <span className="font-mono text-xs text-muted-foreground">{index}</span>
      <h2 className="m-0 text-[25px] font-extrabold tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

/** Small caps label used above figures and addresses. */
export function CapsLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </span>
  );
}

/** Real errors: a dashed ink frame and a warning glyph, never red, so they
 *  can't be confused with a correct refusal (which is red on purpose). */
export function DashedNotice({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 border-2 border-dashed border-foreground px-3.5 py-3">
      <svg
        className="mt-0.5 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden
      >
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-extrabold">{title}</span>
        {children && <span className="text-[13px]">{children}</span>}
      </div>
    </div>
  );
}
