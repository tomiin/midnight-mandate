import { CapsLabel } from "@/components/section-heading";

/** One headline number from the public ledger, in a ruled grid cell. */
export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-background p-5">
      <CapsLabel>{label}</CapsLabel>
      <div className="flex items-baseline gap-2">
        <span className="text-[42px] font-extrabold leading-none tabular-nums">
          {value}
        </span>
        {note && <span className="text-sm text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
}

export function LedgerList({
  title,
  items,
  absent = false,
}: {
  title: string;
  items: string[];
  absent?: boolean;
}) {
  return (
    <div className="flex flex-[1_1_360px] flex-col gap-2.5 bg-background px-5 py-4">
      <span className="text-sm font-extrabold">{title}</span>
      {items.map((item) => (
        <span key={item} className="flex items-baseline gap-2.5 text-sm">
          <span
            aria-hidden
            className={
              absent
                ? "h-2 w-2 flex-none border-2 border-foreground"
                : "h-2 w-2 flex-none bg-foreground"
            }
          />
          <span className={absent ? "line-through decoration-2" : undefined}>
            {item}
          </span>
        </span>
      ))}
    </div>
  );
}

