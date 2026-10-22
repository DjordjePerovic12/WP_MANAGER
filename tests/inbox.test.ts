import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import {
  answerMessage,
  captainOf,
  createCareer,
  happinessOf,
  LEAGUES,
  leadersOf,
  nextMatchday,
  openPromises,
  setCaptain,
  setSelection,
  simulateMatchday,
  trustOf,
  type CareerState,
} from '../game';

const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: LEAGUES.find((l) => l.id === 'ita')!, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 21, now: NOW });
const play = (c: CareerState, n: number, until?: (s: CareerState) => boolean) => {
  for (let i = 0; i < n && nextMatchday(c) !== undefined; i++) {
    c = simulateMatchday(c, nextMatchday(c)!, NOW);
    if (until?.(c)) break;
  }
  return c;
};

describe('inbox', () => {
  const c = start();
  const club = c.teams.find((t) => t.id === c.managedClubId)!;
  const star = [...club.players].filter((p) => p.position !== 'GK').sort((a, b) => overall(b) - overall(a))[0];
  const others = club.players.filter((p) => p.id !== star.id);
  const without = (s: CareerState, id: string) =>
    setSelection(s, {
      matchday: [...others.filter((p) => p.position === 'GK').slice(0, 2), ...others.filter((p) => p.position !== 'GK' && p.id !== id).slice(0, 11)].map((p) => p.id),
      starters: [],
    });
  const benched = play(without(c, star.id), 20, (s) => (s.inbox ?? []).some((m) => m.kind === 'playing-time' && m.playerId === star.id));
  const talk = benched.inbox!.find((m) => m.kind === 'playing-time' && m.playerId === star.id)!;

  it('starts with the board setting out the season', () => {
    expect(c.inbox!.some((m) => m.kind === 'board' && /Expectations/.test(m.subject))).toBe(true);
  });

  it('brings a benched player to the manager about playing time', () => {
    expect(talk).toBeDefined();
    expect(talk.options!.map((o) => o.id)).toContain('promise-minutes');
  });

  it('keeps a promise of minutes when he plays', () => {
    const promised = answerMessage(benched, talk.id, 'promise-minutes').state;
    expect(openPromises(promised, star.id)).toHaveLength(1);
    // Now he plays every game.
    const played = play(setSelection(promised, undefined as never), 8, (s) => openPromises(s, star.id).length === 0);
    const pr = played.promises!.find((x) => x.playerId === star.id)!;
    expect(pr.status).toBe('kept');
    expect(trustOf(played, star.id)).toBeGreaterThan(60);
  });

  it('breaks a promise of minutes when he stays on the bench', () => {
    const promised = answerMessage(benched, talk.id, 'promise-minutes').state;
    const after = play(promised, 14, (s) => openPromises(s, star.id).length === 0);
    const pr = after.promises!.find((x) => x.playerId === star.id)!;
    expect(pr.status).toBe('broken');
    expect(trustOf(after, star.id)).toBeLessThan(60);
    expect(after.inbox!.some((m) => m.kind === 'promise' && m.subject === 'Promise broken')).toBe(true);
  });

  it('costs some happiness to ignore a player', () => {
    const before = happinessOf(benched, star.id);
    const after = play(benched, 4);
    const m = after.inbox!.find((x) => x.id === talk.id)!;
    expect(m.answer).toBe('ignored');
    expect(happinessOf(after, star.id)).toBeLessThan(before + 5);
  });

  it('names a captain and leaders', () => {
    const captain = captainOf(c)!;
    expect(leadersOf(c)[0]).toBe(captain);
    const other = club.players.find((p) => p.id !== captain && p.position !== 'GK')!;
    const out = setCaptain(c, other.id).state;
    expect(captainOf(out)).toBe(other.id);
    expect(happinessOf(out, other.id)).toBeGreaterThan(happinessOf(c, other.id));
    expect(happinessOf(out, captain)).toBeLessThan(happinessOf(c, captain));
  });
});
