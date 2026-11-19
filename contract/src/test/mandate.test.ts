import { describe, it, expect } from 'vitest';
import { deploy, key, actorId, agentId, grantLeaf } from '../simulator.js';

const REQ_A = key('request-aaa');
const REQ_B = key('request-bbb');
const REQ_C = key('request-ccc');

describe('Mandate — registry', () => {
  it('the deployer becomes the principal and the default agent is registered', async () => {
    const { sim, agentPseudonym } = await deploy();
    expect(await sim.isAgent(agentPseudonym)).toBe(true);
  });

  it('a stranger cannot register an agent', async () => {
    const { sim } = await deploy();
    sim.actor('stranger', key('stranger'));
    await expect(sim.as('stranger').registerAgent(agentId(key('rogue'))))
      .rejects.toThrow(/not the principal/);
  });

  it('a revoked agent can no longer receive new grants', async () => {
    const { sim, category, agentPseudonym } = await deploy();
    await sim.as('principal').revokeAgent(agentPseudonym);
    expect(await sim.isAgent(agentPseudonym)).toBe(false);
    await expect(sim.as('principal').issueAuthorization(agentPseudonym, category))
      .rejects.toThrow(/agent is not registered/);
  });
});

describe('Mandate — issuing', () => {
  it('the principal can issue an authorization to a registered agent', async () => {
    const { sim, category, agentPseudonym } = await deploy();
    await sim.as('principal').issueAuthorization(agentPseudonym, category);
    expect(sim.getLedger().grantsIssued).toBe(1n);
  });

  it('a stranger cannot issue', async () => {
    const { sim, category, agentPseudonym } = await deploy();
    sim.actor('stranger', key('stranger'));
    await expect(sim.as('stranger').issueAuthorization(agentPseudonym, category))
      .rejects.toThrow(/not the principal/);
  });

  it('cannot issue against an unconfigured category', async () => {
    const { sim, agentPseudonym } = await deploy();
    await expect(sim.as('principal').issueAuthorization(agentPseudonym, 99n))
      .rejects.toThrow(/category not configured/);
  });
});

describe('Mandate — exercising', () => {
  it('an agent can exercise a grant issued to it', async () => {
    const { sim, category, agentSk } = await deploy({ limit: 200n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });

  it('an agent that was never granted cannot exercise', async () => {
    const { sim, category } = await deploy();
    sim.requesting('agent', REQ_A);
    await expect(sim.as('agent').exercise(category, 10n)).rejects.toThrow(/no such authorization/);
  });

  it('a grant issued to a different agent cannot be exercised', async () => {
    const { sim, category, agentSk } = await deploy();
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    // Registered as an agent (so it clears the isAgent kill-switch check) but
    // never granted anything itself — the Merkle-membership check is what
    // must catch this, not the registry check.
    const impersonatorSk = key('impersonator');
    sim.actor('impersonator', impersonatorSk, REQ_A);
    await sim.as('principal').registerAgent(agentId(impersonatorSk));

    await expect(sim.as('impersonator').exercise(category, 10n)).rejects.toThrow(/no such authorization/);
  });

  it('THE SAME REQUEST CANNOT BE PROCESSED TWICE', async () => {
    const { sim, category, agentSk } = await deploy({ limit: 200n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    await expect(sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n))
      .rejects.toThrow(/already processed/);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });

  it('a NEW request against the same grant succeeds — unlike a single-use prescription', async () => {
    const { sim, category, agentSk } = await deploy({ limit: 200n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    await sim.requesting('agent', REQ_B).as('agent').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });
});

describe('Mandate — revocation is checked at spend time', () => {
  it('revoking an agent mid-authorization immediately blocks further exercise', async () => {
    const { sim, category, agentSk, agentPseudonym } = await deploy({ limit: 200n });
    await sim.as('principal').issueAuthorization(agentPseudonym, category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 20n);

    await sim.as('principal').revokeAgent(agentPseudonym);

    await expect(sim.requesting('agent', REQ_B).as('agent').exercise(category, 20n))
      .rejects.toThrow(/not currently authorized/);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });
});

describe('Mandate — category budget (dollar sum, not a fill count)', () => {
  it('sums amounts against the cap, then refuses the request that would exceed it', async () => {
    const { sim, category, limit, agentSk } = await deploy({ limit: 200n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 120n);
    await expect(sim.requesting('agent', REQ_B).as('agent').exercise(category, 90n))
      .rejects.toThrow(/category budget exceeded/);

    // A smaller top-up that fits the remaining 80 succeeds — proves this is a
    // running sum, not a fixed count of allowed calls.
    await sim.requesting('agent', REQ_C).as('agent').exercise(category, 80n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });

  it('advancing the period resets the budget', async () => {
    const { sim, category, agentSk } = await deploy({ limit: 100n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);

    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 100n);
    await expect(sim.requesting('agent', REQ_B).as('agent').exercise(category, 1n))
      .rejects.toThrow(/category budget exceeded/);

    await sim.as('principal').advancePeriod();
    await sim.requesting('agent', REQ_B).as('agent').exercise(category, 100n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });

  it("one agent's budget does not affect another's", async () => {
    const { sim, category } = await deploy({ limit: 50n });
    const aliceSk = key('alice');
    const bobSk = key('bob');
    sim.actor('alice', aliceSk, REQ_A);
    sim.actor('bob', bobSk, REQ_B);

    await sim.as('principal').registerAgent(agentId(aliceSk));
    await sim.as('principal').registerAgent(agentId(bobSk));
    await sim.as('principal').issueAuthorization(agentId(aliceSk), category);
    await sim.as('principal').issueAuthorization(agentId(bobSk), category);

    await sim.as('alice').exercise(category, 50n);
    await sim.as('bob').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });
});

describe('Mandate — domain separation', () => {
  it('the agent id and the actor id from one key are different values', async () => {
    const sk = key('same-person');
    expect(Buffer.from(agentId(sk)).toString('hex'))
      .not.toBe(Buffer.from(actorId(sk)).toString('hex'));
  });
});

// Regression test for the Merkle path-binding bug, carried over from
// midnight-rxlimit (github.com/tomiin/merkle-leaf-binding-probe).
//
// The witness runs on the caller's machine, so `grantPath` is under their
// control. Without binding the returned path to the leaf actually derived in
// the circuit, a caller could hand back the path for somebody else's
// genuinely-issued grant and exercise it, repeatedly, since the request
// nullifier is derived from their own key and a request id they choose.
describe("Mandate — a path must belong to the caller's own grant", () => {
  const category = 1n;

  it('rejects a path lifted from a grant issued to someone else', async () => {
    const { sim } = await deploy({ category, limit: 200n });
    const aliceSk = key('alice');
    const mallorySk = key('mallory');

    sim.actor('alice', aliceSk, REQ_A);
    await sim.as('principal').registerAgent(agentId(aliceSk));
    await sim.as('principal').issueAuthorization(agentId(aliceSk), category);

    // Mallory is a registered agent (so the kill-switch check clears — this
    // test is specifically about the Merkle leaf-binding fix, not the
    // registry check) but has no grant of her own. Her witness returns the
    // path to Alice's leaf.
    const aliceLeaf = grantLeaf(agentId(aliceSk), category);
    sim.actor('mallory', mallorySk, REQ_B, aliceLeaf);
    await sim.as('principal').registerAgent(agentId(mallorySk));

    await expect(sim.as('mallory').exercise(category, 10n))
      .rejects.toThrow(/path does not match this agent's grant/);
  });

  it('still lets the rightful holder exercise', async () => {
    const { sim } = await deploy({ category, limit: 200n });
    const aliceSk = key('alice');
    sim.actor('alice', aliceSk, REQ_A);
    await sim.as('principal').registerAgent(agentId(aliceSk));
    await sim.as('principal').issueAuthorization(agentId(aliceSk), category);

    await expect(sim.as('alice').exercise(category, 10n)).resolves.toBeUndefined();
  });
});

describe('Mandate — order binding (Wave 3)', () => {
  const ORDER_1 = key('order-NA-1041');
  const ORDER_2 = key('order-NA-1042');

  async function ready() {
    const { sim, category, agentSk } = await deploy({ limit: 500n });
    await sim.as('principal').issueAuthorization(agentId(agentSk), category);
    return { sim, category };
  }

  it('records the paid amount against the merchant order reference', async () => {
    const { sim, category } = await ready();
    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 216n, ORDER_1);
    const ledger = sim.getLedger();
    expect(ledger.paidOrders.member(ORDER_1)).toBe(true);
    expect(ledger.paidOrders.lookup(ORDER_1)).toBe(216n);
    expect(ledger.paidOrders.member(ORDER_2)).toBe(false);
  });

  it('refuses to pay the same order twice, even with a fresh request id', async () => {
    const { sim, category } = await ready();
    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 100n, ORDER_1);
    await expect(sim.requesting('agent', REQ_B).as('agent').exercise(category, 100n, ORDER_1))
      .rejects.toThrow(/order already paid/);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });

  it('pays two different orders independently', async () => {
    const { sim, category } = await ready();
    await sim.requesting('agent', REQ_A).as('agent').exercise(category, 216n, ORDER_1);
    await sim.requesting('agent', REQ_B).as('agent').exercise(category, 131n, ORDER_2);
    expect(sim.getLedger().paidOrders.lookup(ORDER_2)).toBe(131n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });
});
