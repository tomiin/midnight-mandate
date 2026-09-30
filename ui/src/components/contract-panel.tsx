import { useState, type ReactNode } from "react";
import { Loader2, Rocket, Link2, LogOut, Copy, Check, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SectionHeading,
  CapsLabel,
  DashedNotice,
} from "@/components/section-heading";
import { useMandate } from "@/providers/mandate-context";
import { useWallet } from "@/hooks/use-wallet";
import { groupDigits, truncateMiddle } from "@/lib/utils";
import { ON_LEDGER, NEVER_ON_LEDGER } from "@/lib/ledger-facts";
import { Stat, LedgerList } from "@/components/ledger-parts";

const explorerUrl = (address: string) =>
  `https://preprod.midnightexplorer.com/contracts/0x${address}`;

function Muted({ children }: { children: ReactNode }) {
  return <p className="m-0 text-sm text-muted-foreground">{children}</p>;
}

export function ContractPanel() {
  const { status: walletStatus } = useWallet();
  const {
    contractAddress,
    status,
    error,
    state,
    stateError,
    deploy,
    join,
    disconnect,
    knownContracts,
    forget,
  } = useMandate();
  const [addressInput, setAddressInput] = useState("");
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!contractAddress) return;
    await navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const busy = status === "deploying" || status === "joining";
  const walletConnected = walletStatus === "connected";

  // ---- Live public state -------------------------------------------------
  // Everything here is readable by anyone. See ON_LEDGER for what that
  // includes; the counters below are only the headline figures.
  const ledger = state?.contractState ?? null;

  // `agents.size()` counts map ENTRIES, and revocation sets an agent's value
  // to false rather than deleting the key — so size() keeps counting revoked
  // agents as registered. Count live authorisations instead, which is what
  // the label actually claims.
  let activeAgents = 0;
  let revokedAgents = 0;
  if (ledger) {
    for (const [, isActive] of ledger.agents) {
      if (isActive) activeAgents++;
      else revokedAgents++;
    }
  }

  return (
    <>
      {/* ---- 02 Contract ------------------------------------------------ */}
      <section className="flex flex-col gap-4">
        <SectionHeading index="02" title="Contract">
          {contractAddress && (
            <span className="text-sm text-muted-foreground">
              A Mandate contract on Preprod.
            </span>
          )}
        </SectionHeading>

        {contractAddress ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y-2 border-border py-4">
            <span
              className="break-all font-mono text-[17px]"
              title={contractAddress}
            >
              {truncateMiddle(contractAddress, 12, 8)}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={copyAddress}
              aria-label="Copy contract address"
              title="Copy full address"
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            <a
              href={explorerUrl(contractAddress)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
            <Button
              variant="outline"
              className="ml-auto"
              onClick={disconnect}
              title="Detach from this contract. Your wallet stays connected, and the contract remains on-chain."
            >
              <LogOut />
              Change contract
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-y-2 border-border py-4 sm:flex-row sm:items-center">
            <Button onClick={deploy} disabled={!walletConnected || busy}>
              {status === "deploying" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Rocket />
              )}
              {status === "deploying" ? "Deploying..." : "Deploy to Preprod"}
            </Button>

            <div className="flex flex-1 items-center gap-2">
              <input
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="or paste a contract address to reconnect"
                aria-label="Contract address"
                className="flex h-9 w-full border border-border bg-transparent px-3 py-1 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
                disabled={!walletConnected || busy}
              />
              <Button
                variant="outline"
                onClick={() => join(addressInput.trim())}
                disabled={!walletConnected || busy || addressInput.trim() === ""}
              >
                {status === "joining" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Link2 />
                )}
                Join
              </Button>
            </div>
          </div>
        )}

        {!contractAddress && (
          <Muted>
            A contract address is permanent. Keep it and you can return to that
            contract from any browser, on any machine. Its history lives
            on-chain, not here; this app only remembers addresses as a
            convenience.
          </Muted>
        )}

        {!walletConnected && (
          <Muted>
            {contractAddress
              ? "Connect your wallet to act on this contract."
              : "Connect your wallet to deploy or join."}
          </Muted>
        )}

        {status === "deploying" && (
          <Muted>
            Your wallet is generating the zero-knowledge proof and paying fees.
            This can take a little while.
          </Muted>
        )}

        {error && <DashedNotice title="Contract action failed">{error}</DashedNotice>}
        {stateError && (
          <DashedNotice title="Couldn't read contract state">
            {stateError.message}
          </DashedNotice>
        )}
      </section>

      {/* ---- 03 Public ledger ------------------------------------------- */}
      {contractAddress && (
        <section className="flex flex-col gap-4">
          <SectionHeading index="03" title="Public ledger">
            <span className="text-sm text-muted-foreground">
              Anyone can read these.
            </span>
          </SectionHeading>

          {ledger ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-[2px] border-y-2 border-border bg-border">
              <div className="grid grid-cols-2 gap-[2px]">
                <Stat
                  label="Grants issued"
                  value={groupDigits(ledger.grantsIssued.toString())}
                />
                <Stat
                  label="Times exercised"
                  value={groupDigits(ledger.exercisedCount.toString())}
                />
              </div>
              <div className="grid grid-cols-2 gap-[2px]">
                <Stat
                  label="Budget period"
                  value={groupDigits(ledger.period.toString())}
                />
                <Stat
                  label="Active agents"
                  value={groupDigits(activeAgents.toString())}
                  note={revokedAgents > 0 ? `(${revokedAgents} revoked)` : undefined}
                />
              </div>
            </div>
          ) : walletConnected ? (
            <div className="flex items-center gap-2 border-y-2 border-border py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading state from the indexer...
            </div>
          ) : (
            // Until the wallet connects there is no indexer connection at
            // all, so don't claim to be reading. (Loading this without a
            // wallet is planned — the data is public.)
            <div className="border-y-2 border-border py-4">
              <Muted>Waiting for a wallet connection to load these.</Muted>
            </div>
          )}

          <div className="flex flex-wrap gap-[2px] border-b-2 border-border bg-border">
            <LedgerList title="On the ledger" items={ON_LEDGER} />
            <LedgerList title="Never on the ledger" items={NEVER_ON_LEDGER} absent />
          </div>
        </section>
      )}

      {/* ---- 04 Your contracts ------------------------------------------ */}
      {knownContracts.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeading index="04" title="Your contracts">
            <span className="text-sm text-muted-foreground">
              Deployed or joined from this browser.
            </span>
          </SectionHeading>
          <div className="overflow-x-auto border-t-2 border-border">
            <div className="min-w-[640px]">
              {knownContracts.map((c) => {
                const isCurrent = c.address === contractAddress;
                return (
                  <div
                    key={c.address}
                    className="grid grid-cols-[200px_minmax(0,1fr)_150px_auto] items-center gap-4 border-b border-border py-2.5"
                  >
                    <span className="font-mono text-[13px]" title={c.address}>
                      {truncateMiddle(c.address, 12, 8)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {c.deployed && (
                        <span className="border border-border px-1.5 py-0.5 text-[11px]">
                          you deployed this
                        </span>
                      )}
                      {isCurrent && (
                        <span className="bg-foreground px-1.5 py-0.5 text-[11px] text-background">
                          current
                        </span>
                      )}
                    </div>
                    <span className="text-[13px] text-muted-foreground">
                      {new Date(c.firstSeen).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <a
                        href={explorerUrl(c.address)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="px-2 text-[13px] underline-offset-4 hover:underline"
                      >
                        Explorer
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || isCurrent}
                        onClick={() => join(c.address)}
                      >
                        Switch to
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Remove from list"
                        title="Remove from this list. The contract stays on-chain."
                        onClick={() => forget(c.address)}
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <Muted>
            This list is local. If you clear your browser or move machines,
            paste the address back in. Nothing on-chain is lost.
          </Muted>
        </section>
      )}
    </>
  );
}
