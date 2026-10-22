import { describe, expect, it } from 'vitest';
import { generateLeague, matchRatings, simulateMatch } from '../engine';
import { averageRating, createCareer, LEAGUES, nextMatchday, simulateMatchday, type CareerState } from '../game';

describe('match ratings', () => {
  const [home, away] = generateLeague(8, 2);

  it('rates everyone who played, out of 10, around 6.5 on average', () => {
    const all: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulateMatch(home, away, { seed });
      const { ratings, manOfTheMatch } = matchRatings(r);
      for (const [id, v] of Object.entries(ratings)) {
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThanOrEqual(10);
        expect(r.secondsPlayed[id]).toBeGreaterThanOrEqual(120);
        all.push(v);
      }
      expect(manOfTheMatch).toBeDefined();
      expect(ratings[manOfTheMatch!]).toBe(Math.max(...Object.values(ratings)));
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeGreaterThan(6.2);
    expect(mean).toBeLessThan(7.2);
  });

  it('rewards scorers over players who did nothing', () => {
    const r = simulateMatch(home, away, { seed: 3 });
    const { ratings } = matchRatings(r);
    const goals = new Map<string, number>();
    for (const e of r.events) if (e.type === 'goal' && e.situation !== 'shootout') goals.set(e.player!, (goals.get(e.player!) ?? 0) + 1);
    const top = [...goals].sort((a, b) => b[1] - a[1])[0][0];
    const median = Object.values(ratings).sort((a, b) => a - b)[Math.floor(Object.keys(ratings).length / 2)];
    expect(ratings[top]).toBeGreaterThan(median);
  });

  it('keeps season averages and man of the match awards in the career', () => {
    let c: CareerState = createCareer({ league: LEAGUES.find((l) => l.id === 'ita')!, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 8, now: '2026-10-01T00:00:00.000Z' });
    for (let i = 0; i < 4; i++) c = simulateMatchday(c, nextMatchday(c)!, '2026-10-01T00:00:00.000Z');
    const rated = Object.values(c.playerStats).filter((s) => s.rated);
    expect(rated.length).toBeGreaterThan(50);
    for (const s of rated) expect(averageRating(s)).toBeGreaterThanOrEqual(3);
    expect(Object.values(c.playerStats).reduce((n, s) => n + (s.mom ?? 0), 0)).toBe(c.fixtures.filter((f) => f.result).length);
    const log = Object.values(c.matchLog).flat();
    expect(log.some((m) => m.rating !== undefined)).toBe(true);
  });
});
