// Adds the "story" on top of each pool scene: shot clock, exclusion countdown,
// personal fouls, the ball's passing route, the shot line and banners.

import type { MatchEvent, MatchResult } from '../../../engine';
import { buildScenes, LENGTH, WIDTH, type Dot, type Scene } from './scene';

export const SHOT_CLOCK = 30;
export const SHOT_CLOCK_AFTER_EXCLUSION = 18;
export const EXCLUSION_SECONDS = 18;
const QUARTER = 8 * 60;

type Point = { x: number; y: number };
export type ShotOutcome = 'goal' | 'save' | 'miss' | 'block';

export interface Banner {
  kind: 'goal' | 'exclusion' | 'penalty' | 'timeout' | 'fouled-out' | 'quarter' | 'full-time' | 'brutality';
  title: string;
  subtitle?: string;
  team?: 0 | 1;
}

export interface Moment extends Scene {
  event: MatchEvent;
  /** seconds left on the shot clock, when a team has the ball */
  shotClock?: number;
  /** the excluded player and the seconds left on their exclusion */
  exclusion?: { playerId: string; team: 0 | 1; remaining: number };
  /** personal fouls so far, by player id */
  fouls: Record<string, number>;
  /** where the ball travels during this moment (passes, then the shot); ends at scene.ball */
  ballPath: Point[];
  shot?: { from: Point; to: Point; outcome: ShotOutcome };
  banner?: Banner;
  /** which goal (left or right) the ball went into */
  goalSide?: 'left' | 'right';
  /** players' energy (0–100) at this moment, when the engine recorded it */
  energy?: Record<string, number>;
}

const elapsed = (e: MatchEvent) => (Math.min(e.quarter, 4) - 1) * QUARTER + (QUARTER - e.clock);
const POSSESSION_ENDS = new Set<MatchEvent['type']>(['goal', 'save', 'miss', 'block', 'turnover', 'offensive_foul', 'shot_clock']);
const SHOTS = new Set<MatchEvent['type']>(['goal', 'save', 'miss', 'block']);

/** Small deterministic hash so the same match always draws the same passes. */
function pick<T>(items: T[], seed: number): T | undefined {
  return items.length ? items[Math.abs(Math.imul(seed + 1, 2654435761)) % items.length] : undefined;
}

export function buildTimeline(result: MatchResult): Moment[] {
  const scenes = buildScenes(result);
  const names = new Map(result.teams.flatMap((t) => t.players.map((p) => [p.id, `#${p.cap} ${p.name}`] as const)));
  const fouls: Record<string, number> = {};
  let possessionStart = 0;
  let exclusion: { playerId: string; team: 0 | 1; start: number } | undefined;
  let previousBall: Point = { x: LENGTH / 2, y: WIDTH / 2 };
  const snapshots = result.energy ?? [];
  let snapshot = -1;

  return result.events.map((e, i) => {
    const scene = scenes[i];
    const t = elapsed(e);
    const at = (id?: string): Point | undefined => {
      const d = id ? scene.dots.find((x) => x.id === id) : undefined;
      return d ? { x: d.x, y: d.y } : undefined;
    };
    const teammates = (team: 0 | 1, except: (string | undefined)[]) =>
      scene.dots.filter((d: Dot) => d.team === team && !d.goalkeeper && !d.excluded && !except.includes(d.id));

    // --- clocks ---
    if (e.type === 'quarter_start') possessionStart = t;
    if (e.type === 'exclusion' || e.type === 'penalty_awarded') {
      const remaining = SHOT_CLOCK - (t - possessionStart);
      possessionStart = t - (SHOT_CLOCK - Math.max(remaining, SHOT_CLOCK_AFTER_EXCLUSION));
    }
    const inPlay = e.quarter <= 4 && !['quarter_start', 'quarter_end', 'full_time', 'sprint', 'sub'].includes(e.type);
    const shotClock = inPlay ? Math.max(0, Math.round(SHOT_CLOCK - (t - possessionStart))) : undefined;

    if (e.type === 'exclusion') exclusion = { playerId: e.other!, team: (1 - e.team) as 0 | 1, start: t };
    const exclusionNow = exclusion && scene.dots.some((d) => d.id === exclusion!.playerId && d.excluded)
      ? { playerId: exclusion.playerId, team: exclusion.team, remaining: Math.max(0, EXCLUSION_SECONDS - (t - exclusion.start)) }
      : undefined;
    if (!exclusionNow) exclusion = undefined;

    if (e.type === 'exclusion' || e.type === 'penalty_awarded') fouls[e.other!] = (fouls[e.other!] ?? 0) + 1;
    while (snapshot + 1 < snapshots.length && snapshots[snapshot + 1].eventIndex <= i + 1) snapshot++;

    // --- ball route ---
    const shooter = at(e.player);
    const end = { x: scene.ball.x, y: scene.ball.y };
    let path: Point[] = [previousBall];
    let shot: Moment['shot'];
    if (SHOTS.has(e.type) && e.situation !== 'shootout' && e.situation !== 'penalty' && shooter) {
      if (e.situation === 'counter') {
        path.push({ x: LENGTH / 2, y: shooter.y }, shooter);
      } else {
        // Build-up: one or two passes, ending with the assist when there was one.
        const options = teammates(e.team, [e.player, e.assist]);
        const first = pick(options, i);
        const second = pick(options.filter((d) => d !== first), i + 7);
        for (const p of [first, e.situation === 'powerplay' ? second : undefined]) if (p) path.push({ x: p.x, y: p.y });
        const assist = at(e.assist);
        if (assist) path.push(assist);
        path.push(shooter);
      }
      path.push(end);
      shot = { from: shooter, to: end, outcome: e.type as ShotOutcome };
    } else if ((e.situation === 'penalty' || e.situation === 'shootout') && shooter) {
      path = [shooter, shooter, end];
      shot = { from: shooter, to: end, outcome: e.type as ShotOutcome };
    } else if (e.type === 'turnover' && e.other) {
      path.push(at(e.player) ?? previousBall, end);
    } else if (e.type === 'exclusion' || e.type === 'penalty_awarded' || e.type === 'brutality') {
      const passer = pick(teammates(e.team, [e.player]), i);
      if (passer) path.push({ x: passer.x, y: passer.y });
      path.push(end);
    } else {
      path.push(end);
    }
    previousBall = scene.ball.inGoal ? { x: LENGTH / 2, y: WIDTH / 2 } : end;

    // --- banner ---
    const team = result.teams[e.team];
    let banner: Banner | undefined;
    switch (e.type) {
      case 'goal':
        if (e.situation !== 'shootout') banner = { kind: 'goal', title: 'GOAL', subtitle: names.get(e.player!), team: e.team };
        break;
      case 'exclusion':
        banner = { kind: 'exclusion', title: 'EXCLUSION', subtitle: `${names.get(e.other!)} · 6 on 5 ${team.short}`, team: (1 - e.team) as 0 | 1 };
        break;
      case 'penalty_awarded':
        banner = { kind: 'penalty', title: 'PENALTY', subtitle: `for ${team.name}`, team: e.team };
        break;
      case 'brutality':
        banner = { kind: 'brutality', title: 'BRUTALITY', subtitle: `${names.get(e.other!)} sent off · penalty and 4 min man down`, team: (1 - e.team) as 0 | 1 };
        break;
      case 'timeout':
        banner = { kind: 'timeout', title: 'TIMEOUT', subtitle: team.name, team: e.team };
        break;
      case 'fouled_out':
        banner = { kind: 'fouled-out', title: '3 FOULS', subtitle: `${names.get(e.player!)} is out of the game`, team: e.team };
        break;
      case 'quarter_start':
        banner = { kind: 'quarter', title: e.quarter > 4 ? 'PENALTY SHOOTOUT' : `QUARTER ${e.quarter}` };
        break;
      case 'full_time':
        banner = { kind: 'full-time', title: 'FULL TIME', subtitle: `${result.teams[0].short} ${e.score[0]}–${e.score[1]} ${result.teams[1].short}` };
        break;
    }

    if (POSSESSION_ENDS.has(e.type) || e.situation === 'penalty') possessionStart = t;

    return {
      ...scene,
      event: e,
      shotClock,
      exclusion: exclusionNow,
      fouls: { ...fouls },
      ballPath: path,
      shot,
      banner,
      goalSide: e.type === 'goal' ? (scene.ball.x > LENGTH / 2 ? 'right' : 'left') : undefined,
      energy: snapshots[snapshot]?.energy,
    };
  });
}

/** Live box score for one player up to (and including) the given event. */
export function liveStats(result: MatchResult, playerId: string, uptoIndex: number) {
  const s = { goals: 0, shots: 0, assists: 0, exclusionsDrawn: 0, fouls: 0, saves: 0, steals: 0 };
  for (const e of result.events.slice(0, uptoIndex + 1)) {
    if (e.situation === 'shootout') continue;
    if (e.player === playerId && SHOTS.has(e.type)) s.shots++;
    if (e.player === playerId && e.type === 'goal') s.goals++;
    if (e.assist === playerId) s.assists++;
    if (e.player === playerId && e.type === 'exclusion') s.exclusionsDrawn++;
    if (e.other === playerId && (e.type === 'exclusion' || e.type === 'penalty_awarded')) s.fouls++;
    if (e.other === playerId && e.type === 'save') s.saves++;
    if (e.other === playerId && e.type === 'turnover') s.steals++;
  }
  return s;
}
