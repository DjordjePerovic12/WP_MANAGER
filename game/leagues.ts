// League definitions for career mode.
//
// Our real data covers the clubs that play in the European cups, so most leagues
// are topped up with clubs that have real names but generated (fictional) players,
// until a scraper brings in their real rosters.
//
// Formats follow the real 2026-27 competitions (see docs/research/domestic-leagues.md),
// simplified where the real rules are unusual: every league is a double round robin
// with no draws (3 points for a win, 2 for a shootout win, 1 for a shootout loss), then
// playoffs for the title, plus a domestic cup.

import type { Rng } from '../engine/rng';
import { generateTeam } from '../engine/generate';
import { overall } from '../engine/ratings';
import type { Team } from '../engine/types';

export interface PlayoffFormat {
  /** clubs that qualify from the regular season (a power of 2) */
  teams: number;
  /** games per series in each round, first round to final: 1 = single game, 3 = best of 3, 5 = best of 5 */
  bestOf: number[];
  /** the last four play semi-finals and a final on one weekend at one venue */
  finalFour?: boolean;
}

export interface CupFormat {
  name: string;
  /** winter (default): rounds on Wednesdays from October, Final Four in the winter break; afterLeague: a short knock-out between the league and the playoffs (Malta) */
  timing?: 'winter' | 'afterLeague';
}

/**
 * A country's own competitions inside a multi-country league: a national championship played as
 * playoffs after the league (seeded by league position) and a national cup.
 */
export interface NationalFormat {
  country: string;
  /** e.g. "Serbian Championship" */
  name: string;
  playoffs?: PlayoffFormat;
  cup?: CupFormat;
}

/** A league that doesn't follow the usual October–May season (Malta plays in summer). */
export interface LeagueCalendar {
  /** first matchday, MM-DD, in the season's second year (2026-27 → 2027) */
  start: string;
  /** days between rounds */
  gapDays: number;
}

export interface LeagueDef {
  id: string;
  name: string;
  /** IOC country codes of the real clubs that play in it */
  countries: string[];
  /** only these clubs (when a country has several divisions in our data) */
  clubIds?: string[];
  /** number of teams; generated clubs fill the gaps */
  size: number;
  /** real club names (and short codes) used for clubs we have no roster for yet; their players are generated */
  fillerNames: [string, string][];
  /** squad rating of generated clubs (the same scale as real clubs' team rating): [weakest, strongest] */
  fillerQuality: [number, number];
  playoffs: PlayoffFormat;
  /** a cup for every club in the league (leagues spanning two countries have national cups instead) */
  cup?: CupFormat;
  /** per-country competitions in a league spanning several countries (the VRL: Serbia and Montenegro) */
  national?: NationalFormat[];
  calendar?: LeagueCalendar;
  /** kept only so older saves still load; not offered for new careers */
  legacy?: boolean;
}

export const LEAGUES: LeagueDef[] = [
  {
    id: 'vrl',
    name: 'VRL Premier League',
    countries: ['SRB', 'MNE'],
    size: 12,
    fillerNames: [['VK Vojvodina', 'VOJ'], ['VK Zemun', 'ZEM'], ['VK Nais', 'NAI'], ['VK Valis', 'VAL']],
    // Generated clubs are lower-table sides in reality; keep them below the clubs we have real data for.
    fillerQuality: [10, 11.5],
    // The VRL Final Four crowns the regional champion; then each country plays its own
    // championship (seeded by VRL position), and each has its own cup.
    playoffs: { teams: 4, bestOf: [1, 1], finalFour: true },
    national: [
      { country: 'SRB', name: 'Serbian Championship', playoffs: { teams: 8, bestOf: [1, 3, 5] }, cup: { name: 'Serbian Cup' } },
      { country: 'MNE', name: 'Montenegrin Championship', playoffs: { teams: 4, bestOf: [3, 3] }, cup: { name: 'Montenegrin Cup' } },
    ],
  },
  {
    id: 'cro',
    name: 'Croatian League',
    countries: ['CRO'],
    // The 2026-27 league (OVK Split, in our data from 2025-26, went down).
    clubIds: ['EA-JSP', 'EA-MLA', 'EA-JUG', 'EA-PRI', 'EA-SOL', 'EA-ZAD', 'HVS-41', 'HVS-43', 'HVS-59', 'HVS-47'],
    size: 10,
    fillerNames: [['VK Solaris', 'SOL'], ['VK Zadar 1952', 'ZAD'], ['HAVK Mornar', 'MOR'], ['VK Medveščak', 'MED'], ['VK POŠK', 'POS'], ['OVK Split', 'OVS'], ['KPK Korčula', 'KOR']],
    fillerQuality: [9.5, 12],
    playoffs: { teams: 8, bestOf: [3, 3, 5] },
    cup: { name: 'Croatian Cup' },
  },
  {
    id: 'ita',
    name: 'Italian Serie A1',
    countries: ['ITA'],
    size: 12,
    fillerNames: [['Canottieri Napoli', 'CAN'], ['CC Ortigia', 'ORT'], ['Telimar Palermo', 'TEL'], ['De Akker Bologna', 'DAK'], ['Pallanuoto Trieste', 'TRI'], ['Pro Quinto', 'QUI'], ['Olympic Roma', 'OLR'], ['Roma Vis Nova', 'RVN']],
    fillerQuality: [9, 11.5],
    playoffs: { teams: 4, bestOf: [3, 5] },
    cup: { name: 'Coppa Italia' },
  },
  {
    id: 'gre',
    name: 'Greek A1 Ethniki',
    countries: ['GRE'],
    size: 12,
    fillerNames: [['Ethnikos Piraeus', 'ETH'], ['Hydraikos', 'HYD'], ['Peristeri', 'PER'], ['Panionios', 'PNI'], ['NO Chios', 'CHI'], ['PAOK', 'PAO'], ['Palaio Faliro', 'PFA'], ['NO Chania', 'CHA'], ['Glyfada', 'GLY']],
    fillerQuality: [8.5, 11],
    playoffs: { teams: 4, bestOf: [3, 5] },
    cup: { name: 'Greek Cup' },
  },
  {
    id: 'esp',
    name: 'Spanish División de Honor',
    countries: ['ESP'],
    size: 12,
    fillerNames: [['CN Mataró', 'MAT'], ['CN Sant Andreu', 'SAN'], ['Tenerife Echeyde', 'TEN'], ['CN Rubí', 'RUB'], ['Caballa Ceuta', 'CEU'], ['CN Mediterrani', 'MED'], ['CN Catalunya', 'CAT'], ['Real Canoe', 'CAN']],
    fillerQuality: [8.5, 11],
    playoffs: { teams: 4, bestOf: [3, 3] },
    cup: { name: 'Copa del Rey' },
  },
  {
    id: 'ger',
    name: 'German Wasserball-Liga',
    countries: ['GER'],
    size: 8,
    fillerNames: [['OSC Potsdam', 'POT'], ['SG Neukölln', 'NEU'], ['SV Cannstatt', 'CAN'], ['SV Krefeld 72', 'KRE']],
    fillerQuality: [8.5, 10],
    playoffs: { teams: 8, bestOf: [3, 3, 5] },
    cup: { name: 'DSV-Pokal' },
  },
  {
    id: 'hun',
    name: 'Hungarian OB I',
    countries: ['HUN'],
    size: 12,
    fillerNames: [['Szolnoki Dózsa', 'SZO'], ['Szeged VE', 'SZE'], ['OSC Budapest', 'OSC'], ['Eger', 'EGE'], ['Debreceni VSE', 'DEB'], ['Szentesi VK', 'SZT'], ['UVSE', 'UVS'], ['Kaposvári VK', 'KAP']],
    fillerQuality: [10, 13],
    playoffs: { teams: 8, bestOf: [3, 3, 5] },
    cup: { name: 'Magyar Kupa' },
  },
  {
    // France: Élite, 10 clubs (Marseille, Strasbourg and Pays d'Aix from the European data).
    id: 'fra',
    name: 'French Élite',
    countries: ['FRA'],
    size: 10,
    fillerNames: [['Olympic Nice Natation', 'ONN'], ['CN Sète', 'SET'], ['Montpellier WP', 'MWP'], ['Taverny SN 95', 'TAV'], ['Douaisis WP', 'DOU'], ['USB Bordeaux', 'UBB'], ['AS Monaco', 'ASM']],
    fillerQuality: [10, 12],
    playoffs: { teams: 4, bestOf: [3, 3] },
    cup: { name: 'Trophée Pierre Garsau' },
  },
  {
    // Romania: Superliga (Steaua, Oradea and Dinamo from the European data).
    id: 'rou',
    name: 'Romanian Superliga',
    countries: ['ROU'],
    size: 7,
    fillerNames: [['Rapid București', 'RAP'], ['Corona Brașov', 'COR'], ['Politehnica Cluj', 'POL'], ['Crișul Oradea', 'CRI']],
    fillerQuality: [10, 12],
    playoffs: { teams: 4, bestOf: [3, 5] },
    cup: { name: 'Cupa României' },
  },
  {
    // Turkey: Super League (Galatasaray, Enka and Heybeliada from the European data).
    id: 'tur',
    name: 'Turkish Super League',
    countries: ['TUR'],
    size: 7,
    fillerNames: [['Adalar SK', 'ADA'], ['Fenerbahçe', 'FEN'], ['İstanbul BB', 'IBB'], ['ODTÜ', 'ODT']],
    fillerQuality: [9.5, 11],
    playoffs: { teams: 4, bestOf: [3, 3] },
    cup: { name: 'Turkish Cup' },
  },
  {
    // Georgia: a small league (Dinamo Tbilisi and A-Polo from the European data).
    id: 'geo',
    name: 'Georgian League',
    countries: ['GEO'],
    size: 4,
    fillerNames: [['WPC Iberia Tbilisi', 'IBT'], ['Olymp Tbilisi', 'OLT']],
    fillerQuality: [9.5, 10.5],
    playoffs: { teams: 4, bestOf: [1, 1], finalFour: true },
    cup: { name: 'Georgian Cup' },
  },
  {
    // Malta's main season is the summer: a double round robin from late June, two rounds a week,
    // then the Summer Knock-Out and the playoffs in August.
    id: 'mlt',
    name: 'Maltese Premier Division',
    countries: ['MLT'],
    // The Premier Division (the First Division clubs are in the data too).
    clubIds: ['MLT-NEP', 'MLT-SGN', 'MLT-SLM', 'MLT-SIR', 'MLT-EXI', 'MLT-VLT'],
    size: 6,
    fillerNames: [],
    fillerQuality: [7, 9.5],
    playoffs: { teams: 4, bestOf: [3, 3] },
    cup: { name: 'Summer Knock-Out', timing: 'afterLeague' },
    calendar: { start: '06-26', gapDays: 3 },
  },
  {
    // The Regional (Adriatic) League was suspended in 2025-26. Older saves still use it until
    // their season ends; then they move to the VRL or the Croatian league (see migrateLeague).
    id: 'adriatic',
    name: 'Adriatic League',
    countries: ['SRB', 'MNE', 'CRO', 'BIH'],
    size: 0,
    fillerNames: [],
    fillerQuality: [9, 11],
    playoffs: { teams: 4, bestOf: [1, 1], finalFour: true },
    cup: { name: 'Regional Cup' },
    legacy: true,
  },
];

export const leagueDef = (id: string) => LEAGUES.find((l) => l.id === id) ?? LEAGUES[0];

/** Countries of the real clubs that played in the old Adriatic League (older saves don't store them). */
export const ADRIATIC_CLUB_COUNTRIES: Record<string, string> = {
  'EA-BAN': 'BIH',
  'EA-MLA': 'CRO',
  'EA-JUG': 'CRO',
  'EA-JSP': 'CRO',
  'EA-PRI': 'CRO',
  'EA-SOL': 'CRO',
  'EA-ZAD': 'CRO',
  'EA-BDC': 'MNE',
  'EA-BUD': 'MNE',
  'EA-JHN': 'MNE',
  'EA-KOT': 'MNE',
  'EA-NBG': 'SRB',
  'EA-RAD': 'SRB',
  'EA-PAR': 'SRB',
  'EA-SBC': 'SRB',
};

/**
 * Is a generated club already among the real ones? Matches the European Aquatics club code
 * (EA-SOL for 'SOL') or the same name without prefixes like VK/HAVK ("VK Solaris" = "Solaris").
 */
export function isRealClub(filler: [string, string], real: { id: string; name: string }[]) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(vk|vpk|havk|spd|cn|sv|pk|ovk|kpk)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  return real.some((t) => t.id === `EA-${filler[1]}` || norm(t.name) === norm(filler[0]));
}


/**
 * A club with generated players at a given squad rating (the engine's team rating, so it compares
 * directly with real clubs). The generator's quality runs about 2.6 below the resulting rating, and
 * its random spread can produce stars; nobody here is more than 4 points above the club's level.
 */
export function generatedClub(rng: Rng, id: string, name: string, short: string, rating: number): Team {
  const team = generateTeam(rng, id, name, short, rating - 2.6);
  const cap = rating + 4;
  const players = team.players.map((p) => {
    const excess = overall(p) - cap;
    if (excess <= 0) return p;
    const attrs = { ...p.attrs };
    for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[k] = Math.max(1, Math.round(attrs[k] - excess));
    return { ...p, attrs };
  });
  return { ...team, players };
}
