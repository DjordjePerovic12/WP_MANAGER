import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { competitionGames, normalizeHvs, type HvsCompetition, type HvsRaw } from '../data/sources/hvs';

// Trimmed real captures from hvs.hr: the 2026-27 league with one finished match (Jug AO 18:8 POŠK, 19 Sep 2026)
// and one game still to play, that match's data, and three player profiles.
const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/hvs', name), 'utf8'));

function raw(): HvsRaw {
  const current: HvsCompetition = fixture('competition-522.json');
  // The previous season, with one play-off game whose match page was never loaded.
  const previous: HvsCompetition = {
    id: '469', season: '2025/26', name: 'Prvenstvo Hrvatske seniori', category: 'Seniori', history: [],
    phases: { '1806': { name: 'Završnica', order: '6' } },
    phaseData: {
      '1806': {
        '1806': { type: 'KNOCK_OUT', name: 'Završnica' },
        '21566': {
          type: 'KNOCK_OUT', name: 'Finale', order: '1',
          games: {
            '21567': {
              '28': { name: 'HAVK Mladost', club_id: '28', score: '19' }, '29': { name: 'Jadran ST', club_id: '36', score: '14' },
              name: '1. utakmica', time: '2026-06-12 18:30:00', active: '1', order: '0', period: '4/4', status: 'Završeno',
            },
          },
        },
      },
    },
  };
  return { fetchedAt: '2026-10-22T06:00:00.000Z', current, previous, matches: { '22233': fixture('match-22233.json') }, persons: fixture('persons.json') };
}

describe('hvs.hr normalize', () => {
  const data = normalizeHvs(raw());

  it('reads games from league rounds and play-off ties', () => {
    const games = competitionGames(raw().current);
    expect(games.map((g) => [g.id, g.round, g.status])).toEqual([['22233', '1.kolo', 'Završeno'], ['22252', '5.kolo', 'U pripremi']]);
  });

  it('builds competitions, clubs and matches', () => {
    expect(data.season).toBe('2026-27');
    expect(data.competitions).toEqual([
      { id: 'HVS-522', name: 'Prvenstvo Hrvatske seniori 2026/27', tier: 3 },
      { id: 'HVS-469', name: 'Prvenstvo Hrvatske seniori 2025/26', tier: 3 },
    ]);
    const jug = data.clubs.find((c) => c.id === 'HVS-38')!;
    expect(jug).toMatchObject({ name: 'VK Jug Adriatic osiguranje', country: 'CRO', competitions: ['HVS-522'] });
    expect(data.clubs.find((c) => c.id === 'HVS-36')?.competitions).toEqual(['HVS-522', 'HVS-469']); // plays in both seasons

    // Only finished games become matches; the play-off game has no stats cached.
    expect(data.matches).toHaveLength(2);
    const m = data.matches.find((x) => x.id === 'HVS-M22233')!;
    expect(m).toMatchObject({ competitionId: 'HVS-522', round: '1.kolo', date: '2026-09-19', homeId: 'HVS-38', awayId: 'HVS-47', score: [18, 8] });
    expect(m.periods).toEqual([[4, 1], [6, 2], [2, 3], [6, 2]]);
    expect(data.matches.find((x) => x.id === 'HVS-M21567')).toMatchObject({ round: 'Finale, 1. utakmica', homeId: 'HVS-28', score: [19, 14], periods: [] });
  });

  it('builds player, goalkeeper and team lines that add up to the score', () => {
    const lines = data.playerLines.filter((l) => l.matchId === 'HVS-M22233');
    const goals = (club: string) => lines.filter((l) => l.clubId === club).reduce((s, l) => s + l.shots.total[0], 0);
    expect([goals('HVS-38'), goals('HVS-47')]).toEqual([18, 8]);

    const jokovic = lines.find((l) => l.playerId === 'HVS-P3842')!;
    expect(jokovic).toMatchObject({ cap: 5, turnovers: 3, assists: 0, sprints: [0, 0], penaltyFouls: 0 });
    expect(jokovic.shots).toMatchObject({ total: [1, 2], action: [1, 2], sixMeter: [0, 0] });

    expect(data.goalkeeperLines.find((g) => g.playerId === 'HVS-P3765')).toEqual({ matchId: 'HVS-M22233', playerId: 'HVS-P3765', clubId: 'HVS-47', saves: 12, shotsFaced: 30 });
    const team = data.teamLines.find((t) => t.clubId === 'HVS-47')!;
    expect(team).toMatchObject({ opponentId: 'HVS-38', goals: 8, saves: 12 });
    expect(team.shots.total[1]).toBe(lines.filter((l) => l.clubId === 'HVS-47').reduce((s, l) => s + l.shots.total[1], 0));
  });

  it('builds players from lineups and profiles', () => {
    const tatrai = data.players.find((p) => p.id === 'HVS-P59126')!;
    expect(tatrai).toMatchObject({ firstName: 'David', lastName: 'Tatrai', birthDate: '2003-08-15', nationality: 'HUN', clubId: 'HVS-38', cap: 2 });
    expect(tatrai.heightCm).toBeUndefined();
    expect(tatrai.hand).toBeUndefined();
    // Goalkeepers come from the goalkeeper stats, even when listed as a reserve.
    expect(data.players.find((p) => p.id === 'HVS-P3457')).toMatchObject({ lastName: 'Jurišić', position: 'GK', positionSource: 'official' });
    // Players without a loaded profile get their name from the lineup.
    const noProfile = data.players.find((p) => p.id === 'HVS-P3842')!;
    expect(noProfile).toMatchObject({ firstName: 'Maro', lastName: 'Joković', birthDate: undefined });
    expect(noProfile.positionSource).not.toBe('official');
  });
});
