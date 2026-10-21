// Random fictional teams and players. No real names or clubs, so there are no
// licensing issues. A future editor can let fans create real squads themselves.

import { createRng, type Rng } from './rng';
import { POSITION_WEIGHTS } from './ratings';
import type { Attributes, Player, Position, Tactics, Team } from './types';

const FIRST_NAMES = [
  'Marko', 'Nikola', 'Luka', 'Stefan', 'Filip', 'Dušan', 'Ivan', 'Ante', 'Josip', 'Mateo',
  'Dénes', 'Gergő', 'Balázs', 'Márton', 'Ádám', 'Vince', 'Lorenzo', 'Matteo', 'Andrea', 'Pietro',
  'Alessandro', 'Álvaro', 'Sergi', 'Pablo', 'Unai', 'Kostas', 'Giannis', 'Dimitris', 'Nikos', 'Vuk',
  'Aleksa', 'Strahinja', 'Lovro', 'Toni', 'Bence', 'Kristóf', 'Riccardo', 'Marc', 'Angelos', 'Đorđe',
];
const LAST_NAMES = [
  'Jovanović', 'Radić', 'Marković', 'Petrović', 'Lazić', 'Vukčević', 'Babić', 'Kovač', 'Perić', 'Matić',
  'Horváth', 'Nagy', 'Szabó', 'Varga', 'Kiss', 'Tóth', 'Rossi', 'Bianchi', 'Esposito', 'Russo',
  'Ferrari', 'García', 'Martín', 'Sánchez', 'López', 'Papadopoulos', 'Georgiou', 'Nikolaou', 'Mitrović', 'Đukić',
  'Bošković', 'Vidović', 'Pavlović', 'Brajković', 'Farkas', 'Molnár', 'Conti', 'Romero', 'Kallis', 'Simić',
];

export const CLUB_NAMES: [string, string][] = [
  ['Dunav Talas', 'DUN'],
  ['Adriatic Sharks', 'ADR'],
  ['Pannonia Vízilabda', 'PAN'],
  ['Sirena Napoli Nuoto', 'SIR'],
  ['Tritones Barcelona', 'TRI'],
  ['Aegean Poseidon', 'AEG'],
  ['Lovćen Bay', 'LOV'],
  ['Sava Rapids', 'SAV'],
  ['Dalmatia Galebovi', 'DAL'],
  ['Tisza Hullám', 'TIS'],
  ['Liguria Delfini', 'LIG'],
  ['Mediterráneo Orcas', 'MED'],
];

const ROSTER: Position[] = ['GK', 'GK', 'CENTER', 'CENTER', 'CDEF', 'CDEF', 'DRIVER', 'DRIVER', 'DRIVER', 'WING', 'WING', 'POINT', 'POINT'];
const ATTRIBUTE_KEYS: (keyof Attributes)[] = [
  'speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ', 'reflexes', 'gkPositioning',
];
const GK_ONLY: (keyof Attributes)[] = ['reflexes', 'gkPositioning'];

const clampAttr = (v: number) => Math.max(1, Math.min(20, Math.round(v)));

/** Approximately normal noise (sum of uniforms). */
function noise(rng: Rng, spread: number) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * spread;
}

export const DEFAULT_TACTICS: Tactics = { defense: 'press', frontCenter: false, counterAggression: 3, powerPlay: '4-2' };

export function generatePlayer(rng: Rng, position: Position, quality: number, id: string, cap: number): Player {
  const weights = POSITION_WEIGHTS[position];
  const playerLevel = quality + noise(rng, 4);
  const attrs = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    let value = playerLevel + noise(rng, 5);
    if (weights[key]) value += 1.5; // players are better at what their position needs
    if (position === 'GK' && !GK_ONLY.includes(key) && key !== 'legStrength' && key !== 'gameIQ') value -= 5;
    if (position !== 'GK' && GK_ONLY.includes(key)) value = 1 + rng.next() * 4;
    attrs[key] = clampAttr(value);
  }
  return {
    id,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    cap,
    position,
    hand: rng.chance(0.18) ? 'L' : 'R',
    age: rng.int(18, 34),
    attrs,
  };
}

/** quality is the average attribute level of the squad, roughly 6 (amateur) to 16 (world class). */
export function generateTeam(rng: Rng, id: string, name: string, short: string, quality: number): Team {
  const caps = [1, 13, ...Array.from({ length: 11 }, (_, i) => i + 2)];
  return {
    id,
    name,
    short,
    players: ROSTER.map((pos, i) => generatePlayer(rng, pos, quality, `${id}-${i + 1}`, caps[i])).sort((a, b) => a.cap - b.cap),
    tactics: { ...DEFAULT_TACTICS },
  };
}

/** A league of fictional clubs with a spread of strengths. */
export function generateLeague(seed: number, count = CLUB_NAMES.length): Team[] {
  const rng = createRng(seed);
  return CLUB_NAMES.slice(0, count).map(([name, short], i) => generateTeam(rng, `t${i + 1}`, name, short, rng.range(9.5, 14)));
}
