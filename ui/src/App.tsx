import { WalletProvider } from "@/providers/wallet-context";
import { MidnightProvidersProvider } from "@/providers/midnight-providers";
import { MandateProvider } from "@/providers/mandate-context";
import { CascadeProvider } from "@/providers/cascade-context";
import { WalletWidget } from "@/components/wallet-widget";
import { NetworkBadge } from "@/components/network-badge";
import { ProvingMode } from "@/components/proof-server-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountPanel } from "@/components/account-panel";
import { ContractPanel } from "@/components/contract-panel";
import { Walkthrough } from "@/components/walkthrough";
import { Mark } from "@/components/mark";

export function App() {
  return (
    <WalletProvider>
      <MidnightProvidersProvider>
        <MandateProvider>
          <CascadeProvider>
            <div className="min-h-screen bg-background text-foreground">
              <div className="mx-auto flex max-w-[1200px] flex-col gap-14 px-[clamp(16px,4vw,32px)] pb-24">
                <header className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b-2 border-border py-5">
                  <div className="mr-auto flex min-w-0 items-center gap-3">
                    <Mark size={32} className="shrink-0 text-seal" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[22px] font-extrabold leading-tight tracking-tight">
                        Mandate
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        Spending limits for AI agents, enforced by
                        zero-knowledge proof.
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <NetworkBadge />
                    <ProvingMode />
                    <WalletWidget />
                    <ThemeToggle />
                  </div>
                </header>

                <main className="flex flex-col gap-14">
                  <AccountPanel />
                  <ContractPanel />
                  <Walkthrough />
                </main>
              </div>
            </div>
          </CascadeProvider>
        </MandateProvider>
      </MidnightProvidersProvider>
    </WalletProvider>
  );
}
