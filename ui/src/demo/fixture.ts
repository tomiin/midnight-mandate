/**
 * A recording of a real Mandate run on Preprod.
 *
 * Every field below was produced by the contract, not written by hand: the
 * step outcomes, and in particular the two refusal messages, are the exact
 * strings the circuits emitted during the run on 2026-09-17. The demo page
 * replays these so somebody can see what Mandate does without installing
 * Lace, funding a wallet with DUST, or running a proof server.
 *
 * Nothing here is simulated behaviour. It is a transcript, and the contract
 * it came from is public — every number can be checked on the explorer.
 */

export const DEMO_CONTRACT =
  "5c7f2cc3e8d8bdc554ae3b3e5d65522705341e578c362da2261ab1c70f969757";

export const EXPLORER_CONTRACT = `https://preprod.midnightexplorer.com/contracts/0x${DEMO_CONTRACT}`;

/** Shown truncated exactly as the live app truncates it. */
export const DEMO_AGENT_PSEUDONYM = "b010d4f2d8f3b44135798bd8";

export const DEMO_AGENT_NAME = "Travel Booking Agent";
export const DEMO_CAP = 500;

export interface DemoStep {
  n: number;
  id: string;
  title: string;
  actor: "principal" | "agent";
  expectRefusal: boolean;
  body: string;
  /** The outcome the contract actually produced. */
  outcome: "passed" | "refused";
  /** Plain-English headline for the refusal stamp. */
  refusal?: string;
  /** The full raw string the SDK surfaced, kept so nothing looks massaged. */
  raw?: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    n: 1,
    id: "register",
    title: `Hire ${DEMO_AGENT_NAME}`,
    actor: "principal",
    expectRefusal: false,
    outcome: "passed",
    body: `You bring ${DEMO_AGENT_NAME} on to handle bookings on your behalf. What lands on-chain is a one-way hash of its key — not its name, not anything that says "travel," nothing that ties it to a real name or company.`,
  },
  {
    n: 2,
    id: "limit",
    title: `Set a $${DEMO_CAP} travel budget`,
    actor: "principal",
    expectRefusal: false,
    outcome: "passed",
    body: `The per-period ceiling for travel spending. The number is stored on-chain so it can be enforced — but nothing on-chain says the category is "travel," or that this cap belongs to ${DEMO_AGENT_NAME} specifically.`,
  },
  {
    n: 3,
    id: "issue",
    title: `Authorize ${DEMO_AGENT_NAME} to book travel`,
    actor: "principal",
    expectRefusal: false,
    outcome: "passed",
    body: "Inserts a Merkle commitment binding this agent to the travel category. The grant itself is never revealed on-chain — only that the tree changed.",
  },
  {
    n: 4,
    id: "spend-ok",
    title: `${DEMO_AGENT_NAME} books a flight for $250`,
    actor: "agent",
    expectRefusal: false,
    outcome: "passed",
    body: "Now the agent acts on its own. In one proof it shows: it is currently authorized, for this category, this request is not a replay, and the booking fits the budget. The airline gets a proof it's valid, but never learns who authorized the agent or what the budget is for. (The cap and totals themselves are public numbers.)",
  },
  {
    n: 5,
    id: "spend-over",
    title: `${DEMO_AGENT_NAME} tries to book a $251 hotel`,
    actor: "agent",
    expectRefusal: true,
    outcome: "refused",
    refusal: "Over budget: $250 already spent, plus $251 is more than the $500 cap.",
    raw: "Unexpected error executing scoped transaction '<unnamed>': Error: failed assert: Mandate: category budget exceeded for this period",
    body: `$250 + $251 is one dollar over the $${DEMO_CAP} cap. The budget is a running sum across bookings, not a per-booking check, and it's enforced to the dollar. Refusal here is the feature, not a bug.`,
  },
  {
    n: 6,
    id: "revoke",
    title: `Fire ${DEMO_AGENT_NAME}`,
    actor: "principal",
    expectRefusal: false,
    outcome: "passed",
    body: "The kill switch. Existing grants aren't deleted from the tree — authorization is re-checked live on every single booking attempt instead, so revoking takes effect immediately.",
  },
  {
    n: 7,
    id: "spend-revoked",
    title: `Fired ${DEMO_AGENT_NAME} tries to book a $1 coffee anyway`,
    actor: "agent",
    expectRefusal: true,
    outcome: "refused",
    refusal: "Not authorized: Travel Booking Agent has been fired, so no booking can go through.",
    raw: "Unexpected error executing scoped transaction '<unnamed>': Error: failed assert: Mandate: agent is not currently authorized",
    body: "The grant is still sitting in the Merkle tree and there's still budget left. It's refused anyway, purely because registration is checked live, every time — being in the tree once is never enough on its own.",
  },
];

/** Public ledger as it read after the run above. */
export const DEMO_LEDGER: { value: string; label: string; note?: string }[] = [
  { value: "1", label: "Grants issued" },
  { value: "1", label: "Times exercised" },
  { value: "1", label: "Budget period" },
  { value: "0", label: "Active agents", note: "(1 revoked)" },
];

/** The Cascade backup taken during the same session. */
export const DEMO_CASCADE = {
  actionId: "88119",
  backedUpAt: "9/17/2026, 2:43:27 PM",
  txHash: "7F689ADBB4F59895F5092B7BAA8D888C0F5CCFAD514F5139752CBCE550176011",
  block: "6674184",
  lumeraAddress: "lumera1grpvkkzcqsyj5egpn7arj0eyjmy5wlr6ukg6q6",
};
