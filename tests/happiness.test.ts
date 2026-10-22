import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import {
  contractDemand,
  createCareer,
  happinessOf,
  LEAGUES,
  matchSetup,
  managedFixture,
  moodFactors,
  moodOf,
  nextMatchday,
  rejectTransferRequest,
  setSelection,
  setSquadStatus,
  simulateMatchday,
  statusOf,
  type CareerState,
} from '../game';

const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: LEAGUES.find((l) => l.id === 'ita')!, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 21, now: NOW });
const play = (c: CareerState, n: number) => {
  for (let i = 0; i < n && nextMatchday(c) !== undefined; i++) c = simulateMatchday(c, nextMatchday(c)!, NOW);
  return c;
};

describe('player happiness', () => {
  const c = start();
  const club = c.teams.find((t) => t.id === c.managedClubId)!;
  const star = [...club.players].filter((p) => p.position !== 'GK').sort((a, b) => overall(b) - overall(a))[0];

  it('gives the best players key roles and everyone a starting mood', () => {
    expect(statusOf(c, star.id)).toBe('key');
    expect(happinessOf(c, star.id)).toBe(65);
  });

  it('makes a benched key player unhappy, until he asks to leave', () => {
    // Leave him out of every matchday squad.
    const others = club.players.filter((p) => p.id !== star.id);
    const keepers = others.filter((p) => p.position === 'GK').slice(0, 2);
    const field = others.filter((p) => p.position !== 'GK').sort((a, b) => overall(b) - overall(a)).slice(0, 11);
    let s = setSelection(c, { matchday: [...keepers, ...field].map((p) => p.id), starters: [] });
    s = play(s, 22);
    expect(happinessOf(s, star.id)).toBeLessThan(35);
    expect(moodFactors(s, star).some((f) => /playing time/.test(f.text) && f.points < 0)).toBe(true);
    expect(s.transferRequests).toContain(star.id);
    expect(s.transferList).toContain(star.id);
    expect(contractDemand(s, star.id).mood).toBe('reluctant');
    const refused = rejectTransferRequest(s, star.id).state;
    expect(refused.transferRequests).not.toContain(star.id);
    expect(refused.transferList).not.toContain(star.id);
  });

  it('keeps regular starters content', () => {
    const s = play(c, 10);
    expect(moodOf(happinessOf(s, star.id))).not.toMatch(/unhappy|wants-out/);
  });

  it('reacts to a change of role', () => {
    const backup = [...club.players].sort((a, b) => overall(a) - overall(b)).find((p) => p.position !== 'GK')!;
    const up = setSquadStatus(c, backup.id, 'regular');
    expect(happinessOf(up.state, backup.id)).toBeGreaterThan(happinessOf(c, backup.id));
    const down = setSquadStatus(c, star.id, 'backup');
    expect(happinessOf(down.state, star.id)).toBeLessThan(happinessOf(c, star.id));
  });

  it('lets a miserable player play below himself', () => {
    const md = nextMatchday(c)!;
    const f = managedFixture(c, md) ?? c.fixtures.find((x) => x.matchday === md && (x.homeId === c.managedClubId || x.awayId === c.managedClubId))!;
    const sad = { ...c, happiness: Object.fromEntries(club.players.map((p) => [p.id, 10])) };
    const side = f.homeId === c.managedClubId ? 'home' : 'away';
    const normal = matchSetup(c, f)[side].players.find((p) => p.id === star.id)!;
    const miserable = matchSetup(sad, f)[side].players.find((p) => p.id === star.id)!;
    expect(miserable.attrs.passing).toBe(Math.max(1, normal.attrs.passing - 1));
  });
});
