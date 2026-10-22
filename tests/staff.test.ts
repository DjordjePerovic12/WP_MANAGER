import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/rng';
import { generateLeague } from '../engine';
import {
  createCareer,
  fireStaff,
  hireStaff,
  knowledgeOf,
  LEAGUES,
  makeStaff,
  nextRound,
  playerView,
  scoutingCapacity,
  scoutingLeft,
  scoutPlayer,
  setTraining,
  simulateRound,
  staffWages,
  wageRoom,
  type CareerState,
  type StaffRole,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 42, now: NOW });
const myTeam = (c: CareerState) => c.teams.find((t) => t.id === c.managedClubId)!;
const other = (c: CareerState) => c.teams.find((t) => t.id !== c.managedClubId)!.players[3];
/** Put a specific coach in a role (and give the club the money for it). */
const withCoach = (c: CareerState, role: StaffRole, rating: number | null): CareerState => {
  const staff = { ...c.staff };
  if (rating === null) delete staff[role];
  else staff[role] = makeStaff(createRng(rating), role, rating, `test-${role}`);
  const f = c.finances[c.managedClubId];
  return { ...c, staff, finances: { ...c.finances, [c.managedClubId]: { ...f, wageBudget: f.wageBudget + 200_000, balance: f.balance + 200_000 } } };
};
const rounds = (c: CareerState, n: number) => {
  for (let i = 0; i < n && nextRound(c); i++) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('staff', () => {
  it('a new career starts with staff the club can afford', () => {
    const c = start();
    expect(Object.keys(c.staff).length).toBeGreaterThanOrEqual(5);
    expect(staffWages(c.staff)).toBeGreaterThan(0);
    expect(wageRoom(c)).toBeGreaterThanOrEqual(0);
    expect(c.staffMarket.length).toBe(32); // 8 roles × 4 candidates
  });

  it('hires a candidate, pays off the coach he replaces, and fires', () => {
    let c = withCoach(start(), 'attack', 9);
    const candidate = c.staffMarket.filter((m) => m.role === 'attack').sort((a, b) => b.rating - a.rating)[0];
    const before = c.finances[c.managedClubId].balance;
    const hired = hireStaff(c, candidate.id);
    c = hired.state;
    expect(c.staff.attack!.id).toBe(candidate.id);
    expect(c.finances[c.managedClubId].balance).toBeLessThan(before);
    expect(c.staffMarket.some((m) => m.id === candidate.id)).toBe(false);
    const fired = fireStaff(c, 'attack').state;
    expect(fired.staff.attack).toBeUndefined();
  });

  it('the board blocks a hire that breaks the wage budget', () => {
    const c = start();
    const f = c.finances[c.managedClubId];
    const broke = { ...c, finances: { ...c.finances, [c.managedClubId]: { ...f, wageBudget: 0 } } };
    const candidate = c.staffMarket.find((m) => m.role === 'scout')!;
    expect(hireStaff(broke, candidate.id).message).toMatch(/board/i);
  });

  it('a great attacking coach develops shooting faster than none at all', () => {
    const base = setTraining(start(), { focus: 'shooting', intensity: 'normal' });
    const shooting = (c: CareerState) => myTeam(c).players.reduce((s, p) => s + p.attrs.shootingPower + p.attrs.shootingAccuracy, 0);
    const great = rounds(withCoach(base, 'attack', 19), 22);
    const none = rounds(withCoach(base, 'attack', null), 22);
    expect(shooting(great)).toBeGreaterThan(shooting(none) + 2);
  });

  it('a great fitness coach keeps the squad fresher', () => {
    const base = setTraining(start(), { focus: 'balanced', intensity: 'hard' });
    const fitness = (c: CareerState) => myTeam(c).players.reduce((s, p) => s + c.squad[p.id].condition, 0);
    expect(fitness(rounds(withCoach(base, 'fitness', 19), 8))).toBeGreaterThan(fitness(rounds(withCoach(base, 'fitness', null), 8)));
  });
});

describe('scouting', () => {
  it('you know your own players exactly and others only roughly', () => {
    const c = start();
    const mine = myTeam(c).players[2];
    expect(knowledgeOf(c, mine.id)).toBe('own');
    expect(playerView(c, mine).attrs.speed).toEqual({ low: mine.attrs.speed, high: mine.attrs.speed, exact: true });
    const p = other(c);
    const view = playerView(c, p);
    expect(view.knowledge).toBe('unknown');
    expect(view.personality).toBeUndefined();
    for (const [k, a] of Object.entries(view.attrs)) {
      const v = p.attrs[k as keyof typeof p.attrs];
      expect(a.exact).toBe(false);
      if (v > 1 && v < 20) expect(v >= a.low && v <= a.high).toBe(true);
    }
    expect(playerView(c, p)).toEqual(view); // ranges are stable
  });

  it('a good scout reports exact attributes, a weak one gets within a point', () => {
    const good = scoutPlayer(withCoach(start(), 'scout', 16), other(start()).id).state;
    expect(knowledgeOf(good, other(good).id)).toBe('exact');
    expect(playerView(good, other(good)).attrs.speed.exact).toBe(true);
    expect(playerView(good, other(good)).personality).toBeDefined();
    const weak = scoutPlayer(withCoach(start(), 'scout', 8), other(start()).id).state;
    expect(knowledgeOf(weak, other(weak).id)).toBe('close');
    const a = playerView(weak, other(weak)).attrs.speed;
    expect(a.high - a.low).toBeLessThanOrEqual(2);
  });

  it('scouts can only write so many reports a week; the count resets after a round', () => {
    let c = withCoach(start(), 'scout', 12);
    const capacity = scoutingCapacity(c.staff);
    const targets = c.teams.filter((t) => t.id !== c.managedClubId).flatMap((t) => t.players).slice(0, capacity + 1);
    for (const p of targets.slice(0, capacity)) c = scoutPlayer(c, p.id).state;
    expect(scoutingLeft(c)).toBe(0);
    expect(scoutPlayer(c, targets[capacity].id).message).toMatch(/busy/);
    c = simulateRound(c, nextRound(c)!, NOW);
    expect(scoutingLeft(c)).toBe(capacity);
  });
});
