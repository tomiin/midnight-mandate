import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Play, Sparkles, CloudUpload, ExternalLink, Lock, Minus, TriangleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapsLabel, DashedNotice } from "@/components/section-heading";
import { PRIVATE_STATE_ID } from "mandate-api";
import { createPrivateState } from "mandate-contract";
import { pureCircuits } from "mandate-contract/src/managed/mandate/contract/index.js";
import { useMandate } from "@/providers/mandate-context";
import { useCascade } from "@/providers/cascade-context";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { groupDigits } from "@/lib/utils";

const AGENT_KEY_STORAGE = "mandate_agent_secret_key";
const AGENT_NAME_STORAGE = "mandate_agent_name";
const AGENT_CAP_STORAGE = "mandate_agent_cap";
/** Per-contract record of what was last backed up to Cascade, so the app
 *  can say "already done" instead of leaving you guessing. Keyed by
 *  contract address the same way walkthrough progress is. */
const BACKUP_KEY_PREFIX = "mandate_cascade_backup_";

/** The category this demo drives. It's an opaque number on-chain — this
 *  label, and the whole travel narrative around it, exist only in this UI.
 *  Category 1 mirrors the "travel" entry in policy-reference.json, so the
 *  Cascade backup (once wired in) and this demo agree on what "1" means. */
const CATEGORY = 1n;
const DEFAULT_AGENT_NAME = "Travel Booking Agent";
const DEFAULT_CAP = "500";

type StepState = "idle" | "running" | "passed" | "refused" | "error";

interface WalkStep {
  id: string;
  actor: "principal" | "agent";
  expectRefusal: boolean;
  title: string;
  body: string;
  /** For must-fail steps: the contract's own assert text this refusal must carry. */
  expectedReason?: string;
  /** For must-fail steps: the plain-English headline shown on the refusal stamp. */
  refusal?: string;
  action: () => Promise<unknown>;
}

/** Strip the SDK's wrapper so the evidence line shows only the contract's
 *  own assert, e.g. "failed assert: Mandate: category budget exceeded…". */
function rawReason(message: string): string {
  const i = message.indexOf("failed assert:");
  return i >= 0 ? message.slice(i) : message;
}

interface StepResult {
  state: StepState;
  message?: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function loadOrCreateAgentKey(): Uint8Array {
  const stored = localStorage.getItem(AGENT_KEY_STORAGE);
  if (stored) return fromHex(stored);
  const fresh = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(AGENT_KEY_STORAGE, toHex(fresh));
  return fresh;
}

function loadPrincipalKey(): Uint8Array {
  const stored = localStorage.getItem("mandate_secret_key");
  if (!stored) throw new Error("No principal key found — deploy a contract first.");
  return fromHex(stored);
}

/** Parse a plain non-negative integer typed into the budget field. Returns
 *  null for anything that isn't one, so the caller can tell "not ready yet"
 *  apart from "zero". */
function parseCap(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  try {
    const value = BigInt(trimmed);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/** What a completed Cascade backup looked like, as persisted locally. */
interface BackupRecord {
  actionId: string;
  backedUpAt: string;
  agentName: string;
  capUnits: string | null;
  /** Hex agent pseudonym the backup described. If the current agent's
   *  pseudonym differs, this record is about a different agent. */
  pseudonym: string;
  /** Lumera account that paid for and signed the upload. Stored so the
   *  "verify on chain" link still works on a later visit, when the
   *  Cascade wallet may not be connected. */
  lumeraAddress?: string | null;
}

function readBackupRecord(contractAddress: string): BackupRecord | null {
  try {
    const raw = localStorage.getItem(`${BACKUP_KEY_PREFIX}${contractAddress}`);
    return raw ? (JSON.parse(raw) as BackupRecord) : null;
  } catch {
    return null;
  }
}

export function Walkthrough() {
  const { contract, contractAddress, deploy, status, error } = useMandate();
  const { providers } = useMidnightProviders();
  const [results, setResults] = useState<Record<string, StepResult>>({});

  const [agentName, setAgentName] = useState(
    () => localStorage.getItem(AGENT_NAME_STORAGE) ?? DEFAULT_AGENT_NAME,
  );
  const [capText, setCapText] = useState(
    () => localStorage.getItem(AGENT_CAP_STORAGE) ?? DEFAULT_CAP,
  );

  useEffect(() => {
    localStorage.setItem(AGENT_NAME_STORAGE, agentName);
  }, [agentName]);

  useEffect(() => {
    localStorage.setItem(AGENT_CAP_STORAGE, capText);
  }, [capText]);

  const [backupRecord, setBackupRecord] = useState<BackupRecord | null>(null);

  useEffect(() => {
    setBackupRecord(contractAddress ? readBackupRecord(contractAddress) : null);
  }, [contractAddress]);

  // Progress is stored per contract address. On-chain state is permanent, so
  // switching back to a contract you used earlier should show what you
  // already ran against it rather than a blank slate. A *new* contract
  // genuinely starts empty, which is what makes "Start fresh" a clean run.
  useEffect(() => {
    if (!contractAddress) {
      setResults({});
      return;
    }
    try {
      const saved = localStorage.getItem(`mandate_steps_${contractAddress}`);
      setResults(saved ? (JSON.parse(saved) as Record<string, StepResult>) : {});
    } catch {
      setResults({});
    }
  }, [contractAddress]);

  useEffect(() => {
    if (!contractAddress) return;
    if (Object.keys(results).length === 0) return;
    try {
      localStorage.setItem(
        `mandate_steps_${contractAddress}`,
        JSON.stringify(results),
      );
    } catch {
      // Storage full or unavailable — progress display is a convenience,
      // never a source of truth. The chain is.
    }
  }, [contractAddress, results]);

  const agentKey = useMemo(() => loadOrCreateAgentKey(), []);
  const agentPseudonym = useMemo(
    () => pureCircuits.agentId(agentKey),
    [agentKey],
  );

  // Once any step has actually run against the chain, the name/budget you
  // typed are baked into what's already been submitted. Letting them keep
  // changing would desync the copy on screen from what the contract
  // actually saw, so lock the fields and point at "Start fresh" instead —
  // same rule the rest of this component already uses for on-chain state.
  const locked = Object.values(results).some((r) => r.state !== "idle");

  const cap = useMemo(() => parseCap(capText), [capText]);
  const spendAmounts = useMemo(() => {
    if (cap === null) return null;
    const firstSpend = cap / 2n;
    // Guaranteed to land exactly one unit over the cap regardless of
    // parity: firstSpend + overSpend = cap + 1.
    const overSpend = cap - firstSpend + 1n;
    return { firstSpend, overSpend, postRevokeSpend: 1n };
  }, [cap]);

  const cascade = useCascade();
  const registered = results.register?.state === "passed";

  const backupToCascade = useCallback(async () => {
    const name = agentName.trim() || DEFAULT_AGENT_NAME;
    const fileName = `mandate-policy-${toHex(agentPseudonym).slice(0, 16)}.enc.json`;
    try {
      const actionId = await cascade.backup(
        {
          version: 1,
          agentName: name,
          category: Number(CATEGORY),
          categoryLabel: "travel",
          capUnits: cap !== null ? cap.toString() : null,
        },
        fileName,
      );
      if (contractAddress) {
        const record: BackupRecord = {
          actionId,
          backedUpAt: new Date().toISOString(),
          agentName: name,
          capUnits: cap !== null ? cap.toString() : null,
          pseudonym: toHex(agentPseudonym),
          lumeraAddress: cascade.address,
        };
        try {
          localStorage.setItem(
            `${BACKUP_KEY_PREFIX}${contractAddress}`,
            JSON.stringify(record),
          );
        } catch {
          // Storage unavailable — the upload still happened, we just
          // can't remember it locally. The actionId is shown on screen.
        }
        setBackupRecord(record);
      }
    } catch {
      // cascade.backup already records the error on its own status/error
      // state, which the panel below reads directly — nothing further to
      // do here except stop the rejection from being unhandled.
    }
  }, [cascade, agentName, agentPseudonym, cap, contractAddress]);

  /** Swap the stored private state so the next circuit call runs as the
   *  chosen party. `localSecretKey()` inside the circuit reads whatever is
   *  stored here, which is precisely how the contract distinguishes the
   *  principal from the agent — the same technique the contract's own test
   *  simulator uses to switch actors. */
  const actAs = useCallback(
    async (who: "principal" | "agent") => {
      if (!providers) throw new Error("Providers not ready");
      const key = who === "agent" ? agentKey : loadPrincipalKey();
      // A fresh request id per attempt: it becomes the replay nullifier.
      const requestId = crypto.getRandomValues(new Uint8Array(32));
      await providers.privateStateProvider.set(
        PRIVATE_STATE_ID,
        createPrivateState(key, requestId),
      );
    },
    [providers, agentKey],
  );

  const run = useCallback(
    async (
      id: string,
      actor: "principal" | "agent",
      expectRefusal: boolean,
      action: () => Promise<unknown>,
      expectedReason?: string,
    ) => {
      setResults((r) => ({ ...r, [id]: { state: "running" } }));
      try {
        await actAs(actor);
        await action();
        setResults((r) => ({
          ...r,
          [id]: expectRefusal
            ? {
                state: "error",
                message:
                  "This was supposed to be refused, but it succeeded. That would be a bug in the contract.",
              }
            : { state: "passed" },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A must-fail step only counts as refused if it failed for the
        // reason the contract is supposed to give. Anything else (a locked
        // wallet, a network error) is a real failure, not the product working.
        const refusedCorrectly =
          expectRefusal &&
          (expectedReason === undefined || message.includes(expectedReason));
        setResults((r) => ({
          ...r,
          [id]: refusedCorrectly
            ? { state: "refused", message }
            : { state: "error", message },
        }));
      }
    },
    [actAs],
  );

  const steps = useMemo(() => {
    if (!contract || !spendAmounts) return [];
    const tx = contract.callTx;
    const { firstSpend, overSpend, postRevokeSpend } = spendAmounts;
    const name = agentName.trim() || DEFAULT_AGENT_NAME;
    const list: WalkStep[] = [
      {
        id: "register",
        actor: "principal" as const,
        expectRefusal: false,
        title: `Hire ${name}`,
        body: `You bring ${name} on to handle bookings on your behalf. What lands on-chain is a one-way hash of its key — not its name, not anything that says "travel," nothing that ties it to a real name or company.`,
        action: () => tx.registerAgent(agentPseudonym),
      },
      {
        id: "limit",
        actor: "principal" as const,
        expectRefusal: false,
        title: `Set a $${groupDigits(cap!.toString())} travel budget`,
        body: `The per-period ceiling for travel spending. The number is stored on-chain so it can be enforced — but nothing on-chain says the category is "travel," or that this cap belongs to ${name} specifically.`,
        action: () => tx.setCategoryLimit(CATEGORY, cap!),
      },
      {
        id: "issue",
        actor: "principal" as const,
        expectRefusal: false,
        title: `Authorize ${name} to book travel`,
        body: `Inserts a Merkle commitment binding this agent to the travel category. The grant itself is never revealed on-chain — only that the tree changed.`,
        action: () => tx.issueAuthorization(agentPseudonym, CATEGORY),
      },
      {
        id: "spend-ok",
        actor: "agent" as const,
        expectRefusal: false,
        title: `${name} books a flight for $${groupDigits(firstSpend.toString())}`,
        body: `Now the agent acts on its own. In one proof it shows: it is currently authorized, for this category, this request is not a replay, and the booking fits the budget. The airline gets a proof it's valid, but never learns who authorized the agent or what the budget is for. (The cap and totals themselves are public numbers.)`,
        action: () => tx.exercise(CATEGORY, firstSpend),
      },
      {
        id: "spend-over",
        actor: "agent" as const,
        expectRefusal: true,
        title: `${name} tries to book a $${groupDigits(overSpend.toString())} hotel — must be refused`,
        body: `$${groupDigits(firstSpend.toString())} + $${groupDigits(overSpend.toString())} is one dollar over the $${groupDigits(cap!.toString())} cap. The budget is a running sum across bookings, not a per-booking check, and it's enforced to the dollar. Refusal here is the feature, not a bug.`,
        expectedReason: "category budget exceeded for this period",
        refusal: `Over budget: $${groupDigits(firstSpend.toString())} already spent, plus $${groupDigits(overSpend.toString())} is more than the $${groupDigits(cap!.toString())} cap.`,
        action: () => tx.exercise(CATEGORY, overSpend),
      },
      {
        id: "revoke",
        actor: "principal" as const,
        expectRefusal: false,
        title: `Fire ${name}`,
        body: `The kill switch. Existing grants aren't deleted from the tree — authorization is re-checked live on every single booking attempt instead, so revoking takes effect immediately.`,
        action: () => tx.revokeAgent(agentPseudonym),
      },
      {
        id: "spend-revoked",
        actor: "agent" as const,
        expectRefusal: true,
        title: `Fired ${name} tries to book a $${postRevokeSpend} coffee anyway — must be refused`,
        body: `The grant is still sitting in the Merkle tree and there's still budget left. It's refused anyway, purely because registration is checked live, every time — being in the tree once is never enough on its own.`,
        expectedReason: "agent is not currently authorized",
        refusal: `Not authorized: ${name} has been fired, so no booking can go through.`,
        action: () => tx.exercise(CATEGORY, postRevokeSpend),
      },
    ];
    return list;
  }, [contract, agentPseudonym, agentName, cap, spendAmounts]);

  const hasRun = Object.keys(results).length > 0;

  if (!contractAddress || !contract) return null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4 border-b-2 border-border pb-4">
        <div className="mr-auto flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-muted-foreground">05</span>
            <h2 className="m-0 text-[32px] font-extrabold tracking-tight">
              Guided walkthrough
            </h2>
          </div>
          <p className="m-0 max-w-[620px] text-[15px]">
            Hire an agent, give it a travel budget, and watch it try to
            overspend. Steps 5 and 7 must be refused — that's the product
            working. Refusals happen while the proof is being built on this
            machine, so nothing is ever submitted or paid for.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={status === "deploying" || status === "joining"}
          onClick={deploy}
          title="Deploys a brand new contract so the walkthrough starts from zero"
        >
          {status === "deploying" ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Start fresh
        </Button>
      </div>

      {status === "error" && error && (
        <DashedNotice title="Couldn't deploy a new contract">
          {error}
          {/^wallet is locked/i.test(error)
            ? " — unlock Lace and press Start fresh again."
            : ""}
        </DashedNotice>
      )}
      {hasRun && (
        <p className="m-0 text-sm text-muted-foreground">
          This contract already carries state from steps you've run, and
          on-chain history can't be erased. "Start fresh" deploys a new
          contract so the sequence reads cleanly from zero.
        </p>
      )}

      {/* ---- a / b: set-up and backup ----------------------------------- */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[2px] bg-border">
        <div className="flex flex-col gap-3.5 bg-background pb-6 pr-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-xs font-extrabold">a</span>
            <span className="text-[17px] font-extrabold">Set up your agent</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Agent name
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                disabled={locked}
                placeholder={DEFAULT_AGENT_NAME}
                className="h-9 w-full border border-border bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Monthly budget (USD)
              <input
                value={capText}
                onChange={(e) => setCapText(e.target.value)}
                disabled={locked}
                inputMode="numeric"
                placeholder={DEFAULT_CAP}
                className="h-9 w-full border border-border bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </label>
          </div>
          <p className="m-0 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {locked ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                Locked in for this contract. "Start fresh" to change it.
              </>
            ) : (
              "The name stays in this browser. The dollar figure goes on-chain as a plain number under an opaque category id — nothing on-chain says \"travel\"."
            )}
          </p>
          {cap === null && (
            <DashedNotice title="Enter a budget">
              A whole number of dollars greater than zero.
            </DashedNotice>
          )}
          <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
            <CapsLabel>On-chain, this agent is</CapsLabel>
            <code className="font-mono">{toHex(agentPseudonym).slice(0, 24)}…</code>
          </div>
        </div>

        <div className="flex flex-col gap-3.5 bg-background pb-6 pl-0 sm:pl-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-xs font-extrabold">b</span>
            <span className="text-[17px] font-extrabold">Cascade backup</span>
          </div>
          <p className="m-0 text-[13px] text-muted-foreground">
            Encrypts the agent's name and budget in this browser and stores
            them on Cascade (Lumera), so you can still say what that hash
            means if you lose this device. The contract works the same with
            or without it.
          </p>
          <div>
            <Button
              variant="outline"
              disabled={
                !registered ||
                cascade.status === "connecting" ||
                cascade.status === "uploading"
              }
              onClick={backupToCascade}
              title={
                registered
                  ? "Encrypt and back up this agent's details to Cascade"
                  : "Run step 1 first"
              }
            >
              {cascade.status === "connecting" || cascade.status === "uploading" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CloudUpload />
              )}
              {cascade.status === "connecting"
                ? "Connecting to Keplr..."
                : cascade.status === "uploading"
                  ? "Uploading..."
                  : backupRecord
                    ? "Back up again"
                    : "Back up to Cascade"}
            </Button>
          </div>
          {!registered && (
            <p className="m-0 text-[13px] text-muted-foreground">
              Available once the agent is registered (step 1).
            </p>
          )}
          {backupRecord && (
            <div className="flex flex-col gap-1 border-l-2 border-foreground pl-3 text-[13px]">
              <span className="flex items-center gap-1.5 font-extrabold">
                <Check className="h-3.5 w-3.5" />
                Backed up {new Date(backupRecord.backedUpAt).toLocaleString()}
              </span>
              <span className="text-muted-foreground">
                "{backupRecord.agentName}"
                {backupRecord.capUnits ? ` at $${groupDigits(backupRecord.capUnits)}` : ""}{" "}
                — Cascade action <code className="font-mono">{backupRecord.actionId}</code>
              </span>
              {backupRecord.pseudonym !== toHex(agentPseudonym) && (
                <span className="text-muted-foreground">
                  That backup describes a different agent. Back up again to cover this one.
                </span>
              )}
              {backupRecord.pseudonym === toHex(agentPseudonym) &&
                (backupRecord.agentName !== (agentName.trim() || DEFAULT_AGENT_NAME) ||
                  backupRecord.capUnits !== (cap !== null ? cap.toString() : null)) && (
                  <span className="text-muted-foreground">
                    The name or budget changed since that backup. Back up again.
                  </span>
                )}
              {backupRecord.lumeraAddress && (
                <a
                  href={`https://lcd.testnet.lumera.io/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(
                    `message.sender='${backupRecord.lumeraAddress}'`,
                  )}&limit=20&order_by=ORDER_BY_DESC`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  Verify on chain
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
          {cascade.status === "error" && cascade.error && (
            <DashedNotice title="Backup failed">{cascade.error}</DashedNotice>
          )}
        </div>
      </div>

      {/* ---- the seven steps -------------------------------------------- */}
      <div className="flex flex-col border-t-2 border-border">
        {steps.map((step, index) => {
          const result = results[step.id] ?? { state: "idle" as StepState };
          return (
            <div
              key={step.id}
              className="flex flex-wrap items-start gap-x-5 gap-y-3 border-b border-border py-5"
            >
              <div className="w-9 flex-none text-[25px] font-extrabold leading-tight tabular-nums">
                {index + 1}
              </div>

              <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[17px] font-extrabold leading-snug">
                    {step.title.replace(/ — must be refused$/, "")}
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
                <p className="m-0 max-w-[640px] text-sm text-muted-foreground">
                  {step.body}
                </p>

                {result.state === "running" && (
                  <p className="m-0 text-[13px]">
                    Generating the zero-knowledge proof on this machine. This
                    takes a few seconds.
                  </p>
                )}

                {result.state === "refused" && (
                  <div className="mt-1 flex items-start gap-3 bg-seal-tint px-4 py-3.5">
                    <span className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center bg-seal text-white">
                      <Minus className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[15px] font-extrabold leading-snug">
                        {step.refusal ?? "Refused"}
                      </span>
                      <span className="text-[13px]">
                        Refused on the agent's own machine. No valid proof
                        exists, so nothing was submitted or paid.
                      </span>
                      {result.message && (
                        <code className="break-words font-mono text-xs text-muted-foreground">
                          {rawReason(result.message)}
                        </code>
                      )}
                    </div>
                  </div>
                )}

                {result.state === "error" && (
                  <div className="mt-1">
                    <DashedNotice
                      title={
                        step.expectRefusal
                          ? "Failed, but not for the expected reason"
                          : "This step failed"
                      }
                    >
                      This is a real failure, not a refusal. Fix it and retry.
                      {result.message && (
                        <code className="mt-1.5 block break-words font-mono text-xs text-muted-foreground">
                          {rawReason(result.message)}
                        </code>
                      )}
                    </DashedNotice>
                  </div>
                )}
              </div>

              <div className="flex flex-[0_0_176px] flex-col items-start gap-2">
                {result.state === "idle" && (
                  <Button
                    className="min-w-[120px] justify-start"
                    disabled={cap === null}
                    onClick={() =>
                      run(step.id, step.actor, step.expectRefusal, step.action, step.expectedReason)
                    }
                  >
                    <Play className="fill-current" />
                    {step.expectRefusal ? "Try it" : "Run"}
                  </Button>
                )}
                {result.state === "running" && (
                  <span className="flex items-center gap-2.5 py-2 text-sm font-extrabold">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Proving…
                  </span>
                )}
                {result.state === "passed" && (
                  <span className="flex items-center gap-2 py-1.5 text-sm font-extrabold">
                    <span className="flex h-[22px] w-[22px] items-center justify-center bg-foreground text-background">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    Done
                  </span>
                )}
                {result.state === "refused" && (
                  <span className="flex items-center gap-2 py-1.5 text-sm font-extrabold text-seal-ink">
                    <span className="flex h-[22px] w-[22px] items-center justify-center bg-seal text-white">
                      <Minus className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    Refused as required
                  </span>
                )}
                {result.state === "error" && (
                  <>
                    <span className="flex items-center gap-2 py-1.5 text-sm font-extrabold">
                      <TriangleAlert className="h-[18px] w-[18px]" />
                      Failed
                    </span>
                    <Button
                      variant="outline"
                      onClick={() =>
                        run(step.id, step.actor, step.expectRefusal, step.action, step.expectedReason)
                      }
                    >
                      <RotateCcw />
                      Retry
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
