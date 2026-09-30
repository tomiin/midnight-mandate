import { Wallet, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletIcon } from "@/components/wallet-icon";
import { useWallet } from "@/hooks/use-wallet";
import { truncateMiddle } from "@/lib/utils";

export function WalletWidget() {
  const {
    status,
    unshieldedAddress,
    shieldedAddress,
    connectedWallet,
    error,
    availableWallets,
    connect,
    connectTo,
    cancel,
    disconnect,
  } = useWallet();

  if (status === "connecting") {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled>
          <Loader2 className="animate-spin" />
          Connecting...
        </Button>
        <Button variant="outline" onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  if (status === "connected") {
    // Unshielded is the address people recognise — it's where their NIGHT
    // lives. Fall back to shielded if the wallet didn't report it.
    const address = unshieldedAddress ?? shieldedAddress;
    const name = connectedWallet?.name ?? "Wallet";
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex h-9 items-center gap-2.5 border border-border px-3"
          title={address ?? undefined}
        >
          <WalletIcon icon={connectedWallet?.icon} name={name} />
          <span className="text-sm font-extrabold">{name}</span>
          {address && (
            <span className="font-mono text-xs text-muted-foreground">
              {truncateMiddle(address, 7, 7)}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={disconnect}
          title="Disconnect — lets you choose a different wallet"
          aria-label="Disconnect wallet"
        >
          <LogOut />
        </Button>
      </div>
    );
  }

  // More than one Midnight wallet installed: let the user choose rather than
  // silently connecting to whichever enumerated first. Shown after an error
  // too, so a wallet that refused never traps you.
  if (
    (status === "disconnected" || status === "error") &&
    availableWallets.length > 1
  ) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {availableWallets.map((wallet) => (
            <Button
              key={wallet.rdns}
              variant="outline"
              onClick={() => connectTo(wallet)}
              className="gap-2.5"
            >
              <WalletIcon icon={wallet.icon} name={wallet.name} />
              {wallet.name}
            </Button>
          ))}
        </div>
        {status === "error" && error && (
          <p className="max-w-72 text-right text-xs">
            {error}
            {/denied|locked/i.test(error)
              ? " — unlock that wallet or pick another."
              : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={connect}>
        <Wallet />
        Connect wallet
      </Button>
      {status === "error" && error && (
        <p className="max-w-72 text-right text-xs">{error}</p>
      )}
    </div>
  );
}
