import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deploy as deployMandate,
  join as joinMandate,
  createStateObservable,
  type DerivedState,
} from "mandate-api";
import { createPrivateState } from "mandate-contract";
import { ledger } from "mandate-contract/src/managed/mandate/contract/index.js";
import { useMidnightProviders } from "./midnight-providers";
import { useContractState } from "@/hooks/use-contract-state";

/** A handle to a contract we are connected to (deployed or joined). */
type ContractHandle = Awaited<ReturnType<typeof joinMandate>>;

const ADDRESS_KEY = "mandate_contract_address";
const SECRET_KEY = "mandate_secret_key";
const CONTRACTS_KEY = "mandate_known_contracts";

export type MandateStatus =
  | "idle"
  | "deploying"
  | "joining"
  | "ready"
  | "error";

/** A contract this browser has deployed or joined before. On-chain state is
 *  permanent, so the app should not forget a contract just because the user
 *  moved on to a new one. */
export interface KnownContract {
  address: string;
  firstSeen: string;
  /** True when this browser deployed it — i.e. you are its principal. */
  deployed: boolean;
}

function readKnownContracts(): KnownContract[] {
  try {
    const raw = localStorage.getItem(CONTRACTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KnownContract[]) : [];
  } catch {
    return [];
  }
}

function rememberContract(address: string, deployed: boolean): KnownContract[] {
  const existing = readKnownContracts();
  if (existing.some((c) => c.address === address)) {
    // Promote to "deployed" if we now know we created it.
    const updated = existing.map((c) =>
      c.address === address ? { ...c, deployed: c.deployed || deployed } : c,
    );
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(updated));
    return updated;
  }
  const next = [
    { address, firstSeen: new Date().toISOString(), deployed },
    ...existing,
  ];
  localStorage.setItem(CONTRACTS_KEY, JSON.stringify(next));
  return next;
}

export interface MandateContextValue {
  contract: ContractHandle | null;
  contractAddress: string | null;
  status: MandateStatus;
  error: string | null;
  /** Live on-chain ledger state plus our local private state. */
  state: DerivedState | null;
  stateError: Error | null;
  deploy: () => Promise<void>;
  join: (address: string) => Promise<void>;
  disconnect: () => void;
  /** Every contract this browser has deployed or joined, newest first. */
  knownContracts: KnownContract[];
  /** Drop a contract from the local list. Does not affect the chain. */
  forget: (address: string) => void;
}

const MandateContext = createContext<MandateContextValue | null>(null);

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

/**
 * The acting party's Mandate secret key.
 *
 * This is NOT a wallet key — it never touches funds. It's the contract's own
 * notion of identity: `agentId`/`actorId` are derived from it inside the
 * circuit, and whoever deploys with a given key becomes that contract's
 * `principal`. It is persisted so a reload keeps you as the same party;
 * losing it means you can no longer act as principal on a contract you
 * deployed.
 *
 * Testnet demo material only — a production build would keep this in the
 * wallet or a proper keystore rather than localStorage.
 */
function loadOrCreateSecretKey(): Uint8Array {
  const stored = localStorage.getItem(SECRET_KEY);
  if (stored) return fromHex(stored);
  const fresh = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SECRET_KEY, toHex(fresh));
  return fresh;
}

export function MandateProvider({ children }: { children: ReactNode }) {
  const { providers, isReady } = useMidnightProviders();
  const [contract, setContract] = useState<ContractHandle | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(() =>
    localStorage.getItem(ADDRESS_KEY),
  );
  const [knownContracts, setKnownContracts] =
    useState<KnownContract[]>(readKnownContracts);
  const [status, setStatus] = useState<MandateStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Guards the post-reload re-join so it runs at most once per address.
  const rejoinAttempted = useRef<string | null>(null);

  const deploy = useCallback(async () => {
    if (!providers || !isReady) {
      setError("Connect a wallet first.");
      setStatus("error");
      return;
    }
    setStatus("deploying");
    setError(null);
    try {
      const privateState = createPrivateState(loadOrCreateSecretKey());
      const deployed = await deployMandate(providers, privateState);
      // Read ONLY the public field. `deployTxData` is flagged
      // privacy-sensitive by the SDK: it also carries the contract's signing
      // key and the initial private state, which must never be logged or
      // serialized.
      const address = deployed.deployTxData.public.contractAddress;
      localStorage.setItem(ADDRESS_KEY, address);
      setKnownContracts(rememberContract(address, true));
      setContract(deployed);
      setContractAddress(address);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
      setStatus("error");
    }
  }, [providers, isReady]);

  const join = useCallback(
    async (address: string) => {
      if (!providers || !isReady) {
        setError("Connect a wallet first.");
        setStatus("error");
        return;
      }
      setStatus("joining");
      setError(null);
      try {
        const privateState = createPrivateState(loadOrCreateSecretKey());
        const found = await joinMandate(providers, address, privateState);
        localStorage.setItem(ADDRESS_KEY, address);
        setKnownContracts(rememberContract(address, false));
        setContract(found);
        setContractAddress(address);
        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not join contract");
        setStatus("error");
      }
    },
    [providers, isReady],
  );

  const forget = useCallback(
    (address: string) => {
      const next = readKnownContracts().filter((c) => c.address !== address);
      localStorage.setItem(CONTRACTS_KEY, JSON.stringify(next));
      localStorage.removeItem(`mandate_steps_${address}`);
      setKnownContracts(next);
    },
    [],
  );

  const disconnect = useCallback(() => {
    rejoinAttempted.current = null;
    localStorage.removeItem(ADDRESS_KEY);
    setContract(null);
    setContractAddress(null);
    setStatus("idle");
    setError(null);
  }, []);

  // One-time adoption: a contract address saved before the history list
  // existed would otherwise be invisible in "Your contracts". Anyone who
  // deployed earlier still has the address in localStorage, so fold it in.
  useEffect(() => {
    const current = localStorage.getItem(ADDRESS_KEY);
    if (!current) return;
    if (readKnownContracts().some((c) => c.address === current)) return;
    setKnownContracts(rememberContract(current, false));
  }, []);

  // Re-attach to a previously saved contract after a page reload.
  //
  // `contractAddress` survives in localStorage, but the contract handle does
  // not — it only exists in memory, created by deploy() or join(). Without
  // this, a refresh leaves us with an address but no handle, so anything that
  // needs to *call* the contract (the walkthrough) silently disappears while
  // the read-only state still renders. Re-join once per address, and only
  // once providers are ready.
  useEffect(() => {
    if (!providers || !isReady) return;
    if (!contractAddress || contract) return;
    if (rejoinAttempted.current === contractAddress) return;
    rejoinAttempted.current = contractAddress;
    void join(contractAddress);
  }, [providers, isReady, contractAddress, contract, join]);

  // Live ledger state. Memoized on the address so we don't resubscribe on
  // every render.
  const observable = useMemo(() => {
    if (!providers || !contractAddress) return null;
    return createStateObservable(
      providers.publicDataProvider,
      providers.privateStateProvider,
      contractAddress,
      ledger,
    );
  }, [providers, contractAddress]);

  const { state, error: stateError } = useContractState<DerivedState>(observable);

  const value = useMemo<MandateContextValue>(
    () => ({
      contract,
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
    }),
    [contract, contractAddress, status, error, state, stateError, deploy, join, disconnect, knownContracts, forget],
  );

  return (
    <MandateContext.Provider value={value}>{children}</MandateContext.Provider>
  );
}

export function useMandate(): MandateContextValue {
  const ctx = useContext(MandateContext);
  if (!ctx) {
    throw new Error("useMandate must be used within a MandateProvider");
  }
  return ctx;
}
