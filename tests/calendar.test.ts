import { describe, expect, it } from 'vitest';
import { generateLeague } from '../engine';
import {
  createCareer,
  daysBetween,
  leagueTable,
  LEAGUES,
  managedFixture,
  migrateCareer,
  nextMatchday,
  numberMatchdays,
  scoutingLeft,
  scoutPlayer,
  simulateMatchday,
  trainingWeek,
  type CareerState,
  type Fixture,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 7, now: NOW });

/** A made-up midweek cup match for the managed club, three days after the first league matchday. */
function withMidweekMatch(c: CareerState): CareerState {
  const first = c.fixtures.find((f) => f.matchday === 1)!;
  const wednesday = new Date(`${first.date}T12:00:00Z`);
  wednesday.setUTCDate(wednesday.getUTCDate() + 4);
  const opponent = c.teams.find((t) => t.id !== c.managedClubId)!.id;
  const cup: Fixture = { id: 'CUP-1', competition: 'cup', stage: 'Cup, round 1', round: 1, matchday: 0, date: wednesday.toISOString().slice(0, 10), homeId: c.managedClubId, awayId: opponent };
  return { ...c, competitions: [...c.competitions, { id: 'cup', name: 'Cup', kind: 'cup' }], fixtures: numberMatchdays([...c.fixtures, cup]) };
}

describe('season calendar', () => {
  it('gives every fixture a competition, a stage and a dated matchday', () => {
    const c = start();
    expect(c.competitions.map((x) => x.kind)).toEqual(['league', 'playoff', 'cup']);
    for (const f of c.fixtures.filter((x) => x.competition === 'league')) {
      expect(f.competition).toBe('league');
      expect(f.stage).toBe(`Round ${f.round}`);
    }
    const days = [...new Set(c.fixtures.map((f) => `${f.matchday}|${f.date}`))].sort((a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]));
    days.forEach((d, i) => {
      expect(Number(d.split('|')[0])).toBe(i + 1);
      if (i) expect(d.split('|')[1] > days[i - 1].split('|')[1]).toBe(true);
    });
  });

  it('fits a midweek match between two league matchdays', () => {
    const c = withMidweekMatch(start());
    const cup = c.fixtures.find((f) => f.id === 'CUP-1')!;
    expect(cup.matchday).toBe(2);
    expect(c.fixtures.filter((f) => f.competition === 'league' && f.round === 2).every((f) => f.matchday === 3)).toBe(true);
    let s = simulateMatchday(c, 1, NOW);
    expect(nextMatchday(s)).toBe(2);
    expect(managedFixture(s, 2)!.id).toBe('CUP-1');
    s = simulateMatchday(s, 2, NOW);
    expect(s.fixtures.find((f) => f.id === 'CUP-1')!.result).toBeDefined();
    // Cup results do not count in the league table.
    expect(leagueTable(s).reduce((n, r) => n + r.played, 0)).toBe(s.fixtures.filter((f) => f.competition === 'league' && f.result).length * 2);
  });

  it('recovers less fitness and trains less with only a few days between matches', () => {
    const c = start();
    const tired = Object.fromEntries(Object.keys(c.squad).map((id) => [id, { condition: 40 }]));
    const week = (days: number) => trainingWeek({ round: 1, days, seed: c.seed, teams: c.teams, squad: tired, progress: {}, managedClubId: c.managedClubId, training: c.training });
    const avg = (r: ReturnType<typeof week>) => Object.values(r.squad).reduce((s, x) => s + x.condition, 0) / Object.keys(r.squad).length;
    expect(avg(week(3))).toBeLessThan(avg(week(7)) - 5);
    const progressOf = (r: ReturnType<typeof week>) => Object.values(r.progress).reduce((s, p) => s + Object.values(p).reduce((a, b) => a + (b ?? 0), 0), 0);
    expect(progressOf(week(3))).toBeLessThan(progressOf(week(7)));
  });

  it('counts scouting reports per calendar week, not per match', () => {
    let s = simulateMatchday(withMidweekMatch(start()), 1, NOW); // Saturday played; the cup match is on Wednesday
    const left = scoutingLeft(s);
    const target = s.teams.find((t) => t.id !== s.managedClubId)!.players[0].id;
    s = scoutPlayer(s, target).state;
    expect(scoutingLeft(s)).toBe(left - 1);
    // Play the Wednesday cup match: the next league match is that Saturday, the same Monday-to-Sunday week.
    s = simulateMatchday(s, 2, NOW);
    const cup = s.fixtures.find((f) => f.id === 'CUP-1')!;
    const nextLeague = s.fixtures.find((f) => f.matchday === 3)!;
    expect(Math.floor(daysBetween('2024-01-01', cup.date) / 7)).toBe(Math.floor(daysBetween('2024-01-01', nextLeague.date) / 7));
    expect(scoutingLeft(s)).toBe(left - 1); // no fresh reports mid-week
  });

  it('moves older saves onto the calendar without changing their season', () => {
    const c = start();
    const old = {
      ...c,
      version: 8,
      competitions: undefined,
      fixtures: c.fixtures.map(({ competition, stage, matchday, ...f }) => f),
    } as unknown as CareerState;
    const migrated = migrateCareer(old);
    expect(migrated.competitions[0].id).toBe('league');
    for (const f of migrated.fixtures) expect(f.matchday).toBe(f.round);
    expect(leagueTable(simulateMatchday(migrated, 1, NOW)).some((r) => r.played === 1)).toBe(true);
  });
});
