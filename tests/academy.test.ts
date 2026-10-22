import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import {
  createCareer,
  ensureSquads,
  LEAGUES,
  nextMatchday,
  promoteYouth,
  releaseYouth,
  setWageBudget,
  simulateMatchday,
  startNextSeason,
  wageBudgetRange,
  wageRoom,
  type CareerState,
} from '../game';

const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: LEAGUES.find((l) => l.id === 'ita')!, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 11, now: NOW });
const finish = (c: CareerState) => {
  while (nextMatchday(c) !== undefined) c = simulateMatchday(c, nextMatchday(c)!, NOW);
  return c;
};

describe('youth academy', () => {
  const c = start();

  it('starts with six youngsters who are not in the first team', () => {
    expect(c.academy).toHaveLength(6);
    const first = new Set(c.teams.flatMap((t) => t.players.map((p) => p.id)));
    for (const p of c.academy!) {
      expect(p.age).toBeGreaterThanOrEqual(15);
      expect(p.age).toBeLessThanOrEqual(18);
      expect(first.has(p.id)).toBe(false);
      expect(c.potential[p.id]).toBeGreaterThan(overall(p));
    }
  });

  it('develops youngsters during the season', () => {
    const done = finish(c);
    const before = c.academy!.reduce((s, p) => s + overall(p), 0);
    const after = done.academy!.reduce((s, p) => s + overall(p), 0);
    expect(after).toBeGreaterThan(before + 1);
  });

  it('promotes a youngster with a contract and a free cap number', () => {
    const youngster = c.academy![0];
    const { state } = promoteYouth(c, youngster.id);
    const mine = state.teams.find((t) => t.id === state.managedClubId)!;
    const promoted = mine.players.find((p) => p.id === youngster.id)!;
    expect(promoted).toBeDefined();
    expect(state.academy!.some((p) => p.id === youngster.id)).toBe(false);
    expect(state.contracts[youngster.id].wage).toBeGreaterThanOrEqual(3000);
    expect(new Set(mine.players.map((p) => p.cap)).size).toBe(mine.players.length);
    expect(releaseYouth(c, c.academy![1].id).state.academy).toHaveLength(5);
  });

  it('brings in a new intake in the summer and lets 20-year-olds go', () => {
    // A manager who keeps his first team under contract.
    const contracts = Object.fromEntries(Object.entries(c.contracts).map(([id, k]) => [id, { ...k, until: 2030 }]));
    const old = { ...c, contracts, academy: c.academy!.map((p, i) => (i === 0 ? { ...p, age: 19 } : p)) };
    const next = startNextSeason(finish(old), NOW);
    expect(next.academy!.some((p) => p.id === c.academy![0].id)).toBe(false);
    expect(next.news.some((n) => /turned 20/.test(n.text))).toBe(true);
    expect(next.academy!.some((p) => p.id.includes('-A2027-'))).toBe(true);
  });

  it('fills a short first team from the academy before generating anyone', () => {
    const mine = c.teams.find((t) => t.id === c.managedClubId)!;
    const tiny = { ...c, teams: c.teams.map((t) => (t.id === mine.id ? { ...t, players: t.players.slice(0, 10) } : t)) };
    const fixed = ensureSquads(tiny);
    const squad = fixed.teams.find((t) => t.id === mine.id)!;
    expect(squad.players.length).toBe(13);
    expect(squad.players.filter((p) => p.position === 'GK').length).toBe(2);
    // Every field place is filled from the academy; only a goalkeeper the academy lacks comes from outside.
    const fromAcademy = squad.players.filter((p) => c.academy!.some((y) => y.id === p.id)).length;
    const generated = squad.players.filter((p) => p.id.includes('-R2026-')).length;
    expect(fromAcademy + generated).toBe(3);
    expect(squad.players.filter((p) => p.id.includes('-R2026-')).every((p) => p.position === 'GK')).toBe(true);
    expect(new Set(squad.players.map((p) => p.cap)).size).toBe(squad.players.length);
  });
});

describe('a missing goalkeeper', () => {
  it('only brings in a goalkeeper, without emptying the academy', () => {
    const c = start();
    const mine = c.teams.find((t) => t.id === c.managedClubId)!;
    const oneKeeper = [...mine.players.filter((p) => p.position !== 'GK'), mine.players.find((p) => p.position === 'GK')!];
    const academy = c.academy!.filter((p) => p.position !== 'GK');
    const fixed = ensureSquads({ ...c, academy, teams: c.teams.map((t) => (t.id === mine.id ? { ...t, players: oneKeeper } : t)) });
    const squad = fixed.teams.find((t) => t.id === mine.id)!;
    expect(squad.players.length).toBe(oneKeeper.length + 1);
    expect(squad.players.filter((p) => p.position === 'GK')).toHaveLength(2);
    expect(fixed.academy).toHaveLength(academy.length);
  });
});

describe('wage budget', () => {
  it('can be raised with transfer funds, within half the balance', () => {
    const c = start();
    const f = c.finances[c.managedClubId];
    const { min, max } = wageBudgetRange(f);
    expect(min).toBe(f.wageBudget);
    expect(max - min).toBe(Math.round((f.balance * 0.5) / 1000) * 1000);
    const raised = setWageBudget(c, max + 1_000_000);
    expect(raised.finances[c.managedClubId].wageBudget).toBe(max);
    expect(wageRoom(raised)).toBe(wageRoom(c) + (max - min));
    expect(setWageBudget(c, 0).finances[c.managedClubId].wageBudget).toBe(min);
  });
});
