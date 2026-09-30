import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SectionHeading,
  CapsLabel,
  DashedNotice,
} from "@/components/section-heading";
import { useWallet } from "@/hooks/use-wallet";
import { groupDigits, truncateMiddle } from "@/lib/utils";

/** The explorer states 1 tDUST = 10^15 SPECK. Balances come back in the
 *  smallest unit, so this renders a readable figure alongside the raw value
 *  rather than silently assuming a denomination. */
const SPECK_PER_DUST = 10n ** 15n;

/** NIGHT carries 6 decimals. Established by observation rather than
 *  assumption: the wallet reported 1,000,000,000 atomic units for the same
 *  account Lace displayed as 1,000 tNIGHT. */
const ATOMIC_PER_NIGHT = 10n ** 6n;

/** The native token's raw identifier is all zeros. Anything else is some
 *  other unshielded token and is shown by its raw id instead of guessing. */
function isNativeToken(raw: string): boolean {
  return /^0+$/.test(raw);
}

/** Integer maths on bigint throughout, so a large balance never loses
 *  precision through a float. */
function formatUnits(raw: bigint, perUnit: bigint, fractionDigits: number): string {
  const whole = groupDigits((raw / perUnit).toString());
  if (fractionDigits === 0) return whole;
  const width = perUnit.toString().length - 1;
  const frac = (raw % perUnit).toString().padStart(width, "0").slice(0, fractionDigits);
  return `${whole}.${frac}`;
}

/** Share of the cap as a percentage, for the fill bar. */
function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Math.min(100, Number((part * 1000n) / whole) / 10);
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-background p-5">{children}</div>
  );
}

function AddressCell({
  label,
  address,
  note,
}: {
  label: string;
  address: string | null;
  note: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Cell>
      <CapsLabel>{label}</CapsLabel>
      {address ? (
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-[13px]" title={address}>
            {truncateMiddle(address, 12, 8)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={async () => {
              await navigator.clipboard.writeText(address);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      ) : (
        <span className="text-[13px] text-muted-foreground">Not reported by the wallet</span>
      )}
      <p className="text-xs text-muted-foreground">{note}</p>
    </Cell>
  );
}

export function AccountPanel() {
  const {
    status,
    shieldedAddress,
    unshieldedAddress,
    dust,
    unshieldedBalances,
    refreshBalances,
    error,
  } = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  if (status !== "connected") return null;

  const empty = dust !== null && dust.balance === 0n;
  const entries = Object.entries(unshieldedBalances ?? {});
  const night = entries.find(([token]) => isNativeToken(token))?.[1] ?? 0n;
  const otherTokens = entries.filter(([token]) => !isNativeToken(token));

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading index="01" title="Your account">
        <Button
          variant="outline"
          size="sm"
          className="ml-auto self-center"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await refreshBalances();
            setRefreshing(false);
          }}
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </SectionHeading>

      {error && <DashedNotice title="Couldn't read everything from the wallet">{error}</DashedNotice>}

      {/* Rules between cells come from a 2px gap over the border colour. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-[2px] border-y-2 border-border bg-border">
        <div className="grid grid-cols-2 gap-[2px]">
          {/* DUST first: it gates every action. */}
          <Cell>
            <CapsLabel>DUST · fee resource</CapsLabel>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[32px] font-extrabold leading-none tabular-nums"
                title={dust ? `raw: ${groupDigits(dust.balance.toString())} SPECK` : undefined}
              >
                {dust ? formatUnits(dust.balance, SPECK_PER_DUST, 2) : "—"}
              </span>
              <span className="text-sm">tDUST</span>
            </div>
            <div className="h-1 bg-accent">
              <div
                className="h-1 bg-foreground"
                style={{ width: `${dust ? percentOf(dust.balance, dust.cap) : 0}%` }}
              />
            </div>
            {dust && (
              <span className="text-[13px]">
                available · cap {formatUnits(dust.cap, SPECK_PER_DUST, 0)}
              </span>
            )}
            {empty ? (
              <DashedNotice title="tDUST tank empty">
                Every transaction needs DUST for fees, so all steps are
                blocked. Your NIGHT generates more continuously — wait a
                moment and refresh.
              </DashedNotice>
            ) : (
              <span className="text-[13px] text-muted-foreground">
                Generated continuously by your NIGHT. Every transaction
                spends a little.
              </span>
            )}
          </Cell>

          <Cell>
            <CapsLabel>NIGHT</CapsLabel>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[32px] font-extrabold leading-none tabular-nums"
                title={`raw: ${groupDigits(night.toString())}`}
              >
                {formatUnits(night, ATOMIC_PER_NIGHT, 0)}
              </span>
              <span className="text-sm">tNIGHT</span>
            </div>
            <span className="text-[13px] text-muted-foreground">
              Never spent on fees — it's the asset that generates DUST.
            </span>
            {otherTokens.map(([token, amount]) => (
              <div key={token} className="flex justify-between gap-3 text-xs">
                <span className="truncate font-mono" title={token}>
                  {truncateMiddle(token, 8, 6)}
                </span>
                <span className="tabular-nums">{groupDigits(amount.toString())}</span>
              </div>
            ))}
          </Cell>
        </div>

        <div className="grid grid-cols-2 gap-[2px]">
          <AddressCell
            label="Unshielded address"
            address={unshieldedAddress}
            note="Holds your NIGHT. This is where a faucet sends funds."
          />
          <AddressCell
            label="Shielded address"
            address={shieldedAddress}
            note="Your Zswap identity. The SDK needs it for every contract call, but Mandate moves no tokens, so no shielded value is ever spent."
          />
        </div>
      </div>
    </section>
  );
}
