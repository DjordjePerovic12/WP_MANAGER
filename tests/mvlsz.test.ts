import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mapHand, mapPosition, normalizeMvlsz, periodsFromEvents, sanitizeGame, sanitizePlayer, type MvlRaw,
} from '../data/sources/mvlsz';

// A tiny, made-up data set in the sanitized cache format (no network).
const raw = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/mvlsz/raw.json'), 'utf8')) as MvlRaw;

describe('MVLSZ sanitizing', () => {
  it('keeps only the game fields of a player record', () => {
    const p = sanitizePlayer({
      id: 7, name: 'X Y', first_name: 'Yves', last_name: 'XAVÉR', birth_date: '1998-05-04T00:00:00+00:00', birth_place: 'Somewhere',
      dominant_hand: 'left', primary_club_id: 152, position_id: 4, image_url: 'https://x/y.jpg', registration_number: '12345',
      height_cm: 195, weight_kg: null, gender: 'male', primaryClub: { id: 152, name: 'FTC Kft.', short_name: 'N/A', bank_account_number: '1', contact_email: 'a@b.c' },
      position: { id: 4, name: 'center' }, medical_qualification_expiry_at: '2027-01-01', medical_qualification: 'valid',
      user: { id: 9, email: 'secret@example.com', city: 'Budapest', citizenship: ['HU'], birth_date: '1998-05-04' },
    });
    expect(p).toEqual({
      id: 7, firstName: 'Yves', lastName: 'XAVÉR', birthDate: '1998-05-04', heightCm: 195, hand: 'left', position: 'center',
      clubId: 152, clubName: 'FTC Kft.', nationality: 'HU',
    });
    expect(JSON.stringify(p)).not.toMatch(/secret|Somewhere|12345|medical|Budapest/);
  });

  it('derives period scores from goal events, and gives none when they do not add up', () => {
    const goal = (period: number, side: string) => ({ game_period_id: period, side, eventType: { code: 'goal' } });
    const events = [goal(1, 'home'), goal(2, 'away'), goal(4, 'away'), { game_period_id: 3, side: 'home', eventType: { code: 'other' } }];
    expect(periodsFromEvents(events, 1, 2)).toEqual([[1, 0], [0, 1], [0, 0], [0, 1]]);
    expect(periodsFromEvents(events, 2, 2)).toEqual([]);
    const g = sanitizeGame({
      id: 5, status: 'completed', start_date_time_in_location_time_zone: '2026-09-09T18:00:00+00:00', home_competition_team_id: 1,
      away_competition_team_id: 2, home_team_score: 1, away_team_score: 2, game_notes: 'Orvos: dr. Someone', gameEvents: events,
      competitionPhase: { name: 'Alapszakasz' }, competitionRound: { name: '1. forduló' }, facility: { name: 'Komjádi', city: 'Budapest', zip_code: '1023' },
      gamePlayers: [{ player_id: 3, competition_team_id: 1, jersey_number: 4, is_played: true }],
      playerGameStats: [{ player_id: 3, team_id: 11, is_played: true, goals: 1, shots: 2, player: { email: 'x@y.z' } }],
    });
    expect(g).toMatchObject({ date: '2026-09-09', round: 'Alapszakasz, 1. forduló', venue: 'Komjádi, Budapest', periods: [[1, 0], [0, 1], [0, 0], [0, 1]] });
    expect(g.stats[0]).toMatchObject({ playerId: 3, teamId: 11, goals: 1, shots: 2 });
    expect(JSON.stringify(g)).not.toMatch(/Orvos|x@y\.z|1023/);
  });
});

describe('MVLSZ normalizing', () => {
  const ds = normalizeMvlsz(raw);

  it('maps hands and the federation positions', () => {
    expect([mapHand('left'), mapHand('right'), mapHand('two_handed'), mapHand(undefined)]).toEqual(['L', 'R', undefined, undefined]);
    expect(['kapus', 'center', 'bekk', 'kapás szélső', 'rosszkéz szélső', 'kapás hátsó', 'rosszkéz hátsó', 'goalkeeper', 'centre forward', 'center back'].map(mapPosition))
      .toEqual(['GK', 'CENTER', 'CDEF', 'WING', 'WING', 'DRIVER', 'DRIVER', 'GK', 'CENTER', 'CDEF']);
    expect(mapPosition(undefined)).toBeUndefined();
  });

  it('builds competitions and clubs with MVL- ids, named as the newest season writes them', () => {
    expect(ds.season).toBe('2026-27');
    expect(ds.competitions).toEqual([
      { id: 'MVL-C2203', name: 'E.ON Férfi OB I. Bajnokság 2026-27', tier: 3 },
      { id: 'MVL-C878', name: 'E.ON Férfi OB I. Bajnokság 2025-26', tier: 3 },
    ]);
    expect(ds.clubs).toContainEqual({ id: 'MVL-152', name: 'FTC Telekom Waterpolo', shortName: 'FTC Telekom', country: 'HUN', competitions: ['MVL-C2203', 'MVL-C878'] });
    expect(ds.clubs.map((c) => c.id).sort()).toEqual(['MVL-152', 'MVL-280', 'MVL-3']);
  });

  it('normalizes players from the current rosters', () => {
    const byId = Object.fromEntries(ds.players.map((p) => [p.id, p]));
    expect(ds.players).toHaveLength(4);
    expect(byId['MVL-P1']).toEqual({
      id: 'MVL-P1', firstName: 'Teszt', lastName: 'Kapus', birthDate: '1995-03-01', nationality: 'HUN', clubId: 'MVL-152', cap: 1,
      hand: 'R', position: 'GK', positionSource: 'official',
    });
    expect(byId['MVL-P2']).toMatchObject({ lastName: 'Próba', hand: 'L', position: 'WING', nationality: 'SRB', cap: 7 });
    expect(byId['MVL-P3']).toMatchObject({ lastName: 'Példa-Nagy', position: 'CDEF', clubId: 'MVL-3', nationality: 'GRE' });
    expect(byId['MVL-P3'].hand).toBeUndefined();
    // No position → DRIVER by default; an implausible birth date is dropped.
    expect(byId['MVL-P4']).toMatchObject({ position: 'DRIVER', positionSource: 'default' });
    expect(byId['MVL-P4'].birthDate).toBeUndefined();
  });

  it('keeps finished matches only, with score, round, venue and periods', () => {
    expect(ds.matches.map((m) => m.id)).toEqual(['MVL-M9001', 'MVL-M8001']);
    expect(ds.matches[0]).toEqual({
      id: 'MVL-M9001', competitionId: 'MVL-C2203', round: 'Alapszakasz, 1. forduló', date: '2026-09-09', venue: 'Komjádi, Budapest',
      homeId: 'MVL-3', awayId: 'MVL-152', score: [3, 5], periods: [[1, 1], [1, 2], [0, 1], [1, 1]],
    });
    expect(ds.matches[1]).toMatchObject({ homeId: 'MVL-152', awayId: 'MVL-280', score: [14, 6], periods: [] });
  });

  it('builds player, goalkeeper and team lines from the per-game stats', () => {
    // Player 99 is not on a current roster: no line of their own, but counted in the team line.
    expect(ds.playerLines.map((l) => l.playerId)).toEqual(['MVL-P1', 'MVL-P2', 'MVL-P3']);
    const p2 = ds.playerLines[1];
    expect(p2).toMatchObject({
      matchId: 'MVL-M9001', clubId: 'MVL-152', cap: 7, assists: 2, turnovers: 1, blocks: 1, sprints: [0, 0],
      exclusionsCenter: 1, exclusionsField: 1, penaltyFouls: 1, fouledOut: false,
    });
    expect(p2.shots).toEqual({ action: [2, 4], center: [1, 1], extra: [1, 2], sixMeter: [0, 1], penalty: [1, 1], counter: [0, 0], total: [5, 9] });
    expect(ds.goalkeeperLines).toEqual([{ matchId: 'MVL-M9001', playerId: 'MVL-P1', clubId: 'MVL-152', saves: 8, shotsFaced: 11 }]);
    const vasas = ds.teamLines.find((t) => t.clubId === 'MVL-3')!;
    expect(vasas).toMatchObject({ opponentId: 'MVL-152', goals: 3, turnovers: 2, exclusionsCommitted: 2, penaltyFouls: 1, saves: 0 });
    expect(vasas.shots.total).toEqual([3, 8]);
    expect(ds.teamLines.find((t) => t.clubId === 'MVL-152')).toMatchObject({ goals: 5, saves: 8, steals: 1 });
  });
});
