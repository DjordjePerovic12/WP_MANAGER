import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardUrl, normalizeAsaMalta, parseMatchCard, splitName, type AsaEvent, type AsaRaw } from '../data/sources/asamalta';

// Real asaofmalta.eu data: two match cards (pdftotext -layout output) and trimmed SportsPress events.
const FIXTURES = join(import.meta.dirname, 'fixtures', 'asamalta');
const read = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');
const events = JSON.parse(read('events.json')) as AsaEvent[];

const raw: AsaRaw = {
  events,
  teams: [
    { id: 851, slug: 'sliema', title: { rendered: 'Sliema Nexawin' }, abbreviation: 'SLM' },
    { id: 813, slug: 'neptunes', title: { rendered: 'Neptunes Best Gyms Malta' }, abbreviation: 'NEP' },
    { id: 850, slug: 'san-giljan', title: { rendered: 'San Giljan MAA Daikin' }, abbreviation: 'SGN' },
    { id: 853, slug: 'valletta-united', title: { rendered: 'Valletta Peak Insurance Brokers' }, abbreviation: 'VLT' },
  ],
  venues: [{ id: 36, name: 'Tal-Qroqq' }],
  cards: { 341222: read('card-341222.txt'), 341436: read('card-341436.txt') },
};

describe('ASA Malta match cards', () => {
  it('reads both teams, players, goals, exclusions and quarter scores', () => {
    const card = parseMatchCard(raw.cards[341222]);
    expect(card.teams.map((t) => [t.name, t.score, t.players.length])).toEqual([['SLIEMA NEXAWIN', 14, 15], ['NEPTUNES BGM', 18, 15]]);
    for (const t of card.teams) expect(t.players.reduce((s, p) => s + p.goals, 0)).toBe(t.score);
    expect(card.periods).toEqual([[4, 5], [4, 5], [4, 4], [2, 4]]);
    expect(card.teams[0].players.find((p) => p.cap === 12)).toEqual({ cap: 12, name: 'Dino ZAMMIT', captain: true, goals: 3, exclusions: 2 });
    // Fouled out: three exclusions.
    expect(card.teams[1].players.find((p) => p.cap === 6)).toMatchObject({ name: 'Julian VALLETTA', exclusions: 3 });
    // The play-by-play has only goals, fouls and timeouts.
    expect(card.events).toMatchObject({ goals: 32, other: [] });
  });

  it('reads the older card layout (glued names and times, indented rows)', () => {
    const text = [
      'NEPTUNES BGM                         Final Score         TimeOut           Cap',
      '                                       9                 2                 W',
      'Name                 #    Goals    TimeExclusion1    TimeExclusion2   TimeExclusion3',
      'StevieCAMILLERI(C)   7      2         Q1 06:42           Q206:06            -          5:05   -   3      Goal        1-3',
      '        Gulio MASSA          10         3                 -               -                -          03:22         8',
    ].join('\n');
    expect(parseMatchCard(text).teams[0]).toMatchObject({
      name: 'NEPTUNES BGM', score: 9,
      players: [{ cap: 7, name: 'Stevie CAMILLERI', captain: true, goals: 2, exclusions: 2 }, { cap: 10, name: 'Gulio MASSA', goals: 3, exclusions: 0 }],
    });
  });

  it('finds the match-card link and splits names', () => {
    expect(cardUrl(events.find((e) => e.id === 341222)!)).toBe('https://asaofmalta.eu/wp-content/uploads/2026/07/SLIEMA-NEXAWIN_NEPTUNES-BGM_2026-07-22_21-52-57.pdf');
    expect(splitName('Francesco DI FULVIO')).toEqual({ firstName: 'Francesco', lastName: 'Di Fulvio' });
    expect(splitName('M BONELLO DUPUIS')).toEqual({ firstName: 'M', lastName: 'Bonello Dupuis' });
    expect(splitName('Jerko MARINIC-KRAGIC')).toEqual({ firstName: 'Jerko', lastName: 'Marinic-Kragic' });
  });
});

describe('ASA Malta normalization', () => {
  const data = normalizeAsaMalta(raw);

  it('builds matches, clubs and competitions', () => {
    expect(data.matches).toHaveLength(3);
    const m = data.matches.find((x) => x.id === 'MLT-M341222')!;
    expect(m).toMatchObject({ competitionId: 'MLT-SLP', round: 'MD11 R2 G3', date: '2026-07-22', venue: 'Tal-Qroqq', homeId: 'MLT-SLM', awayId: 'MLT-NEP', score: [14, 18] });
    expect(m.periods).toHaveLength(4);
    // No round in the JSON: the card's title is used.
    expect(data.matches.find((x) => x.id === 'MLT-M341436')!.round).toBe('BOV KNOCK OUT FINAL 2026 - Premier Division');
    // A match without a card keeps its score but has no periods or lines.
    expect(data.matches.find((x) => x.id === 'MLT-M341221')).toMatchObject({ score: [10, 29], periods: [] });
    expect(data.playerLines.some((l) => l.matchId === 'MLT-M341221')).toBe(false);
    expect(data.competitions.map((c) => [c.id, c.tier]).sort()).toEqual([['MLT-KOP', 5], ['MLT-SLP', 5]]);
    expect(data.clubs.find((c) => c.id === 'MLT-VLT')).toMatchObject({ name: 'Valletta United', shortName: 'VLT', country: 'MLT' });
    expect(data.clubs.find((c) => c.id === 'MLT-SGN')!.name).toBe('San Giljan');
  });

  it('identifies players by name across matches', () => {
    const p = data.players.find((x) => x.id === 'MLT-P-stevie-camilleri')!;
    expect(p).toMatchObject({ firstName: 'Stevie', lastName: 'Camilleri', clubId: 'MLT-NEP', cap: 7, position: 'DRIVER', positionSource: 'default' });
    expect(p.birthDate).toBeUndefined();
    expect(data.playerLines.filter((l) => l.playerId === p.id)).toHaveLength(2);
    // Cap 1 is a goalkeeper.
    expect(data.players.find((x) => x.id === 'MLT-P-matthew-castillo')).toMatchObject({ position: 'GK', positionSource: 'inferred' });
    expect(new Set(data.players.map((x) => x.id)).size).toBe(data.players.length);
  });

  it('writes goals, exclusions and team totals', () => {
    const line = data.playerLines.find((l) => l.matchId === 'MLT-M341222' && l.playerId === 'MLT-P-dino-zammit')!;
    expect(line).toMatchObject({ clubId: 'MLT-SLM', cap: 12, exclusionsField: 2, exclusionsCenter: 0, fouledOut: false, sprints: [0, 0] });
    expect(line.shots.total).toEqual([3, 3]);
    const team = data.teamLines.find((t) => t.matchId === 'MLT-M341222' && t.clubId === 'MLT-NEP')!;
    expect(team).toMatchObject({ goals: 18, opponentId: 'MLT-SLM' });
    expect(data.goalkeeperLines).toEqual([]);
  });
});
