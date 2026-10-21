import { describe, expect, it } from 'vitest';
import { generateLeague, simulateMatch } from '../engine';
import {
  createCareer,
  fixtureSeed,
  leagueTable,
  LEAGUES,
  makeSchedule,
  managedFixture,
  nextRound,
  recordResult,
  seasonFinished,
  simulateFixture,
  simulateRound,
  teamFor,
  topScorers,
  totalRounds,
  type CareerState,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const real = generateLeague(5, 6); // stand-ins for the 6 real Italian clubs
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: real, managedClubId: real[2].id, seed: 42, now: NOW });

function playSeason(state: CareerState) {
  let s = state;
  for (let r = nextRound(s); r !== undefined; r = nextRound(s)) s = simulateRound(s, r, NOW);
  return s;
}

describe('schedule', () => {
  it.each([8, 12, 13])('every club plays every other club home and away once (%i clubs)', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    const fixtures = makeSchedule(ids, 7);
    const rounds = Math.max(...fixtures.map((f) => f.round));
    expect(rounds).toBe(n % 2 ? 2 * n : 2 * (n - 1));
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      expect(fixtures.filter((f) => f.homeId === a && f.awayId === b)).toHaveLength(1);
    }
    for (let r = 1; r <= rounds; r++) {
      const playing = fixtures.filter((f) => f.round === r).flatMap((f) => [f.homeId, f.awayId]);
      expect(new Set(playing).size).toBe(playing.length); // nobody plays twice in a round
      expect(playing.length).toBe(n % 2 ? n - 1 : n);
    }
  });

  it.each([8, 12, 13])('never has more than three home or away matches in a row (%i clubs)', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    for (let seed = 1; seed < 10; seed++) {
      const fixtures = makeSchedule(ids, seed);
      for (const id of ids) {
        const seq = fixtures.filter((f) => f.homeId === id || f.awayId === id).sort((a, b) => a.round - b.round).map((f) => f.homeId === id);
        let run = 1;
        for (let i = 1; i < seq.length; i++) {
          run = seq[i] === seq[i - 1] ? run + 1 : 1;
          expect(run).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('spreads home games and skips the winter break', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const fixtures = makeSchedule(ids, 3);
    for (const id of ids) expect(fixtures.filter((f) => f.homeId === id)).toHaveLength(11);
    for (const f of fixtures) expect(f.date.slice(5) >= '12-20' || f.date.slice(5) <= '01-03').toBe(false);
    const dates = [...new Set(fixtures.map((f) => f.date))];
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('career', () => {
  it('fills the league with generated clubs and keeps the real ones', () => {
    const c = start();
    expect(c.teams).toHaveLength(12);
    expect(c.generated).toHaveLength(6);
    for (const t of real) expect(c.teams.some((x) => x.id === t.id)).toBe(true);
    expect(c.fixtures).toHaveLength(12 * 11);
    expect(totalRounds(c)).toBe(22);
  });

  it('rejects a club that is not in the league', () => {
    expect(() => createCareer({ league: ita, realTeams: real, managedClubId: 'nope', seed: 1 })).toThrow();
  });

  it('records a live result for the managed club and simulates the rest of the round', () => {
    let c = start();
    const round = nextRound(c)!;
    const mine = managedFixture(c, round)!;
    const result = simulateMatch(teamFor(c, mine.homeId), teamFor(c, mine.awayId), { seed: 99, shootoutOnDraw: false });
    c = recordResult(c, mine.id, result, 'live', NOW);
    c = simulateRound(c, round, NOW);
    const roundFixtures = c.fixtures.filter((f) => f.round === round);
    expect(roundFixtures.every((f) => f.result)).toBe(true);
    expect(c.fixtures.find((f) => f.id === mine.id)!.result!.played).toBe('live');
    expect(nextRound(c)).toBe(round + 1);
    expect(() => recordResult(c, mine.id, result, 'live', NOW)).toThrow(/already/);
  });

  it('never mutates the state it is given', () => {
    const c = start();
    const before = structuredClone(c);
    simulateRound(c, 1, NOW);
    expect(c).toEqual(before);
  });

  it('plays a deterministic season with a consistent table and statistics', () => {
    const a = playSeason(start());
    const b = playSeason(start());
    expect(a).toEqual(b);
    expect(seasonFinished(a)).toBe(true);

    const table = leagueTable(a);
    expect(table).toHaveLength(12);
    const totalPoints = table.reduce((s, r) => s + r.points, 0);
    const draws = a.fixtures.filter((f) => f.result!.score[0] === f.result!.score[1]).length;
    expect(totalPoints).toBe(3 * (a.fixtures.length - draws) + 2 * draws);
    for (const r of table) {
      expect(r.played).toBe(22);
      expect(r.won + r.drawn + r.lost).toBe(22);
    }
    for (let i = 1; i < table.length; i++) expect(table[i - 1].points).toBeGreaterThanOrEqual(table[i].points);

    const goals = a.fixtures.reduce((s, f) => s + f.result!.score[0] + f.result!.score[1], 0);
    const statGoals = Object.values(a.playerStats).reduce((s, p) => s + p.goals, 0);
    expect(statGoals).toBe(goals);
    expect(topScorers(a, 5)).toHaveLength(5);
  });

  it('uses the manager tactics and a stable seed per match', () => {
    const c = { ...start(), tactics: { ...start().tactics, defense: 'zone' as const } };
    expect(teamFor(c, c.managedClubId).tactics.defense).toBe('zone');
    const f = c.fixtures[0];
    expect(fixtureSeed(c, f)).toBe(fixtureSeed(c, f));
    expect(simulateFixture(c, f)).toEqual(simulateFixture(c, f));
  });

  it('a season can be saved as JSON and loaded back', () => {
    const c = simulateRound(start(), 1, NOW);
    const loaded = JSON.parse(JSON.stringify(c)) as CareerState;
    expect(loaded).toEqual(c);
    expect(simulateRound(loaded, 2, NOW)).toEqual(simulateRound(c, 2, NOW));
  });
});
