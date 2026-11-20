# Mandate · Wave 3 walkthrough

An AI agent searches travel providers, books, and pays with a zero-knowledge Mandate proof on **Midnight Preprod (ledger 9)**. Over-budget or revoked payments are refused by the contract.

**Already live, nothing to run:** the Wave 3 contract is deployed on Preprod at
`cca849283f400c5d5f4513a787eac663965fa2901377bcd2664a22ac2d3fecaf`
([explorer](https://preprod.midnightexplorer.com/contracts/0xcca849283f400c5d5f4513a787eac663965fa2901377bcd2664a22ac2d3fecaf)),
with a first payment (order `NA-N32AZGI`, $236, proof in block 3481901). The steps below run your own copy.

## What you need

- Node 22+ and Docker.
- The Midnight **ledger 9** stack, which Preprod has run since 9 Nov 2026: Compact toolchain 0.36.1 (`compact update 0.36.1`, only to recompile), proof server 9.0.2, Midnight.js 5.0.1 and Wallet SDK 2.0.1 (installed by `npm install`).
- A free [Blockfrost](https://blockfrost.io) project for **Midnight Preprod** (indexer and node access).
- A fee wallet seed of your own (`openssl rand -hex 32`), funded with tNIGHT from the [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/). Keep the seed private.
- A Claude API key for the built-in assistant (console.anthropic.com). Optional: Claude Desktop (MCP) or any AI via the REST API.
- Optional, for Cascade backups: a Lumera testnet wallet (`cd policy && npm install && npm run generate-wallet`, then fund it from the Lumera testnet faucet).

## 1. Contract and tests

```bash
npm install
cd contract
npm run compile    # compact compile +0.36.1 (generated artifacts are committed, so this is optional)
npm test           # 21 tests, including the 3 order-binding tests
```

## 2. Proof server and fee wallet

```bash
docker run -d --name midnight-proof-server -p 6300:6300 midnightntwrk/proof-server:9.0.2 -v

cd agent
cat > .env <<'ENV'
MN_NETWORK=preprod
BLOCKFROST_PREPROD_PROJECT_ID=<your Blockfrost Preprod project id>
FEE_WALLET_SEED=<your 64-hex seed>
ANTHROPIC_API_KEY=sk-ant-...
ENV
npm run wallet:address:preprod   # the mn_addr_preprod1… address to fund from the faucet
npm run wallet:dust:preprod      # syncs, then registers the tNIGHT to generate DUST (pays the fees)
```

`.env` stays on your machine and is gitignored. Optional: `MANDATE_CHAT_DAILY_LIMIT=30` sets how many assistant messages each signed-in person can send per day on your key (default 30, `0` = no limit). Anyone can click **Key** in the chat panel to use their own Claude API key instead: it stays in their browser tab, is passed to Anthropic with each message, is never saved by the server, and doesn't count toward the limit.

The first wallet sync on Preprod is long (about 2 hours for us); progress is saved every minute, so an interrupted sync resumes. Later starts take about 2 minutes.

## 3. Deploy and set up a mandate

```bash
TRAVEL_LIMIT=500 npm run demo:reset:preprod   # deploys, sets the travel limit, registers and authorizes the agent
```

It prints `Ready` with your contract address. Each setup transaction takes about 20–25 seconds on Preprod.

## 4. Start the app and API

```bash
npm run serve:preprod   # app on http://localhost:4400, REST API under /api/v1 (DEMO_PORT=4500 to change the port)
```

Or connect Claude Desktop: `node scripts/install-claude-desktop.mjs`, quit and reopen Claude Desktop, and the `mandate` tools appear (search_travel, book, pay_with_mandate, …).

## 5. Try it

With Claude Desktop:

> Search all providers for flights to Lisbon on 2026-12-12 under $250, book the cheapest for the Smith family and pay with my mandate.

Then:

> Book the Grand Meridian in Lisbon on 2026-12-12 for D. Okafor and pay.

The second payment goes over the $500 budget and is **refused by the contract** before anything is submitted.

With the REST API:

```bash
curl "http://localhost:4400/api/v1/search?q=flights%20to%20Lisbon%202026-12-12%20under%20%24250"
curl -X POST localhost:4400/api/v1/orders -H 'content-type: application/json' -d '{"offerId":"<fareId from search>","client":"Smith family"}'
curl -X POST localhost:4400/api/v1/orders/<orderId>/pay
```

In the app (http://localhost:4400), first create the owner account (forgot the password later? `npm run reset-owner` in `agent/`, then restart), then:

1. **Clients → New client**: e.g. "Smith family" with travellers John Smith and Mia Smith (date of birth, gender, passport).
2. **Trips → New trip**: Lisbon, Dec 12–15, both travellers, budget $2,400.
3. **Assistant** (right panel), on the trip: *"Find flights to Lisbon on Dec 12 under $500 and book the cheapest for both travellers."* Then *"yes, pay"*.
4. Turn on **AI view**: the AI only ever saw `Client-…` and `Traveller-…` placeholders.
5. Ask for a 5-star hotel over the trip budget: the booking goes to **Approvals**. Approve and pay as owner.
6. **Mandates**: revoke the agent, then ask the assistant to pay: **refused by the contract**. Reinstate it.
7. **Invoices → Verify**: the public page confirms each payment on the Midnight ledger without showing any name.
8. **Backups & log**: choose a passphrase and **Back up to Cascade**. You get a Cascade action ID; restore with that ID and the passphrase.

Also: **Live agent** (proof progress), **Supplier view** (what the merchant sees, principal hidden), **Public ledger**.

## What is public, what stays private

| On the Midnight ledger | Never on the ledger |
|---|---|
| Order fingerprint → amount, period budget and totals, agent registry roots, revocations | The agency's identity (hash commitment only), client names, which agent paid, agent secret keys |

## Honest limits

- Runs on Midnight Preprod (ledger 9). Preprod moved from ledger 8 to ledger 9 on 9 Nov 2026, mid-wave, so Mandate was migrated (the contract source didn't change) and redeployed. The Wave 2 contract is still on Preprod too.
- Travel providers are simulated and labeled; they are not affiliated with the brands named.
- Mandate authorizes and proves spending. Moving funds is a later step, either a card rail or a stablecoin on Midnight (see [Business case](BUSINESS.md#the-path-to-real-money)). In both, Mandate never holds funds: on a card rail the agency's money stays at the card-issuing bank, and Mandate only creates a one-time card after the Midnight proof and approves the matching charge.
- An agency's payments share one contract, so they can be linked to each other (not to a name).
- This open-source edition has one owner account (no staff roles) and no AI guardrails beyond the human pay gate; run it on your own machine only. The app refuses requests from other websites and from non-local host names.
