import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { toHex, fromHex } from "@midnight-ntwrk/midnight-js-utils";
import {
  Transaction,
  type FinalizedTransaction,
} from "@midnight-ntwrk/ledger-v8";
import type { ChargedState } from "@midnight-ntwrk/compact-runtime";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { createProofProvider } from "@midnight-ntwrk/midnight-js-types";
import type {
  WalletProvider,
  MidnightProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { combineLatest, map, retry, Observable } from "rxjs";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { Contract } from "mandate-contract/src/managed/mandate/contract/index.js";
import { witnesses } from "mandate-contract";
import { inMemoryPrivateStateProvider } from "./private-state.js";
import type {
  AppProviders,
  ContractState,
  DerivedState,
  ImpureCircuitKeys,
  PrivateState,
} from "./types.js";
import { PRIVATE_STATE_ID } from "./types.js";

export { inMemoryPrivateStateProvider } from "./private-state.js";
export type {
  AppProviders,
  ContractState,
  DerivedState,
  ImpureCircuitKeys,
  PrivateState,
} from "./types.js";
export { PRIVATE_STATE_ID } from "./types.js";

export async function createProviders(
  api: ConnectedAPI,
): Promise<AppProviders> {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId);

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  const privateStateProvider = inMemoryPrivateStateProvider<
    typeof PRIVATE_STATE_ID,
    PrivateState
  >();

  const zkConfigProvider = new FetchZkConfigProvider<ImpureCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );

  // Wallet-delegated proving.
  //
  // The DApp Connector marks `Configuration.proverServerUri` as @deprecated
  // ("likely to not be present, as different proving modalities emerge") and
  // directs DApps to `getProvingProvider` instead. That hands proving to the
  // wallet, which uses whatever prover the user has configured — so this app
  // needs no proof server of its own, and a visitor needs nothing running
  // locally beyond their wallet extension. That is what makes a statically
  // hosted build usable by someone who just opens the URL.
  //
  // `ZKConfigProvider.asKeyMaterialProvider()` is the SDK's own adapter from
  // our FetchZkConfigProvider to the `KeyMaterialProvider` shape the wallet
  // expects ({ getZKIR, getProverKey, getVerifierKey }), and
  // `createProofProvider` wraps the returned ProvingProvider back into the
  // `ProofProvider` that deployContract/findDeployedContract consume.
  if (typeof api.getProvingProvider !== "function") {
    throw new Error(
      "This wallet does not support delegated proving (getProvingProvider). " +
        "Please update your Midnight wallet extension to a current version.",
    );
  }
  // The wallet does the proving; it pulls ZKIR and keys from this page
  // through the key-material provider.
  const keyMaterial = zkConfigProvider.asKeyMaterialProvider();
  const provingProvider = await api.getProvingProvider(keyMaterial);
  const proofProvider = createProofProvider(provingProvider);

  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    await api.getShieldedAddresses();

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    // WalletProvider.balanceTx is (tx: UnboundTransaction, ttl?: Date) =>
    // Promise<FinalizedTransaction>. The DApp Connector speaks serialized hex
    // strings, so we hex-encode the unbound tx, hand it to Lace (which selects
    // fee inputs/change and binds it), then deserialize the returned hex string
    // back into a FinalizedTransaction. The options object is `{ payFees?:
    // boolean }`; an empty `{}` uses the defaults (payFees: true). There is no
    // `sender`, `newCoins`, or `ttl` argument on this method.
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await api.balanceUnsealedTransaction(
        toHex(tx.serialize()),
        {},
      );
      // A balanced/finalized tx is Transaction<SignatureEnabled, Proof, Binding>.
      // deserialize takes the three instance markers for those type params.
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHex(balancedHex),
      ) satisfies FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => {
      // submitTransaction takes a serialized hex string and returns void; the
      // tx id is recovered from the transaction's own identifiers().
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

// `CompiledContract.make(tag, ctor)` builds the binding; `withWitnesses` and
// `withCompiledFileAssets` must both be called to discharge compact-js's `R`
// type parameter down to a deployable `CompiledContract<C, PS, never>`.
// `withCompiledFileAssets`'s path argument satisfies that type requirement,
// but verified against the actual installed midnight-js-contracts@4.1.1: its
// deployContract/findDeployedContract implementation never reads this path
// at runtime — it exclusively calls our own zkConfigProvider.getVerifierKeys
// (the FetchZkConfigProvider constructed in createProviders above) to fetch
// verifier keys over HTTP, which is what actually matters for a browser
// DApp. This string is therefore a real value for compact-js's type system,
// not a runtime dependency of the deploy/join flow below.
const compiledContract = CompiledContract.make("mandate", Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets("managed/mandate"),
);

export async function deploy(
  providers: AppProviders,
  initialPrivateState: PrivateState,
) {
  return deployContract(providers, {
    compiledContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });
}

export async function join(
  providers: AppProviders,
  contractAddress: string,
  initialPrivateState: PrivateState,
) {
  return findDeployedContract(providers, {
    compiledContract,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });
}

export function createStateObservable(
  publicDataProvider: AppProviders["publicDataProvider"],
  privateStateProvider: AppProviders["privateStateProvider"],
  contractAddress: string,
  // `state.data` is now a ChargedState (not a Uint8Array). Your compiled
  // contract's generated `YourContract.ledger(state.data)` accepts this value.
  parseLedger: (data: ChargedState) => ContractState,
): Observable<DerivedState> {
  const public$ = publicDataProvider
    .contractStateObservable(contractAddress, { type: "latest" })
    .pipe(map((state) => parseLedger(state.data)));

  const private$ = new Observable<PrivateState | null>((subscriber) => {
    privateStateProvider
      .get(PRIVATE_STATE_ID)
      .then((s) => subscriber.next(s))
      .catch((err) => subscriber.error(err));
  });

  return combineLatest([public$, private$]).pipe(
    map(([contractState, privateState]) => ({ contractState, privateState })),
    retry({ delay: 500 }),
  );
}
