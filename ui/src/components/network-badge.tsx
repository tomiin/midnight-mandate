import { useWallet } from "@/hooks/use-wallet";

export function NetworkBadge() {
  const { networkId, status } = useWallet();
  if (status !== "connected" || !networkId) return null;
  return (
    <span className="bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
      {networkId}
    </span>
  );
}
