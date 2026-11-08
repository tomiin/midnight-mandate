# Mandate: business case

**One line:** AI agents that can spend company money safely. The spending rules are enforced
by a public contract on Midnight, and nobody in the payment chain learns who the business or
its client is.

Mandate Travel (for travel agencies) is the first product. Mandate itself is a general
spending-mandate layer for any business that lets AI agents pay.

## The problem

AI assistants can already search and compare travel. The hard part is letting them **pay**:

- **Control.** An agency owner can't hand an AI the company card. They need a hard limit that
  holds even if the AI is wrong, confused or manipulated.
- **Privacy.** Every booking an AI makes leaks who the agency's clients are, where they go and
  what they spend, to the AI provider, to payment processors and to suppliers. For an agency,
  its client list is the business.
- **Proof.** Clients and suppliers need to check that a payment was allowed and made, without
  being handed the agency's books.

Today the choice is an AI that can't pay, or an AI with a card and no guardrails.

## What Mandate does

| Need | How Mandate handles it |
|---|---|
| Hard spending limit | The Mandate contract refuses any payment over the budget or from a revoked agent. The refusal happens before anything is submitted |
| Human in the loop | Bookings over a trip's budget wait in Approvals for the owner. Every payment needs a person's "yes" |
| Privacy from the AI provider | The privacy proxy replaces client, traveller and staff names with placeholders before anything leaves the agency. Passports and dates of birth never go to the AI |
| Privacy on chain | The ledger shows that an authorized agent paid an order within budget. It never shows who the agency or client is |
| Proof anyone can check | The public Verify page checks a payment against the ledger with no wallet or account |
| Records that survive | The agency's records are encrypted with the owner's passphrase and backed up to Lumera Cascade |

## Who buys it

**First customers: independent travel agencies and home-based travel advisors.** They do a lot
of repetitive searching and booking, they work alone or in small teams, they decide quickly,
and their client relationships are their main asset.

**Next:**

- Travel management companies and corporate travel desks, which need policy limits and audit trails.
- Event and group travel, where each attendee has a spending cap.
- Beyond travel: procurement agents, marketing and ad-spend agents, and any "let the AI pay" case where the buyer's identity is commercially sensitive.

## Why now

- Business travel spend is about $1.71T in 2026 and is forecast to pass $2T by 2030 (GBTA forecast).
- Analysts expect a large share of travel bookings to be made by AI agents by the end of the decade.
- Most people don't yet trust an AI to book and pay alone. That's the case for starting with businesses, with hard limits and a human approval step.
- Midnight now supports contract-to-contract calls (ledger 9, Nov 2026). A supplier's checkout can call Mandate in the same transaction.

## Business model (to be tested with pilots)

| Option | How it works | Fit |
|---|---|---|
| Per-seat subscription | Monthly price per staff seat. Open-source Lite core, paid commercial edition (team roles, security centre, encrypted documents, audit chain) | Small agencies |
| Per-booking fee | Small fee per paid booking through Mandate | Grows with usage |
| Enterprise | Self-hosted, single sign-on, custom limits, audit exports | Travel management companies, corporate desks |
| Platform / API | Other apps use Mandate as their spending-policy contract | Later |

Prices will be set after pilots show what agencies will pay.

**Open core.** This repository (Mandate Lite: contract, agent, privacy proxy, Verify page,
Cascade backups) is Apache 2.0, so anyone can audit the parts that handle money and privacy.
The commercial edition adds what a staffed agency needs to run on it day to day.

## Plan

| When (target) | Milestone |
|---|---|
| Nov 2026 | Wave 3: working product on a local Midnight network, end-to-end tested |
| Dec 2026 – Jan 2027 | Close the privacy gaps (unlinkable agents, private budgets); move to the ledger 9 stack; run on Preview; contract-to-contract checkout; choose hosting (hosted, with a self-hosted option) |
| Q1 2027 | Pilot with 2–3 agencies, then 3–5; connect one real booking source; choose a settlement path; external review of the contract and privacy proxy; website and first case study |
| Q2 2027 | First paying customers |
| 2027 | Private composability and private settlement as Midnight ships them; first verticals beyond travel |

### Pilots

- Free for the first agencies.
- They plan real trips with Mandate Travel, starting with simulated suppliers and then one real supplier, and join a short weekly feedback call.
- We measure time saved per booking, how often Approvals is used, what they'd pay, and what blocks them.

### The path to real money

Mandate proves a payment was **allowed**. Something still has to **move** the money. There are two options, to be chosen with pilot agencies:

- **Card or bank rail, with Mandate as the authorization and proof layer on top.** This works with suppliers today.
- **Settlement on Midnight in a stablecoin**, or later in Midnight's shielded tokens, so the payment itself stays confidential too.

Before real money moves, there will be an external review of the contract and the privacy proxy.

## Competition and edge

- **Card networks' and payment companies' agent programs** and signed-mandate protocols (such as AP2-style mandates) give agents limits. They don't hide who the buyer is from the chain of providers, and they don't offer public, wallet-free verification.
- **Travel booking tools with AI assistants** focus on search. They don't make the AI's spending provably bounded.
- **Mandate's edge is privacy plus public verifiability.** It can sit on top of any payment rail as the authorization layer.

## Honest limits

- **Suppliers are simulated today.** They're labelled and not affiliated with the brands they're named after.
- **Budget amounts are public on the ledger.** Who they belong to is not. Private budgets are next.
- **Settlement isn't built yet** (see above).
- **The code hasn't been externally audited yet.**
- **Privacy is precise, not total.** An airline still receives the passenger's name, because the law requires it. That happens directly from the agency's records, never through the AI.
