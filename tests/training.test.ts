import { describe, expect, it } from 'vitest';
import { generateLeague } from '../engine';
import { createCareer, LEAGUES, nextRound, personalityOf, setIndividualFocus, setTraining, simulateRound, type CareerState, type Personality } from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't3', seed: 42, now: NOW });
const myTeam = (c: CareerState) => c.teams.find((t) => t.id === c.managedClubId)!;
const rounds = (c: CareerState, n: number) => {
  for (let i = 0; i < n && nextRound(c); i++) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('personalities', () => {
  it('are fixed per player and spread across all types', () => {
    expect(personalityOf(1, 'abc')).toBe(personalityOf(1, 'abc'));
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) counts[personalityOf(7, `p${i}`)] = (counts[personalityOf(7, `p${i}`)] ?? 0) + 1;
    for (const type of ['professional', 'ambitious', 'steady', 'lazy', 'temperamental']) expect(counts[type]).toBeGreaterThan(150);
  });
});

describe('weekly training report', () => {
  const c = rounds(start(), 10);

  it('rates every fit player of the managed club each week, 1 to 10', () => {
    const report = c.trainingReport!;
    expect(report.round).toBe(10);
    const ids = myTeam(c).players.map((p) => p.id);
    expect(report.entries.map((e) => e.playerId).sort()).toEqual([...ids].sort());
    for (const e of report.entries) {
      if (e.tone === 'injured' || e.tone === 'rest') expect(e.rating).toBeUndefined();
      else expect(e.rating! >= 1 && e.rating! <= 10).toBe(true);
      expect(e.note.length).toBeGreaterThan(5);
    }
    for (const r of Object.values(c.trainingRatings)) expect(r.length).toBeLessThanOrEqual(8);
  });

  it('professionals train better than laid-back players on average', () => {
    const all = rounds(start(), 22);
    const byType: Record<string, number[]> = {};
    for (const [id, rs] of Object.entries(all.trainingRatings)) (byType[personalityOf(all.seed, id)] ??= []).push(...rs);
    const avg = (t: Personality) => (byType[t] ?? []).reduce((s, x) => s + x, 0) / Math.max(1, byType[t]?.length ?? 0);
    if (byType.professional?.length && byType.lazy?.length) expect(avg('professional')).toBeGreaterThan(avg('lazy') + 0.8);
  });
});

describe('individual focus', () => {
  it('a player on a personal focus trains it while the squad follows the team plan', () => {
    let c = setTraining(start(), { focus: 'swimming', intensity: 'hard' });
    const shooter = myTeam(c).players.find((p) => p.position !== 'GK' && p.age <= 23) ?? myTeam(c).players.find((p) => p.position !== 'GK')!;
    c = setIndividualFocus(c, shooter.id, 'shooting');
    const after = rounds(c, 22);
    const p0 = myTeam(c).players.find((p) => p.id === shooter.id)!;
    const p1 = myTeam(after).players.find((p) => p.id === shooter.id)!;
    expect(p1.attrs.shootingPower + p1.attrs.shootingAccuracy).toBeGreaterThan(p0.attrs.shootingPower + p0.attrs.shootingAccuracy);
    expect(p1.attrs.speed).toBe(p0.attrs.speed);
    expect(after.trainingReport!.entries.find((e) => e.playerId === shooter.id)!.focus).toBe('Shooting');
  });

  it('resting a player recovers fitness and skips the rating', () => {
    let c = rounds(start(), 2);
    const tired = [...myTeam(c).players].sort((a, b) => c.squad[a.id].condition - c.squad[b.id].condition)[0];
    const rest = simulateRound(setIndividualFocus(c, tired.id, 'rest'), nextRound(c)!, NOW);
    const work = simulateRound(c, nextRound(c)!, NOW);
    expect(rest.trainingReport!.entries.find((e) => e.playerId === tired.id)!.tone).toBe('rest');
    const restEntry = rest.squad[tired.id];
    if (!restEntry.injury && !work.squad[tired.id].injury) expect(restEntry.condition).toBeGreaterThanOrEqual(work.squad[tired.id].condition);
  });

  it('setting the team plan clears the personal focus', () => {
    const c = setIndividualFocus(setIndividualFocus(start(), 'x', 'shooting'), 'x', 'team');
    expect(c.individual.x).toBeUndefined();
  });
});
