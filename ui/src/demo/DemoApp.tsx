import { useCallback, useState } from "react";
import { Check, Loader2, Play, ExternalLink, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeading, CapsLabel } from "@/components/section-heading";
import { LedgerList, Stat } from "@/components/ledger-parts";
import { ThemeToggle } from "@/components/theme-toggle";
import { Mark } from "@/components/mark";
import { ON_LEDGER, NEVER_ON_LEDGER } from "@/lib/ledger-facts";
import { truncateMiddle } from "@/lib/utils";
import {
  DEMO_AGENT_NAME,
  DEMO_AGENT_PSEUDONYM,
  DEMO_CAP,
  DEMO_CASCADE,
  DEMO_CONTRACT,
  DEMO_LEDGER,
  DEMO_STEPS,
  EXPLORER_CONTRACT,
  type DemoStep,
} from "./fixture";

const REPO_URL = "https://github.com/tomiin/midnight-mandate";

const LUMERA_TX_QUERY = `https://lcd.testnet.lumera.io/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(
  `message.sender='${DEMO_CASCADE.lumeraAddress}'`,
)}&limit=20&order_by=ORDER_BY_DESC`;

type PlayState = "idle" | "running" | "done";

/** Keep only the contract's own assert from the SDK's wrapper string. */
function rawReason(message: string): string {
  const i = message.indexOf("failed assert:");
  return i >= 0 ? message.slice(i) : message;
}

function StepRow({
  step,
  state,
  onRun,
}: {
  step: DemoStep;
  state: PlayState;
  onRun: (id: string) => void;
}) {
  const refused = state === "done" && step.outcome === "refused";
  const passed = state === "done" && step.outcome === "passed";
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-border py-5">
      <div className="w-9 flex-none text-[25px] font-extrabold leading-tight tabular-nums">
        {step.n}
      </div>

      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[17px] font-extrabold leading-snug">
            {step.title}
          </span>
          <span className="border border-border px-1.5 py-0.5 text-[11px]">
            as {step.actor}
          </span>
          {step.expectRefusal && (
            <span className="border border-foreground px-2 py-0.5 text-[11px] font-extrabold">
              Must fail
            </span>
          )}
        </div>
        <p className="m-0 max-w-[640px] text-sm text-muted-foreground">{step.body}</p>

        {state === "running" && (
          <p className="m-0 text-[13px]">
            In the real run, this is where the zero-knowledge proof is built on
            the agent's machine.
          </p>
        )}

        {refused && (
          <div className="mt-1 flex items-start gap-3 bg-seal-tint px-4 py-3.5">
            <span className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center bg-seal text-white">
              <Minus className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[15px] font-extrabold leading-snug">
                {step.refusal}
              </span>
              <span className="text-[13px]">
                Refused on the agent's own machine. No valid proof exists, so
                nothing was submitted or paid.
              </span>
              {step.raw && (
                <code className="break-words font-mono text-xs text-muted-foreground">
                  {rawReason(step.raw)}
                </code>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-[0_0_176px] flex-col items-start gap-2">
        {state === "idle" && (
          <Button className="min-w-[120px] justify-start" onClick={() => onRun(step.id)}>
            <Play className="fill-current" />
            {step.expectRefusal ? "Try it" : "Run"}
          </Button>
        )}
        {state === "running" && (
          <span className="flex items-center gap-2.5 py-2 text-sm font-extrabold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Proving…
          </span>
        )}
        {passed && (
          <span className="flex items-center gap-2 py-1.5 text-sm font-extrabold">
            <span className="flex h-[22px] w-[22px] items-center justify-center bg-foreground text-background">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            Done
          </span>
        )}
        {refused && (
          <span className="flex items-center gap-2 py-1.5 text-sm font-extrabold text-seal-ink">
            <span className="flex h-[22px] w-[22px] items-center justify-center bg-seal text-white">
              <Minus className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            Refused as required
          </span>
        )}
      </div>
    </div>
  );
}

export function DemoApp() {
  const [states, setStates] = useState<Record<string, PlayState>>({});

  const run = useCallback((id: string) => {
    setStates((s) => ({ ...s, [id]: "running" }));
    // The real proof takes a few seconds of local construction. A brief
    // pause keeps the replay honest about that rather than snapping to an
    // answer that in reality took work to produce.
    setTimeout(() => {
      setStates((s) => ({ ...s, [id]: "done" }));
    }, 900);
  }, []);

  const allDone = DEMO_STEPS.every((s) => states[s.id] === "done");

  const runAll = useCallback(() => {
    setStates({});
    DEMO_STEPS.forEach((step, i) => {
      setTimeout(() => run(step.id), i * 700);
    });
  }, [run]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---- demo banner ------------------------------------------------- */}
      <div className="sticky top-0 z-10 bg-foreground text-background">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-baseline gap-x-3.5 gap-y-1.5 px-[clamp(16px,4vw,32px)] py-2.5 text-sm">
          <span className="border border-current px-2 py-px text-xs font-extrabold uppercase tracking-[0.1em]">
            Demo mode
          </span>
          <span className="flex-[1_1_480px]">
            This page replays a real run recorded on Midnight Preprod,
            including the two refusals, which are the exact messages the
            contract produced. Signing needs a wallet and a proof server, so
            the live app runs locally.
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap font-extrabold text-inherit"
          >
            Run it for real →
          </a>
        </div>
        <div
          aria-hidden
          className="h-2"
          style={{
            background:
              "repeating-linear-gradient(135deg, var(--foreground) 0 8px, var(--background) 8px 16px)",
          }}
        />
      </div>

      <div className="mx-auto flex max-w-[1200px] flex-col gap-14 px-[clamp(16px,4vw,32px)] pb-24">
        {/* ---- header ---------------------------------------------------- */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b-2 border-border py-5">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            <Mark size={32} className="shrink-0 text-seal" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[22px] font-extrabold leading-tight tracking-tight">
                Mandate
              </span>
              <span className="text-[13px] text-muted-foreground">
                Spending limits for AI agents, enforced by zero-knowledge proof.
              </span>
            </div>
          </div>
          <ThemeToggle />
        </header>

        {/* ---- intro ----------------------------------------------------- */}
        <section className="flex max-w-[760px] flex-col gap-3">
          <h1 className="m-0 text-[32px] font-extrabold leading-tight tracking-tight">
            An agent that can prove it's allowed to spend, without saying who
            it works for.
          </h1>
          <p className="m-0 text-[15px]">
            AI agents are starting to book travel and buy things for people and
            companies. Mandate lets an owner give an agent a budget, and lets
            anyone the agent buys from check that it's authorized and within
            that budget. The seller never learns who the owner is, the agent's
            real name, or what the budget is for. An agent that goes over its
            cap, or has been fired, can't produce a valid proof at all.
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            What this does not hide: the cap and running totals are plain
            numbers on the public ledger. They just aren't tied to anyone.
          </p>
        </section>

        {/* ---- 01 contract ----------------------------------------------- */}
        <section className="flex flex-col gap-4">
          <SectionHeading index="01" title="Contract">
            <span className="text-sm text-muted-foreground">
              Live on Midnight Preprod. Everything below happened here.
            </span>
          </SectionHeading>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y-2 border-border py-4">
            <span className="break-all font-mono text-[17px]" title={DEMO_CONTRACT}>
              {truncateMiddle(DEMO_CONTRACT, 12, 8)}
            </span>
            <a
              href={EXPLORER_CONTRACT}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </section>

        {/* ---- 02 public ledger ------------------------------------------ */}
        <section className="flex flex-col gap-4">
          <SectionHeading index="02" title="Public ledger">
            <span className="text-sm text-muted-foreground">
              As it read after the run. Anyone can read these.
            </span>
          </SectionHeading>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-[2px] border-y-2 border-border bg-border">
            <div className="grid grid-cols-2 gap-[2px]">
              <Stat label={DEMO_LEDGER[0].label} value={DEMO_LEDGER[0].value} />
              <Stat label={DEMO_LEDGER[1].label} value={DEMO_LEDGER[1].value} />
            </div>
            <div className="grid grid-cols-2 gap-[2px]">
              <Stat label={DEMO_LEDGER[2].label} value={DEMO_LEDGER[2].value} />
              <Stat
                label={DEMO_LEDGER[3].label}
                value={DEMO_LEDGER[3].value}
                note={DEMO_LEDGER[3].note}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-[2px] border-b-2 border-border bg-border">
            <LedgerList title="On the ledger" items={ON_LEDGER} />
            <LedgerList title="Never on the ledger" items={NEVER_ON_LEDGER} absent />
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            "Times exercised" reads 1, not 3: the two refusals below never
            reached the chain, because an invalid proof can't be built.
          </p>
        </section>

        {/* ---- 03 walkthrough -------------------------------------------- */}
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end gap-4 border-b-2 border-border pb-4">
            <div className="mr-auto flex flex-col gap-1.5">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-muted-foreground">03</span>
                <h2 className="m-0 text-[32px] font-extrabold tracking-tight">
                  Guided walkthrough
                </h2>
              </div>
              <p className="m-0 max-w-[620px] text-[15px]">
                Hire an agent, give it a ${DEMO_CAP} travel budget, and watch it
                try to overspend. Steps 5 and 7 must be refused — that's the
                product working.
              </p>
            </div>
            <Button onClick={runAll}>
              <Play className="fill-current" />
              {allDone ? "Replay all" : "Run all"}
            </Button>
          </div>

          <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
            <CapsLabel>On-chain, "{DEMO_AGENT_NAME}" is</CapsLabel>
            <code className="font-mono">{DEMO_AGENT_PSEUDONYM}…</code>
          </div>

          <div className="flex flex-col border-t-2 border-border">
            {DEMO_STEPS.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                state={states[step.id] ?? "idle"}
                onRun={run}
              />
            ))}
          </div>
        </section>

        {/* ---- cascade --------------------------------------------------- */}
        <section className="flex flex-col gap-4">
          <SectionHeading index="04" title="Cascade backup" />
          <p className="m-0 max-w-[760px] text-[15px]">
            On-chain the agent is only a hash, so the mapping back to "
            {DEMO_AGENT_NAME}, ${DEMO_CAP}" is encrypted in the browser and
            stored on Cascade (Lumera's decentralized storage). Lose the laptop
            and you can still say what the hash meant. The contract works the
            same with or without it.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-[2px] border-y-2 border-border bg-border">
            <div className="flex flex-col gap-1.5 bg-background p-5">
              <CapsLabel>Cascade action</CapsLabel>
              <span className="font-mono text-[17px]">{DEMO_CASCADE.actionId}</span>
            </div>
            <div className="flex flex-col gap-1.5 bg-background p-5">
              <CapsLabel>Lumera block</CapsLabel>
              <span className="font-mono text-[17px]">{DEMO_CASCADE.block}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 bg-background p-5">
              <CapsLabel>Transaction</CapsLabel>
              <span className="font-mono text-[13px]" title={DEMO_CASCADE.txHash}>
                {truncateMiddle(DEMO_CASCADE.txHash, 12, 8)}
              </span>
            </div>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            Uploaded from the browser on {DEMO_CASCADE.backedUpAt}, then
            downloaded and decrypted from the command line: two separate crypto
            implementations agreeing.
          </p>
        </section>

        {/* ---- check it yourself ----------------------------------------- */}
        <section className="flex flex-col gap-4">
          <SectionHeading index="05" title="Check any of this yourself" />
          <div className="flex flex-col border-t-2 border-border">
            <a
              href={EXPLORER_CONTRACT}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 border-b border-border py-4 hover:bg-foreground/[0.04]"
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-extrabold">The contract on the Preprod explorer</span>
                <span className="text-sm text-muted-foreground">
                  The counters above are read straight off it.
                </span>
              </span>
              <ExternalLink className="h-4 w-4 flex-none" />
            </a>
            <a
              href={LUMERA_TX_QUERY}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 border-b border-border py-4 hover:bg-foreground/[0.04]"
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-extrabold">The Cascade backup on Lumera</span>
                <span className="text-sm text-muted-foreground">
                  A live query, no account needed. The repo also ships
                  scripts/verify-onchain.mjs, which prints the same evidence.
                </span>
              </span>
              <ExternalLink className="h-4 w-4 flex-none" />
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 border-b border-border py-4 hover:bg-foreground/[0.04]"
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-extrabold">The source code</span>
                <span className="text-sm text-muted-foreground">
                  Compact contract, tests, and the app. Apache-2.0.
                </span>
              </span>
              <ExternalLink className="h-4 w-4 flex-none" />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
