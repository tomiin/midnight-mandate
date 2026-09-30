import { describe, it, expect } from 'vitest';
import { deploy, key, actorId, agentId, grantLeaf } from '../simulator.js';

const REQ_A = key('request-aaa');
const REQ_B = key('request-bbb');
const REQ_C = key('request-ccc');

describe('Mandate — registry', () => {
  it('the deployer becomes the principal and the default agent is registered', () => {
    const { sim, agentPseudonym } = deploy();
    expect(sim.isAgent(agentPseudonym)).toBe(true);
  });

  it('a stranger cannot register an agent', () => {
    const { sim } = deploy();
    sim.actor('stranger', key('stranger'));
    expect(() => sim.as('stranger').registerAgent(agentId(key('rogue'))))
      .toThrow(/not the principal/);
  });

  it('a revoked agent can no longer receive new grants', () => {
    const { sim, category, agentPseudonym } = deploy();
    sim.as('principal').revokeAgent(agentPseudonym);
    expect(sim.isAgent(agentPseudonym)).toBe(false);
    expect(() => sim.as('principal').issueAuthorization(agentPseudonym, category))
      .toThrow(/agent is not registered/);
  });
});

describe('Mandate — issuing', () => {
  it('the principal can issue an authorization to a registered agent', () => {
    const { sim, category, agentPseudonym } = deploy();
    sim.as('principal').issueAuthorization(agentPseudonym, category);
    expect(sim.getLedger().grantsIssued).toBe(1n);
  });

  it('a stranger cannot issue', () => {
    const { sim, category, agentPseudonym } = deploy();
    sim.actor('stranger', key('stranger'));
    expect(() => sim.as('stranger').issueAuthorization(agentPseudonym, category))
      .toThrow(/not the principal/);
  });

  it('cannot issue against an unconfigured category', () => {
    const { sim, agentPseudonym } = deploy();
    expect(() => sim.as('principal').issueAuthorization(agentPseudonym, 99n))
      .toThrow(/category not configured/);
  });
});

describe('Mandate — exercising', () => {
  it('an agent can exercise a grant issued to it', () => {
    const { sim, category, agentSk } = deploy({ limit: 200n });
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });

  it('an agent that was never granted cannot exercise', () => {
    const { sim, category } = deploy();
    sim.requesting('agent', REQ_A);
    expect(() => sim.as('agent').exercise(category, 10n)).toThrow(/no such authorization/);
  });

  it('a grant issued to a different agent cannot be exercised', () => {
    const { sim, category, agentSk } = deploy();
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    // Registered as an agent (so it clears the isAgent kill-switch check) but
    // never granted anything itself — the Merkle-membership check is what
    // must catch this, not the registry check.
    const impersonatorSk = key('impersonator');
    sim.actor('impersonator', impersonatorSk, REQ_A);
    sim.as('principal').registerAgent(agentId(impersonatorSk));

    expect(() => sim.as('impersonator').exercise(category, 10n)).toThrow(/no such authorization/);
  });

  it('THE SAME REQUEST CANNOT BE PROCESSED TWICE', () => {
    const { sim, category, agentSk } = deploy({ limit: 200n });
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    expect(() => sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n))
      .toThrow(/already processed/);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });

  it('a NEW request against the same grant succeeds — unlike a single-use prescription', () => {
    const { sim, category, agentSk } = deploy({ limit: 200n });
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 50n);
    sim.requesting('agent', REQ_B).as('agent').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });
});

describe('Mandate — revocation is checked at spend time', () => {
  it('revoking an agent mid-authorization immediately blocks further exercise', () => {
    const { sim, category, agentSk, agentPseudonym } = deploy({ limit: 200n });
    sim.as('principal').issueAuthorization(agentPseudonym, category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 20n);

    sim.as('principal').revokeAgent(agentPseudonym);

    expect(() => sim.requesting('agent', REQ_B).as('agent').exercise(category, 20n))
      .toThrow(/not currently authorized/);
    expect(sim.getLedger().exercisedCount).toBe(1n);
  });
});

describe('Mandate — category budget (dollar sum, not a fill count)', () => {
  it('sums amounts against the cap, then refuses the request that would exceed it', () => {
    const { sim, category, limit, agentSk } = deploy({ limit: 200n });
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 120n);
    expect(() => sim.requesting('agent', REQ_B).as('agent').exercise(category, 90n))
      .toThrow(/category budget exceeded/);

    // A smaller top-up that fits the remaining 80 succeeds — proves this is a
    // running sum, not a fixed count of allowed calls.
    sim.requesting('agent', REQ_C).as('agent').exercise(category, 80n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });

  it('advancing the period resets the budget', () => {
    const { sim, category, agentSk } = deploy({ limit: 100n });
    sim.as('principal').issueAuthorization(agentId(agentSk), category);

    sim.requesting('agent', REQ_A).as('agent').exercise(category, 100n);
    expect(() => sim.requesting('agent', REQ_B).as('agent').exercise(category, 1n))
      .toThrow(/category budget exceeded/);

    sim.as('principal').advancePeriod();
    sim.requesting('agent', REQ_B).as('agent').exercise(category, 100n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });

  it("one agent's budget does not affect another's", () => {
    const { sim, category } = deploy({ limit: 50n });
    const aliceSk = key('alice');
    const bobSk = key('bob');
    sim.actor('alice', aliceSk, REQ_A);
    sim.actor('bob', bobSk, REQ_B);

    sim.as('principal').registerAgent(agentId(aliceSk));
    sim.as('principal').registerAgent(agentId(bobSk));
    sim.as('principal').issueAuthorization(agentId(aliceSk), category);
    sim.as('principal').issueAuthorization(agentId(bobSk), category);

    sim.as('alice').exercise(category, 50n);
    sim.as('bob').exercise(category, 50n);
    expect(sim.getLedger().exercisedCount).toBe(2n);
  });
});

describe('Mandate — domain separation', () => {
  it('the agent id and the actor id from one key are different values', () => {
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

  it('rejects a path lifted from a grant issued to someone else', () => {
    const { sim } = deploy({ category, limit: 200n });
    const aliceSk = key('alice');
    const mallorySk = key('mallory');

    sim.actor('alice', aliceSk, REQ_A);
    sim.as('principal').registerAgent(agentId(aliceSk));
    sim.as('principal').issueAuthorization(agentId(aliceSk), category);

    // Mallory is a registered agent (so the kill-switch check clears — this
    // test is specifically about the Merkle leaf-binding fix, not the
    // registry check) but has no grant of her own. Her witness returns the
    // path to Alice's leaf.
    const aliceLeaf = grantLeaf(agentId(aliceSk), category);
    sim.actor('mallory', mallorySk, REQ_B, aliceLeaf);
    sim.as('principal').registerAgent(agentId(mallorySk));

    expect(() => sim.as('mallory').exercise(category, 10n))
      .toThrow(/path does not match this agent's grant/);
  });

  it('still lets the rightful holder exercise', () => {
    const { sim } = deploy({ category, limit: 200n });
    const aliceSk = key('alice');
    sim.actor('alice', aliceSk, REQ_A);
    sim.as('principal').registerAgent(agentId(aliceSk));
    sim.as('principal').issueAuthorization(agentId(aliceSk), category);

    expect(() => sim.as('alice').exercise(category, 10n)).not.toThrow();
  });
});
