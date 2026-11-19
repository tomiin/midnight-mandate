// In-memory PrivateStateProvider for Midnight.js 5 (ledger 9). Private state is now scoped per contract
// (forContract), unlike Midnight.js 4. The agent keeps its private state in memory only: the principal and
// agent secret keys live in .spike-state-<network>.json and are put back into private state before each call.
import type { PrivateStateProvider, ContractPrivateStates } from '@midnight-ntwrk/midnight-js-types';

export function inMemoryPrivateStateProvider<PSI extends string, PS>(): PrivateStateProvider<PSI, PS> {
  const byContract = new Map<string, Map<PSI, PS>>();
  const signingKeys = new Map<string, any>();
  const unsupported = (what: string) => async (): Promise<never> => { throw new Error(`in-memory private state does not support ${what}`); };
  const scoped = (contractAddress: string): ContractPrivateStates<PSI, PS> => {
    const m = byContract.get(contractAddress) ?? new Map<PSI, PS>();
    byContract.set(contractAddress, m);
    return {
      contractAddress,
      set: async (id: PSI, state: PS) => { m.set(id, state); },
      get: async (id: PSI) => m.get(id) ?? null,
      remove: async (id: PSI) => { m.delete(id); },
      clear: async () => { m.clear(); },
      exportPrivateStates: unsupported('exportPrivateStates'),
      importPrivateStates: unsupported('importPrivateStates'),
    } as ContractPrivateStates<PSI, PS>;
  };
  return {
    forContract: (contractAddress: any) => scoped(String(contractAddress)),
    clearAll: async () => { byContract.clear(); },
    setSigningKey: async (address: any, key: any) => { signingKeys.set(String(address), key); },
    getSigningKey: async (address: any) => signingKeys.get(String(address)) ?? null,
    removeSigningKey: async (address: any) => { signingKeys.delete(String(address)); },
    clearSigningKeys: async () => { signingKeys.clear(); },
    exportSigningKeys: unsupported('exportSigningKeys'),
    importSigningKeys: unsupported('importSigningKeys'),
  } as PrivateStateProvider<PSI, PS>;
}
