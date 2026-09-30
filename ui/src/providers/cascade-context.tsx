import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CHAIN_PRESETS,
  createLumeraClient,
  getKeplrSigner,
  isKeplrAvailable,
} from "@lumera-protocol/sdk-js";
import type { UniversalSigner } from "@/lib/lumera-types";
import { derivePolicyKey, encryptJson } from "@/lib/cascade-crypto";

/**
 * Cascade (Lumera's decentralized storage) backup for the Mandate policy
 * document — the human-readable mapping (agent name, category, dollar cap)
 * behind the opaque hashes the Midnight contract actually stores. This is
 * entirely separate infrastructure from Midnight: its own chain
 * (lumera-testnet-2), its own wallet (Keplr, not Lace), its own signer.
 * Losing this backup never breaks the contract — it only means losing the
 * ability to explain what a given hash was for. See README, "Where
 * Cascade fits (and where it doesn't)".
 *
 * This mirrors, step for step, the flow already proven working from the
 * command line in policy/src/upload-policy.ts (verified live on
 * lumera-testnet-2, 2026-09-14) — same prepareFile -> registerAction ->
 * sendFileToSupernodes sequence, same isPublic: true / client-side
 * encryption choice, just triggered from a browser wallet instead of a
 * mnemonic read from a .env file.
 */

type CascadeStatus = "idle" | "connecting" | "connected" | "uploading" | "error";

interface ConnectedWallet {
  signer: UniversalSigner;
  address: string;
}

interface CascadeContextValue {
  /** Whether a Keplr-compatible wallet extension was detected at all. */
  available: boolean;
  status: CascadeStatus;
  address: string | null;
  error: string | null;
  /** actionId of the most recent successful backup, if any. */
  lastActionId: string | null;
  connect: () => Promise<ConnectedWallet>;
  /** Encrypt + upload a JSON-serializable value to Cascade. Connects
   *  first if not already connected. Returns the Cascade actionId. */
  backup: (value: unknown, fileName: string) => Promise<string>;
}

const CascadeContext = createContext<CascadeContextValue | null>(null);

export function CascadeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CascadeStatus>("idle");
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastActionId, setLastActionId] = useState<string | null>(null);

  // isKeplrAvailable() reads window.keplr at call time, which is stable
  // for the life of the tab (the extension doesn't appear/disappear),
  // so computing this once on mount is fine.
  const available = useMemo(() => isKeplrAvailable(), []);

  const connect = useCallback(async (): Promise<ConnectedWallet> => {
    if (!available) {
      const message =
        "Keplr wasn't found in this browser. Install the Keplr extension to back up to Cascade.";
      setError(message);
      setStatus("error");
      throw new Error(message);
    }
    setStatus("connecting");
    setError(null);
    try {
      const chainId = CHAIN_PRESETS.testnet.chainId;
      const kSigner = await getKeplrSigner(chainId);
      const accounts = await kSigner.getAccounts();
      const account = accounts[0];
      if (!account) {
        throw new Error(`Keplr returned no accounts for ${chainId}.`);
      }
      const next: ConnectedWallet = { signer: kSigner, address: account.address };
      setWallet(next);
      setStatus("connected");
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
      throw err;
    }
  }, [available]);

  const backup = useCallback(
    async (value: unknown, fileName: string): Promise<string> => {
      const active = wallet ?? (await connect());
      setStatus("uploading");
      setError(null);
      try {
        const chainId = CHAIN_PRESETS.testnet.chainId;
        const client = await createLumeraClient({
          preset: "testnet",
          signer: active.signer,
          address: active.address,
        });

        const key = await derivePolicyKey(active.signer, chainId, active.address);
        const payload = await encryptJson(key, value);
        const fileBytes = new TextEncoder().encode(JSON.stringify(payload));

        const uploader = client.Cascade.uploader;
        const prepared = await uploader.prepareFile(fileBytes);

        // Same 7-day window used by the CLI script's proven run.
        const expirationTime = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7);

        const registered = await uploader.registerAction(prepared, {
          fileName,
          isPublic: true,
          expirationTime,
        });

        await uploader.sendFileToSupernodes(
          registered.actionId,
          registered.authSignature,
          fileBytes,
        );

        setLastActionId(registered.actionId);
        setStatus("connected");
        return registered.actionId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("error");
        throw err;
      }
    },
    [wallet, connect],
  );

  const value = useMemo<CascadeContextValue>(
    () => ({
      available,
      status,
      address: wallet?.address ?? null,
      error,
      lastActionId,
      connect,
      backup,
    }),
    [available, status, wallet, error, lastActionId, connect, backup],
  );

  return <CascadeContext.Provider value={value}>{children}</CascadeContext.Provider>;
}

export function useCascade(): CascadeContextValue {
  const ctx = useContext(CascadeContext);
  if (!ctx) throw new Error("useCascade must be used within a CascadeProvider");
  return ctx;
}
