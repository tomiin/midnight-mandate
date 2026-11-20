# Mandate Lite: zero-knowledge audit

Date: 2026-11-20. Question: does Mandate really use Compact and real zero-knowledge proofs, end to end?
Everything below was checked by running it or reading the code, not taken from the README.

Stack: Compact 0.36.1 (language 0.28.0), compact-runtime 0.21.0, Midnight.js 5.0.1, Wallet SDK 2.0.1,
proof server 9.0.2, Midnight Preprod (ledger 9). Contract
`cca849283f400c5d5f4513a787eac663965fa2901377bcd2664a22ac2d3fecaf`.

## Verdict
Yes. Spending is enforced by a Compact contract, and every payment is a zero-knowledge proof that the
Preprod network verifies against keys compiled from this repository's source. The chain of evidence:

| # | Check | How | Result |
|---|---|---|---|
| 1 | The contract is written in Compact | `contract/src/mandate.compact` | 7 proving circuits, 3 witnesses (private inputs) |
| 2 | Committed circuits come from this source | Recompiled with `compact compile +0.36.1 --skip-zk` into a scratch folder and compared | All 7 `.zkir` circuits identical; generated JS identical except the key fingerprints a `--skip-zk` build leaves empty |
| 3 | Real proving keys exist | `contract/src/managed/mandate/keys/` | Real prover keys (exercise: 45 MB) and verifier keys for all 7 circuits |
| 4 | Keys match the compiler's fingerprints | sha256 of each `.verifier` vs `expectedVk` in the generated code | 7 of 7 match |
| 5 | **The deployed contract uses these exact keys** | Read the live contract state from Preprod, sha256 of each on-chain verifier key | **7 of 7 identical** |
| 6 | Payments go through the proof server | `agent/src/providers.ts`, `agent/src/mandate.ts` | `httpClientProofProvider` → proof server; `callTx.exercise(...)` builds, proves, balances and submits |
| 7 | A real payment is on the ledger | Public Verify endpoint on the live ledger | Order NA-N32AZGI: ledger says paid **$236** (block 3481901). A made-up order: not paid |
| 8 | The order reference is what the docs say | Recomputed `sha256("mandate:order:v1|CheapAir (simulated)|NA-N32AZGI")` | Matches the on-chain key |
| 9 | The logic does what it claims | `npm test` in `contract/` (Compact runtime simulator) | 21 of 21 pass |

Because of check 5, a client that skips or fakes the rules can't get a payment accepted: the network only
accepts an `exercise` call carrying a valid proof for the deployed verifier key, and no such proof exists
for inputs that fail an `assert`.

## What the `exercise` proof enforces
From the compiled circuit (`zkir/exercise.zkir`): 7 `assert`s, one for each rule in the source.
1. The agent is currently active (the live kill switch).
2. The Merkle path given is for this agent's own grant (blocks borrowing another agent's path).
3. That grant is in the `authorized` tree (10 hash steps, depth-10 tree).
4. This request ID hasn't been used (nullifier: no replays).
5. The category has a limit.
6. Spent this period + this amount ≤ the limit (with a 64-bit range check, so the total can't wrap around).
7. This order hasn't been paid before.

**Private (never leaves the agent's machine):** the agent's secret key, the request ID, the Merkle path.
**Public on the ledger:** the agent's pseudonym (a hash), category, limit, each amount, the running total
(under a hashed key), the order reference hash, and counts. Not the agency, the client, or any names.
These limits are the same ones the contract's own "HONEST LIMITS" comment and the README state.

## Findings and limits

**F1. Principal and agent keys live on the same server (by design for the demo).**
`agent/.spike-state-preprod.json` holds both the owner (principal) key and the agent key. The proofs are
still real, but whoever controls that machine is both owner and agent. In a production setup the agent
key sits with the agent and the owner key in the owner's wallet. Worth one sentence in the README.

**F2. Fixed today: key switching was not serialized.** The app swaps its private state between the
principal key and the agent key before each call (`asPrincipal()` / `asAgent()`). Before commit 43fd0cd,
an owner action running at the same moment as a payment could swap the key mid-call (that call would fail;
it could not pay without a valid proof). Now every wallet action runs one at a time (`onWallet` in `demo.ts`).

**F3. "Pay" means authorize, not move money.** `exercise` records an authorized, budget-checked payment
against an order. It doesn't transfer tokens to the merchant; the fee wallet only pays network fees.
The contract header and README say this. Keep demo wording to "authorized and recorded on Midnight".

**F4. The limit is per agent.** `categoryLimit` caps each agent per period. With one agent (Lite today)
that's the agency's budget; with several agents the total could reach agents × limit.

**F5. The merchant check is simulated.** After paying, Mandate itself looks up `paidOrders` on the ledger
"as the merchant". A real merchant would run that lookup (or the public Verify page) themselves.

**F6. Order references are guessable for a known order ID.** `paidOrders` is keyed by
sha256(merchant | order ID), so anyone who knows an order ID can look up whether it was paid and how much.
That's intended for merchant verification; it does mean amounts aren't private from someone holding the ID.

**F7. Automated tests don't generate proofs.** The 21 contract tests run the circuits in the simulator
(fast, checks the logic). Real proving is exercised on Preprod (checks 5–7). An optional end-to-end test
against a local proof server would catch toolchain drift earlier.

## How to repeat this audit
1. `cd contract && compact compile +0.36.1 --skip-zk src/mandate.compact /tmp/mandate-check`, then compare
   `/tmp/mandate-check/zkir/*.zkir` with `src/managed/mandate/zkir/`.
2. `shasum -a 256 src/managed/mandate/keys/*.verifier` and compare with `expectedVk` in
   `src/managed/mandate/contract/index.js`.
3. Read the deployed contract (`queryContractState`), `ContractState.deserialize(...)`, then compare
   sha256 of `operation(name).verifierKey` for each circuit with step 2.
4. Open the Verify link for order NA-N32AZGI, or call `/api/verify-order?c=<contract>&ref=<orderRef>`.
5. `cd contract && npm test`.
