import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";

const STORAGE_KEY = "mandate_wallet_autoconnect";
const LAST_WALLET_KEY = "mandate_wallet_last_rdns";

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// One entry per Midnight-compatible extension detected under
// `window.midnight`. Multiple can be installed at once (e.g. Lace plus
// another wallet), so we surface all of them rather than silently picking
// one — see `findWallets` below.
export interface DetectedWallet {
  rdns: string;
  name: string;
  icon: string;
  api: InitialAPI;
}

export interface DustBalance {
  /** Currently available Dust. Regenerates over time from held Night. */
  balance: bigint;
  /** Ceiling the held Night can generate up to. */
  cap: bigint;
}

export interface WalletState {
  status: WalletConnectionStatus;
  connectedApi: ConnectedAPI | null;
  /** Zswap identity. Required by the SDK for every contract transaction,
   *  but Mandate moves no tokens, so no shielded value is ever spent. */
  shieldedAddress: string | null;
  /** Where Night is held. Night is never spent on fees — it generates the
   *  Dust that pays them. */
  unshieldedAddress: string | null;
  /** Dust is what actually pays transaction fees. Zero Dust means no
   *  contract call can be made, so this is surfaced prominently. */
  dust: DustBalance | null;
  unshieldedBalances: Record<string, bigint> | null;
  networkId: string | null;
  error: string | null;
  availableWallets: DetectedWallet[];
  /** Which extension is connected, so the header can name it. */
  connectedWallet: { rdns: string; name: string; icon: string } | null;
}

export interface WalletContextValue extends WalletState {
  /**
   * Connects automatically when it's unambiguous: exactly one wallet
   * detected, or multiple wallets but one was chosen last time (reload
   * autoconnect). Otherwise refreshes `availableWallets` and leaves the
   * choice to the UI — render a picker from `availableWallets` and call
   * `connectTo` with the user's selection.
   */
  connect: () => Promise<void>;
  connectTo: (wallet: DetectedWallet) => Promise<void>;
  /** Stop waiting on an in-flight connection. The extension can't be told
   *  to abort, so any late answer from it is ignored instead. */
  cancel: () => void;
  disconnect: () => void;
  /** Dust regenerates over time, so it's worth being able to re-read it. */
  refreshBalances: () => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

function findWallets(): DetectedWallet[] {
  if (typeof window === "undefined" || !window.midnight) return [];
  // Each wallet is injected under its own key (a UUID; Lace also aliases
  // itself at `mnLace`), so the same extension can appear twice — de-dupe
  // by rdns, keeping the first occurrence.
  const seen = new Set<string>();
  const wallets: DetectedWallet[] = [];
  for (const api of Object.values(window.midnight)) {
    if (api == null || typeof api.connect !== "function") continue;
    if (seen.has(api.rdns)) continue;
    seen.add(api.rdns);
    wallets.push({ rdns: api.rdns, name: api.name, icon: api.icon, api });
  }
  return wallets;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "disconnected",
    connectedApi: null,
    shieldedAddress: null,
    unshieldedAddress: null,
    dust: null,
    unshieldedBalances: null,
    networkId: null,
    error: null,
    availableWallets: [],
    connectedWallet: null,
  });

  // Each connection attempt gets a number. Cancel bumps it, so a slow answer
  // from an abandoned attempt can see it's stale and drop itself instead of
  // flipping the UI back to "connected" after the user walked away.
  const attemptRef = useRef(0);

  const connectTo = useCallback(async (wallet: DetectedWallet) => {
    const attempt = ++attemptRef.current;
    const stale = () => attempt !== attemptRef.current;
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

    try {
      const api = await wallet.api.connect("preprod");
      const config = await api.getConfiguration();

      // Settled, not all-or-nothing. These are four separate wallet calls
      // with separate permissions; if one is refused or unimplemented,
      // losing the other three would hide the real cause behind blank
      // fields — which is exactly what happened the first time around.
      const [shielded, unshielded, dust, balances] = await Promise.allSettled([
        api.getShieldedAddresses(),
        api.getUnshieldedAddress(),
        api.getDustBalance(),
        api.getUnshieldedBalances(),
      ]);
      if (stale()) return;

      const failures: string[] = [];
      if (shielded.status === "rejected")
        failures.push(`shielded address (${String(shielded.reason)})`);
      if (unshielded.status === "rejected")
        failures.push(`unshielded address (${String(unshielded.reason)})`);
      if (dust.status === "rejected")
        failures.push(`dust balance (${String(dust.reason)})`);
      if (balances.status === "rejected")
        failures.push(`unshielded balances (${String(balances.reason)})`);

      setState((prev) => ({
        ...prev,
        status: "connected",
        connectedApi: api,
        connectedWallet: { rdns: wallet.rdns, name: wallet.name, icon: wallet.icon },
        shieldedAddress:
          shielded.status === "fulfilled" ? shielded.value.shieldedAddress : null,
        unshieldedAddress:
          unshielded.status === "fulfilled"
            ? unshielded.value.unshieldedAddress
            : null,
        dust: dust.status === "fulfilled" ? dust.value : null,
        unshieldedBalances:
          balances.status === "fulfilled" ? balances.value : null,
        networkId: config.networkId,
        error:
          failures.length > 0
            ? `Could not read: ${failures.join(", ")}`
            : null,
      }));

      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(LAST_WALLET_KEY, wallet.rdns);
    } catch (err: unknown) {
      if (stale()) return;
      // The remembered wallet just refused (locked, or permission revoked).
      // Forget it and stop auto-connecting, otherwise every retry goes
      // straight back to the wallet that refused and the picker never shows.
      localStorage.removeItem(LAST_WALLET_KEY);
      localStorage.removeItem(STORAGE_KEY);
      const message =
        typeof err === "object" && err !== null && "reason" in err
          ? (err as { reason: string }).reason
          : "Failed to connect to wallet";
      setState((prev) => ({
        ...prev,
        status: "error",
        error: message,
      }));
    }
  }, []);

  const connect = useCallback(async () => {
    const wallets = findWallets();
    setState((prev) => ({ ...prev, availableWallets: wallets }));

    if (wallets.length === 0) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error:
          "No Midnight wallet extension found. Install a Midnight wallet (e.g. Lace) to continue.",
      }));
      return;
    }

    if (wallets.length === 1) {
      const [onlyWallet] = wallets;
      if (onlyWallet) {
        await connectTo(onlyWallet);
      }
      return;
    }

    // Multiple wallets detected. Reconnect silently to whichever was used
    // last (so autoconnect-on-reload doesn't nag the user); otherwise leave
    // status as "disconnected" so the UI renders a picker from
    // `availableWallets` instead of guessing which one the user wants.
    const lastRdns = localStorage.getItem(LAST_WALLET_KEY);
    if (lastRdns) {
      const remembered = wallets.find((w) => w.rdns === lastRdns);
      if (remembered) {
        await connectTo(remembered);
      }
    }
  }, [connectTo]);

  const refreshBalances = useCallback(async () => {
    const api = state.connectedApi;
    if (!api) return;
    const [dust, balances, unshielded] = await Promise.allSettled([
      api.getDustBalance(),
      api.getUnshieldedBalances(),
      api.getUnshieldedAddress(),
    ]);
    setState((prev) => ({
      ...prev,
      dust: dust.status === "fulfilled" ? dust.value : prev.dust,
      unshieldedBalances:
        balances.status === "fulfilled" ? balances.value : prev.unshieldedBalances,
      unshieldedAddress:
        unshielded.status === "fulfilled"
          ? unshielded.value.unshieldedAddress
          : prev.unshieldedAddress,
      error:
        dust.status === "rejected"
          ? `Could not read dust balance (${String(dust.reason)})`
          : prev.error,
    }));
  }, [state.connectedApi]);

  const cancel = useCallback(() => {
    attemptRef.current++;
    // Treat a cancel like a refusal: don't auto-connect to this wallet again
    // on reload, and show the picker so a different one can be chosen.
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_WALLET_KEY);
    setState((prev) => ({ ...prev, status: "disconnected", error: null }));
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    // Also forget *which* wallet was used. Reconnecting after a reload
    // should be silent, but pressing disconnect deliberately is the one
    // moment the user plausibly wants a different wallet — keeping the
    // remembered rdns here made the picker unreachable forever once any
    // wallet had been chosen once.
    localStorage.removeItem(LAST_WALLET_KEY);
    setState((prev) => ({
      ...prev,
      status: "disconnected",
      connectedApi: null,
      connectedWallet: null,
      shieldedAddress: null,
      unshieldedAddress: null,
      dust: null,
      unshieldedBalances: null,
      networkId: null,
      error: null,
    }));
  }, []);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      connect();
    }
  }, [connect]);

  // Populate the detected-wallet list up front. Without this it was only
  // ever filled in by connect(), so a fresh load had an empty list and the
  // picker could not render even with two extensions installed. The
  // delayed second pass is for extensions that inject into
  // `window.midnight` after first paint — the console shows several
  // wallet extensions racing each other on this page.
  useEffect(() => {
    const scan = () => {
      const wallets = findWallets();
      setState((prev) =>
        prev.availableWallets.length === wallets.length
          ? prev
          : { ...prev, availableWallets: wallets },
      );
    };
    scan();
    const timer = setTimeout(scan, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <WalletContext.Provider
      value={{ ...state, connect, connectTo, cancel, disconnect, refreshBalances }}
    >
      {children}
    </WalletContext.Provider>
  );
}
