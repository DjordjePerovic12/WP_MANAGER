// Turns match events into "scenes": where every player and the ball are in the pool.
//
// The engine simulates possessions, not positions, so this places players in
// realistic formations for each moment (sprint, set attack, 6 on 5, counter,
// penalty…) and the view animates between them.

import { pickLineup, type MatchEvent, type MatchResult, type Player, type Position, type Tactics } from '../../../engine';

/** Field of play in meters: x along the length (goals at x=0 and x=LENGTH), y across. */
export const LENGTH = 30;
export const WIDTH = 20;
const MID_Y = WIDTH / 2;

export interface Dot {
  id: string;
  team: 0 | 1;
  cap: number;
  goalkeeper: boolean;
  x: number;
  y: number;
  highlight: boolean;
  excluded: boolean;
}

export interface Scene {
  dots: Dot[];
  ball: { x: number; y: number; inGoal: boolean };
  /** which team attacks toward the right-hand goal (x = LENGTH) */
  attacksRight: 0 | 1;
  caption: string;
}

/** A point relative to the goal being attacked: d = meters out from the goal line, lat = meters left/right of center. */
type Spot = { d: number; lat: number };

// ---- Formations (relative to the goal being attacked) ----

const EVEN_SLOTS = { center: { d: 2, lat: 0 }, wingL: { d: 2.6, lat: -6.5 }, wingR: { d: 2.6, lat: 6.5 }, flatL: { d: 5, lat: -4.3 }, flatR: { d: 5, lat: 4.3 }, point: { d: 7, lat: 0 } };
type Slot = keyof typeof EVEN_SLOTS;
const SLOT_PREFERENCE: Record<Exclude<Position, 'GK'>, Slot[]> = {
  CENTER: ['center', 'flatL', 'flatR', 'point', 'wingL', 'wingR'],
  POINT: ['point', 'flatL', 'flatR', 'wingL', 'wingR', 'center'],
  WING: ['wingR', 'wingL', 'flatR', 'flatL', 'point', 'center'],
  CDEF: ['flatL', 'flatR', 'point', 'wingL', 'wingR', 'center'],
  DRIVER: ['flatL', 'flatR', 'wingL', 'wingR', 'point', 'center'],
};
const ASSIGN_ORDER: Exclude<Position, 'GK'>[] = ['CENTER', 'POINT', 'WING', 'CDEF', 'DRIVER'];

const POWER_PLAY: Record<Tactics['powerPlay'], Spot[]> = {
  '4-2': [{ d: 2, lat: -3 }, { d: 2, lat: 3 }, { d: 5.5, lat: -5.5 }, { d: 6.2, lat: -1.9 }, { d: 6.2, lat: 1.9 }, { d: 5.5, lat: 5.5 }],
  '3-3': [{ d: 2, lat: -4 }, { d: 2, lat: 0 }, { d: 2, lat: 4 }, { d: 5.5, lat: -4.5 }, { d: 6.5, lat: 0 }, { d: 5.5, lat: 4.5 }],
};
const SHORT_HANDED: Spot[] = [{ d: 1.4, lat: -2.4 }, { d: 1.4, lat: 2.4 }, { d: 3.8, lat: -4.2 }, { d: 3.8, lat: 4.2 }, { d: 4.3, lat: 0 }];
const COUNTER_ATTACK: Spot[] = [{ d: 4, lat: -1 }, { d: 7, lat: 4 }, { d: 8, lat: -5 }, { d: 10, lat: 1 }, { d: 12, lat: -3 }, { d: 13, lat: 6 }];
const COUNTER_DEFENSE: Spot[] = [{ d: 6, lat: 1.5 }, { d: 9, lat: -2 }, { d: 11, lat: 5 }, { d: 12, lat: -6 }, { d: 14, lat: 2 }, { d: 16, lat: -1 }];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Which team attacks the right-hand goal: home in quarters 1–2, away in 3–4 (teams switch ends at half time). */
export function attacksRightIn(quarter: number): 0 | 1 {
  return quarter <= 2 || quarter > 4 ? 0 : 1;
}

interface LineupState {
  water: [Player[], Player[]]; // [goalkeeper, ...six field players] per team
  slots: [Map<string, Slot>, Map<string, Slot>];
}

function assignSlots(field: Player[]): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  const free = new Set<Slot>(Object.keys(EVEN_SLOTS) as Slot[]);
  const ordered = [...field].sort((a, b) => ASSIGN_ORDER.indexOf(a.position as never) - ASSIGN_ORDER.indexOf(b.position as never));
  for (const p of ordered) {
    const prefs = SLOT_PREFERENCE[(p.position === 'GK' ? 'DRIVER' : p.position) as Exclude<Position, 'GK'>];
    // Left-handers belong on the right side.
    const ordering = p.hand === 'L' ? [...prefs].sort((a, b) => Number(b.endsWith('R')) - Number(a.endsWith('R'))) : prefs;
    const slot = ordering.find((s) => free.has(s)) ?? [...free][0];
    slots.set(p.id, slot);
    free.delete(slot);
  }
  return slots;
}

export function buildScenes(result: MatchResult): Scene[] {
  const lineups = result.teams.map((t) => pickLineup(t.players).water);
  const state: LineupState = {
    water: [lineups[0], lineups[1]],
    slots: [assignSlots(lineups[0].slice(1)), assignSlots(lineups[1].slice(1))],
  };
  let excluded: string | undefined;
  let previous: Scene | undefined;
  /** Players sent off for brutality: they leave the pool and are not drawn until replaced. */
  const sentOff = new Set<string>();
  const scenes: Scene[] = [];

  for (const e of result.events) {
    if (e.type === 'sub') {
      const team = e.team;
      const incoming = result.teams[team].players.find((p) => p.id === e.player);
      const idx = state.water[team].findIndex((p) => p.id === e.other);
      if (incoming && idx >= 0) {
        state.water[team] = state.water[team].map((p, i) => (i === idx ? incoming : p));
        const slots = state.slots[team];
        const slot = slots.get(e.other!);
        slots.delete(e.other!);
        if (slot) slots.set(incoming.id, slot);
        else state.slots[team] = assignSlots(state.water[team].slice(1));
      }
      scenes.push(previous ?? sceneFor(e, result, state, undefined));
      continue;
    }
    if (e.type === 'brutality') sentOff.add(e.other!);
    const powerPlayMoment = e.type === 'exclusion' || e.situation === 'powerplay';
    if (e.type === 'exclusion') excluded = e.other;
    else if (!powerPlayMoment && !['timeout', 'fouled_out'].includes(e.type)) excluded = undefined;

    const scene = ['timeout', 'fouled_out', 'quarter_end', 'full_time'].includes(e.type) && previous
      ? { ...previous, caption: captionFor(e, result) }
      : sceneFor(e, result, state, excluded);
    scene.dots = scene.dots.filter((d) => !sentOff.has(d.id));
    scenes.push(scene);
    previous = scene;
  }
  return scenes;
}

function captionFor(e: MatchEvent, result: MatchResult): string {
  const team = result.teams[e.team]?.short ?? '';
  switch (e.type) {
    case 'quarter_start': return `Quarter ${e.quarter}`;
    case 'sprint': return `Sprint won by ${team}`;
    case 'goal': return e.situation === 'shootout' ? `Shootout goal ${team}` : `GOAL ${team}`;
    case 'save': return 'Save';
    case 'miss': return 'Wide';
    case 'block': return 'Blocked';
    case 'exclusion': return `Exclusion: 6 on 5 for ${team}`;
    case 'penalty_awarded': return `Penalty for ${team}`;
    case 'brutality': return `Brutality: penalty for ${team}`;
    case 'counter': return `Counterattack ${team}`;
    case 'turnover': return `${team} lose the ball`;
    case 'offensive_foul': return 'Offensive foul';
    case 'shot_clock': return 'Shot clock';
    case 'timeout': return `Timeout ${team}`;
    case 'fouled_out': return 'Fouled out';
    case 'quarter_end': return `End of quarter ${e.quarter}`;
    case 'full_time': return 'Full time';
    default: return '';
  }
}

function sceneFor(e: MatchEvent, result: MatchResult, state: LineupState, excluded: string | undefined): Scene {
  const attacksRight = attacksRightIn(e.quarter);
  const attack = e.team;
  const defense = (1 - attack) as 0 | 1;
  /** Convert a goal-relative spot into pool coordinates for a team attacking the given way. */
  const toPool = (s: Spot, team: 0 | 1) => {
    const right = team === attacksRight;
    return { x: right ? LENGTH - s.d : s.d, y: clamp(MID_Y + (right ? s.lat : -s.lat), 0.6, WIDTH - 0.6) };
  };
  const positions = new Map<string, { x: number; y: number }>();
  const field = (team: 0 | 1) => state.water[team].slice(1);
  const keeper = (team: 0 | 1) => state.water[team][0];

  // Goalkeepers: in their own goal. The attacking team's keeper steps out a little.
  const ownGoal = (team: 0 | 1, out: number) => toPool({ d: LENGTH - out, lat: 0 }, team);
  positions.set(keeper(defense).id, ownGoal(defense, 0.7));
  positions.set(keeper(attack).id, ownGoal(attack, 2.5));

  let ball = { x: LENGTH / 2, y: MID_Y, inGoal: false };
  const kind = e.type === 'quarter_start' || e.type === 'sprint' ? 'sprint'
    : e.situation === 'penalty' || e.situation === 'shootout' || e.type === 'penalty_awarded' || e.type === 'brutality' ? 'penalty'
    : e.type === 'exclusion' || e.situation === 'powerplay' ? 'powerplay'
    : e.type === 'counter' || e.situation === 'counter' ? 'counter'
    : 'even';

  if (kind === 'sprint') {
    for (const team of [0, 1] as const) {
      const left = team === attacksRight; // the team attacking right starts on its own (left) goal line
      field(team).forEach((p, i) => positions.set(p.id, { x: left ? 1.2 : LENGTH - 1.2, y: 4 + i * 2.4 }));
      positions.set(keeper(team).id, { x: left ? 0.6 : LENGTH - 0.6, y: MID_Y });
    }
    if (e.type === 'sprint') {
      const winnerLeft = e.team === attacksRight;
      positions.set(e.player!, { x: LENGTH / 2 + (winnerLeft ? -0.6 : 0.6), y: MID_Y });
      positions.set(e.other!, { x: LENGTH / 2 + (winnerLeft ? 1.4 : -1.4), y: MID_Y + 1.2 });
    }
  } else if (kind === 'penalty') {
    const shooter = e.type === 'penalty_awarded' || e.type === 'brutality' ? undefined : e.player;
    const others = [...field(attack), ...field(defense)].filter((p) => p.id !== shooter);
    others.forEach((p, i) => positions.set(p.id, toPool({ d: 7.5 + (i % 2) * 1.5, lat: -8 + (i * 16) / Math.max(1, others.length - 1) }, attack)));
    if (shooter) positions.set(shooter, toPool({ d: 6, lat: 0 }, attack));
    if (e.type === 'penalty_awarded' || e.type === 'brutality') positions.set(e.player!, toPool({ d: 4, lat: 0 }, attack));
    if (e.type === 'brutality') positions.set(e.other!, toPool({ d: 3.2, lat: 1 }, attack));
    ball = { ...toPool({ d: 6, lat: 0 }, attack), inGoal: false };
  } else if (kind === 'counter') {
    field(attack).forEach((p, i) => positions.set(p.id, toPool(COUNTER_ATTACK[i % 6], attack)));
    field(defense).forEach((p, i) => positions.set(p.id, toPool(COUNTER_DEFENSE[i % 6], attack)));
    if (e.player) positions.set(e.player, toPool(COUNTER_ATTACK[0], attack));
  } else if (kind === 'powerplay') {
    const spots = POWER_PLAY[result.teams[attack].tactics.powerPlay];
    field(attack).forEach((p, i) => positions.set(p.id, toPool(spots[i % 6], attack)));
    field(defense).filter((p) => p.id !== excluded).forEach((p, i) => positions.set(p.id, toPool(SHORT_HANDED[i % 5], attack)));
  } else {
    const slots = state.slots[attack];
    const spotOf = (id: string) => EVEN_SLOTS[slots.get(id) ?? 'point'];
    field(attack).forEach((p) => positions.set(p.id, toPool(spotOf(p.id), attack)));
    // Defenders mark the attacker in the same slot, goal side. Zone defenses sag toward the goal.
    const system = result.teams[defense].tactics.defense;
    const attackers = field(attack);
    field(defense).forEach((p, i) => {
      const mark = spotOf(attackers[i]?.id ?? '');
      let spot: Spot = { d: Math.max(0.8, mark.d - 0.9), lat: mark.lat * 0.85 };
      if (system === 'zone') spot = { d: Math.max(1, mark.d * 0.7), lat: mark.lat * 0.6 };
      if (system === 'mdrop' && mark.d > 6) spot = { d: 3, lat: 0.8 }; // the point defender drops onto the center
      positions.set(p.id, toPool(spot, attack));
    });
  }

  // The excluded player swims to the re-entry corner at their own goal line.
  if (excluded && kind === 'powerplay') positions.set(excluded, { x: toPool({ d: 0.6, lat: 0 }, attack).x, y: WIDTH - 0.8 });

  // The ball.
  const at = (id?: string) => (id ? positions.get(id) : undefined);
  const goalMouth = toPool({ d: -0.5, lat: 0 }, attack);
  switch (e.type) {
    case 'goal':
      ball = { x: goalMouth.x, y: MID_Y + ((e.player?.length ?? 0) % 3) - 1, inGoal: true };
      break;
    case 'save':
      ball = { ...(at(e.other) ?? goalMouth), inGoal: false };
      break;
    case 'miss':
      ball = { ...toPool({ d: -0.3, lat: (e.player?.length ?? 0) % 2 ? 2.6 : -2.6 }, attack), inGoal: false };
      break;
    case 'block':
      ball = { ...(at(e.other) ?? at(e.player) ?? ball), inGoal: false };
      break;
    case 'turnover':
      ball = { ...(at(e.other) ?? at(e.player) ?? ball), inGoal: false };
      break;
    default:
      if (kind !== 'sprint' && kind !== 'penalty') ball = { ...(at(e.player) ?? ball), inGoal: false };
  }

  const highlight = new Set([e.player].filter(Boolean) as string[]);
  const dots: Dot[] = ([0, 1] as const).flatMap((team) =>
    state.water[team].map((p, i) => ({
      id: p.id,
      team,
      cap: p.cap,
      goalkeeper: i === 0,
      ...(positions.get(p.id) ?? { x: LENGTH / 2, y: MID_Y }),
      highlight: highlight.has(p.id),
      excluded: p.id === excluded && kind === 'powerplay',
    })),
  );
  return { dots, ball, attacksRight, caption: captionFor(e, result) };
}
