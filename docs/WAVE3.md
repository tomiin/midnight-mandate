# Mandate · Wave 3 walkthrough

An AI agent searches travel providers, books, and pays with a zero-knowledge Mandate proof on a local Midnight network. Over-budget or revoked payments are refused by the contract.

## What you need

- Node 22+, Docker, and the Compact toolchain pinned to 0.31.0 (`compact update 0.31.0`) if you want to recompile.
- A Claude API key for the built-in assistant (console.anthropic.com). Optional: Claude Desktop (MCP) or any AI via the REST API.
- Optional, for Cascade backups: a Lumera testnet wallet (`cd policy && npm install && npm run generate-wallet`, then fund it from the Lumera testnet faucet).

## 1. Contract and tests

```bash
npm install
cd contract
npm run compile    # compact compile +0.31.0 (generated artifacts are committed, so this is optional)
npm test           # 21 tests, including the 3 order-binding tests
```

## 2. Local Midnight network and proof server

```bash
docker compose -f devnet/devnet.yml up -d
docker run -d --name midnight-proof-server -p 6300:6300 \
  midnightntwrk/proof-server:8.1.0 -- midnight-proof-server -v
```

The `dev` preset pre-funds the wallet from seed `0x00…01`, which the agent uses as its fee wallet, so no faucet is needed. The devnet starts from an empty chain each time it restarts.

## 3. Deploy and set up a mandate

```bash
cd agent
npm run demo:reset      # deploys if needed, travel limit $500, registers and authorizes the agent
```

It prints `Ready` with the contract address.

## 4. Start the app and API

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # for the built-in assistant; stays on this machine
npm run serve           # app on http://localhost:4400, REST API under /api/v1
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

- Runs on a local Midnight network for the demo; the Wave 2 contract runs on Preprod.
- Travel providers are simulated and labeled; they are not affiliated with the brands named.
- Mandate authorizes and proves spending. Moving funds (e.g. a stablecoin) is a later step.
- An agency's payments share one contract, so they can be linked to each other (not to a name).
- This open-source edition has one owner account (no staff roles) and no AI guardrails beyond the human pay gate; run it on your own machine only. The app refuses requests from other websites and from non-local host names.
