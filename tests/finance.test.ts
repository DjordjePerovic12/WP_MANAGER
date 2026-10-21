import { describe, expect, it } from 'vitest';
import { generateLeague, teamRating } from '../engine';
import {
  contractDemand,
  createCareer,
  expiringContracts,
  LEAGUES,
  nextRound,
  offerContract,
  playerValue,
  expectedWage,
  simulateRound,
  startNextSeason,
  wageBill,
  wageRoom,
  type CareerState,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const real = generateLeague(5, 6);
const make = (club: string) => createCareer({ league: ita, realTeams: real, managedClubId: club, seed: 42, now: NOW });
/** A club with several contracts ending this season, so renewals can be tested. */
const club = real.map((t) => t.id).sort((a, b) => expiringContracts(make(b)).length - expiringContracts(make(a)).length)[0];
const start = () => make(club);
const myTeam = (c: CareerState) => c.teams.find((t) => t.id === c.managedClubId)!;
const finishSeason = (c: CareerState) => {
  while (nextRound(c)) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('money basics', () => {
  it('values players by ability, age and potential', () => {
    const [team] = generateLeague(3, 1);
    const p = team.players[3];
    const better = { ...p, attrs: Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, Math.min(20, v + 2)])) as unknown as typeof p.attrs };
    expect(playerValue(better)).toBeGreaterThan(playerValue(p));
    expect(playerValue({ ...p, age: 20 })).toBeGreaterThan(playerValue({ ...p, age: 33 }));
    expect(expectedWage(better)).toBeGreaterThan(expectedWage(p));
  });

  it('gives every player a contract and every club sustainable finances', () => {
    const c = start();
    for (const t of c.teams) {
      for (const p of t.players) {
        expect(c.contracts[p.id].wage).toBeGreaterThan(0);
        expect(c.contracts[p.id].until).toBeGreaterThanOrEqual(2026);
      }
      const f = c.finances[t.id];
      expect(f.revenue).toBeGreaterThan(wageBill(t, c.contracts));
      expect(f.balance).toBeGreaterThan(0);
      expect(f.wageBudget).toBeGreaterThanOrEqual(wageBill(t, c.contracts));
    }
    const ranked = [...c.teams].sort((a, b) => teamRating(b.players) - teamRating(a.players));
    expect(wageBill(ranked[0], c.contracts)).toBeGreaterThan(wageBill(ranked[ranked.length - 1], c.contracts) * 2);
  });

  it('pays wages and income every round', () => {
    const c = simulateRound(start(), 1, NOW);
    const f = c.finances[c.managedClubId];
    expect(f.ledger.map((e) => e.label)).toEqual(['Sponsors & tickets', 'Wages']);
    expect(f.balance).not.toBe(start().finances[c.managedClubId].balance);
  });
});

describe('contract renewals', () => {
  const c = start();
  const expiring = expiringContracts(c);

  it('lists the players whose contracts end this season', () => {
    expect(expiring.length).toBeGreaterThan(0);
    for (const p of expiring) expect(c.contracts[p.id].until).toBe(2026);
  });

  it('a player accepts his asking wage, and the contract is extended', () => {
    const p = expiring[0];
    const demand = contractDemand(c, p.id);
    const out = offerContract(c, p.id, demand.wage, demand.years);
    expect(out.accepted).toBe(true);
    expect(out.state.contracts[p.id]).toEqual({ wage: demand.wage, until: 2026 + demand.years });
    expect(offerContract(out.state, p.id, demand.wage, demand.years).accepted).toBe(false); // talks are closed once signed
  });

  it('the board blocks deals that break the wage budget', () => {
    const p = expiring[0];
    const out = offerContract(c, p.id, wageRoom(c, p.id) + 1000, 2);
    expect(out.accepted).toBe(false);
    expect(out.message).toMatch(/board/i);
  });

  it('an insulting offer ends the talks, and there are at most three offers', () => {
    const p = expiring[0];
    const demand = contractDemand(c, p.id);
    const insulted = offerContract(c, p.id, Math.round(demand.wage * 0.5), 2);
    expect(insulted.accepted).toBe(false);
    expect(offerContract(insulted.state, p.id, demand.wage, 2).message).toMatch(/not willing/);
    let s = c;
    for (let i = 0; i < 3; i++) s = offerContract(s, p.id, Math.round(demand.wage * 0.9), 2).state;
    if (!s.negotiations[p.id].closed) expect(offerContract(s, p.id, demand.wage, 2).message).toMatch(/broken down/);
  });
});

describe('summer', () => {
  it('unrenewed players leave as free agents; renewed ones stay', () => {
    let c = start();
    const [keep, ...rest] = expiringContracts(c);
    c = offerContract(c, keep.id, contractDemand(c, keep.id).wage, 2).state;
    const next = startNextSeason(finishSeason(c), NOW);
    const ids = myTeam(next).players.map((p) => p.id);
    expect(ids).toContain(keep.id);
    for (const p of rest) expect(ids).not.toContain(p.id);
    for (const p of rest.filter((x) => x.age < 35)) expect(next.freeAgents.some((f) => f.player.id === p.id) || !next.contracts[p.id]).toBe(true);
    expect(next.summer!.contractsEnded.length).toBe(rest.length - next.summer!.retired.filter((r) => rest.some((p) => p.name === r.name)).length);
    expect(next.summer!.finance!.prizeMoney).toBeGreaterThan(0);
    for (const t of next.teams) for (const p of t.players) expect(next.contracts[p.id]?.until).toBeGreaterThanOrEqual(2027);
  });

  it('stays solvent over five seasons', () => {
    let c = start();
    for (let i = 0; i < 5; i++) c = startNextSeason(finishSeason(c), NOW);
    const balances = c.teams.map((t) => c.finances[t.id].balance);
    const sorted = [...balances].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(0);
    for (const t of c.teams) expect(wageBill(t, c.contracts)).toBeLessThan(c.finances[t.id].revenue * 1.6);
    expect(c.freeAgents.length).toBeGreaterThan(0);
  });
});
