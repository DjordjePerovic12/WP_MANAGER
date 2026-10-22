import { describe, expect, it } from 'vitest';
import { clubKey, mergeDataSets } from '../data/merge';
import type { DataSet, PlayerMatchLine, RealPlayer } from '../data/model';

const empty = (source: string): DataSet => ({ source, season: '2026-27', fetchedAt: '2026-10-21', competitions: [], clubs: [], players: [], matches: [], playerLines: [], goalkeeperLines: [], teamLines: [] });
const player = (id: string, clubId: string, first: string, last: string, extra: Partial<RealPlayer> = {}): RealPlayer => ({ id, clubId, firstName: first, lastName: last, position: 'DRIVER', positionSource: 'default', ...extra });
const line = (matchId: string, playerId: string, clubId: string, goals: number): PlayerMatchLine => {
  const z: [number, number] = [0, 0];
  return { matchId, playerId, clubId, cap: 5, shots: { action: z, center: z, extra: z, sixMeter: z, penalty: z, counter: z, total: [goals, goals + 2] }, assists: 0, turnovers: 0, steals: 0, blocks: 0, sprints: z, exclusionsCenter: 0, exclusionsField: 0, penaltyFouls: 0, fouledOut: false };
};

describe('merging data sources', () => {
  const ea: DataSet = {
    ...empty('EA'),
    competitions: [{ id: 'EA-1', name: 'Champions League', tier: 1 }],
    clubs: [{ id: 'EA-JSP', name: 'Jadran Split', shortName: 'JADRAN SPLIT', country: 'CRO', competitions: ['EA-1'] }],
    players: [player('EA-P1', 'EA-JSP', 'Luka', 'Lončar', { birthDate: '1987-06-26', heightCm: 197 })],
  };
  const hvs: DataSet = {
    ...empty('HVS'),
    competitions: [{ id: 'HVS-L', name: 'Croatian League', tier: 3 }],
    clubs: [
      { id: 'HVS-7', name: 'VK Jadran Split', shortName: 'Jadran', country: 'CRO', competitions: ['HVS-L'] },
      { id: 'HVS-9', name: 'HAVK Mornar', shortName: 'Mornar', country: 'CRO', competitions: ['HVS-L'] },
    ],
    players: [player('HVS-P1', 'HVS-7', 'Luka', 'Loncar', { birthDate: '1987-06-26', nationality: 'CRO' }), player('HVS-P2', 'HVS-9', 'Ivan', 'Horvat')],
    matches: [{ id: 'HVS-M1', competitionId: 'HVS-L', round: '1', date: '2026-10-03', venue: 'Split', homeId: 'HVS-7', awayId: 'HVS-9', score: [14, 9], periods: [] }],
    playerLines: [line('HVS-M1', 'HVS-P1', 'HVS-7', 3), line('HVS-M1', 'HVS-P2', 'HVS-9', 2)],
  };
  const merged = mergeDataSets(ea, hvs);

  it('matches clubs by name without prefixes and keeps the first source id', () => {
    expect(clubKey('VK Jadran Split')).toBe(clubKey('Jadran Split'));
    expect(merged.clubs.map((c) => c.id)).toEqual(['EA-JSP', 'HVS-9']);
    expect(merged.clubs[0].competitions).toEqual(['EA-1', 'HVS-L']);
    expect(merged.matches[0].homeId).toBe('EA-JSP');
  });

  it('matches players by surname and birth date, filling in missing details', () => {
    expect(merged.players).toHaveLength(2);
    const loncar = merged.players.find((p) => p.id === 'EA-P1')!;
    expect(loncar.nationality).toBe('CRO');
    expect(loncar.heightCm).toBe(197);
    expect(merged.playerLines.find((l) => l.matchId === 'HVS-M1' && l.shots.total[0] === 3)!.playerId).toBe('EA-P1');
  });

  it('adds clubs and players that only the second source knows', () => {
    expect(merged.players.find((p) => p.id === 'HVS-P2')!.clubId).toBe('HVS-9');
  });

  it('uses aliases for clubs whose names differ', () => {
    const renamed = { ...hvs, clubs: [{ ...hvs.clubs[0], name: 'Jadran Carpe Diem' }, hvs.clubs[1]] };
    expect(mergeDataSets(ea, renamed).clubs).toHaveLength(3);
    expect(mergeDataSets(ea, renamed, { clubAliases: { 'HVS-7': 'EA-JSP' } }).clubs).toHaveLength(2);
  });
});
