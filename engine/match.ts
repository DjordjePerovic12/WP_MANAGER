// Possession-based water polo match simulation.
//
// The match is a sequence of possessions. Each possession resolves into one
// outcome (shot, exclusion → 6v5, penalty, turnover, shot-clock violation),
// with probabilities driven by player attributes, fatigue and tactics.
// All balance numbers come from ./tuning.ts.

import { createRng, type Rng } from './rng';
import { overall } from './ratings';
import { TUNING as T } from './tuning';
import type { Attributes, EnergySnapshot, MatchEvent, MatchOptions, MatchResult, Player, Position, Situation, Tactics, Team } from './types';

type Side = {
  idx: 0 | 1;
  team: Team;
  /** Tactics in use right now (the AI coach may change them); team.tactics is never mutated. */
  tactics: Tactics;
  aiCoach: boolean;
  water: Player[]; // water[0] is the goalkeeper, then six field players
  bench: Player[];
  fouls: Map<string, number>;
  fouledOut: Set<string>;
  timeouts: number;
  concededRun: number;
  /** Player currently sitting out an exclusion (until the power play ends). */
  excluded?: string;
  /** Run by a human manager: no AI coach or automatic timeouts. */
  managed: boolean;
  /** The assistant makes rolling substitutions (always true for AI teams). */
  autoSubs: boolean;
  /** The manager asked for a timeout; it is taken as soon as the team has the ball. */
  pendingTimeout: boolean;
  /** A player sent off for brutality: the team plays a man down until `until` (game seconds). */
  sentOff?: { id: string; until: number };
  /** The role of each water slot (index 0 = goalkeeper). The coach's default shape, or the manager's own lineup. */
  slots: Position[];
};

type Phase = 'quarter_start' | 'play' | 'shootout' | 'finished';

/** What a manager sees between possessions. */
export interface LiveState {
  phase: Phase;
  quarter: number;
  clock: number;
  score: [number, number];
  /** which team has the ball next */
  possession: 0 | 1;
  teams: {
    water: string[];
    bench: string[];
    fouls: Record<string, number>;
    unavailable: string[];
    timeouts: number;
    pendingTimeout: boolean;
    autoSubs: boolean;
    tactics: Tactics;
  }[];
  energy: Record<string, number>;
}

/** What happens after a possession: who gets the ball and whether a counterattack is on. */
type Transition = 'restart' | 'counter' | 'steal';

interface PossessionResult {
  elapsed: number;
  transition: Transition;
}

/** Field slots in water order (water[1..6]). Slot 3 is the right driver (position 2), slot 5 the right wing (position 1). */
const LINEUP_SLOTS: Position[] = ['CENTER', 'CDEF', 'DRIVER', 'DRIVER', 'WING', 'POINT'];
const RIGHT_SIDE = new Set([3, 5]);

/** Big men (2m) and perimeter players: positions within a family are close to interchangeable. */
const POSITION_FAMILY: Record<Position, string> = { GK: 'gk', CENTER: 'big', CDEF: 'big', DRIVER: 'perimeter', WING: 'perimeter', POINT: 'perimeter' };

/** How well a player suits a role, as a coach sees it: 1 = his own position. */
export function positionFit(playerPosition: Position, role: Position): number {
  if (playerPosition === role) return 1;
  return POSITION_FAMILY[playerPosition] === POSITION_FAMILY[role] ? T.relatedPositionFactor : T.outOfPositionFactor;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The starting seven: the requested lineup when it is valid (a goalkeeper and six field players from the squad), else the coach's pick. */
export function lineupFor(players: Player[], requested?: string[]): { water: Player[]; bench: Player[]; custom: boolean } {
  if (requested?.length === 7) {
    const chosen = requested.map((id) => players.find((p) => p.id === id));
    const valid = chosen.every(Boolean) && new Set(requested).size === 7 && chosen[0]!.position === 'GK' && chosen.slice(1).every((p) => p!.position !== 'GK');
    if (valid) return { water: chosen as Player[], bench: players.filter((p) => !requested.includes(p.id)), custom: true };
  }
  return { ...pickLineup(players), custom: false };
}

export function pickLineup(players: Player[]): { water: Player[]; bench: Player[] } {
  const keepers = players.filter((p) => p.position === 'GK').sort((a, b) => overall(b) - overall(a));
  // No goalkeeper available: a field player goes in goal (the one with the best goalkeeping attributes).
  if (!keepers.length) keepers.push(players.reduce((a, b) => (b.attrs.reflexes + b.attrs.gkPositioning > a.attrs.reflexes + a.attrs.gkPositioning ? b : a)));
  const remaining = players.filter((p) => p.position !== 'GK' && p !== keepers[0]);
  const field: Player[] = [];
  for (const [i, slot] of LINEUP_SLOTS.entries()) {
    const candidates = remaining.filter((p) => p.position === slot);
    const pool = candidates.length ? candidates : remaining;
    // Coaches want a left-hander on the right side.
    const score = (p: Player) => overall(p, slot) + (RIGHT_SIDE.has(i + 1) && p.hand === 'L' ? T.rightLeftyLineupBonus : 0);
    const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    field.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  const water = [keepers[0], ...field];
  return { water, bench: players.filter((p) => !water.includes(p)) };
}

const shootingSkill = (p: Player) => p.attrs.shootingPower * 0.45 + p.attrs.shootingAccuracy * 0.55;

/**
 * The roles the engine picks when the coach has not named them: the starting
 * lineup's best 6v5 shooters and its best penalty shooter. Useful for showing defaults in a UI.
 */
export function defaultRoles(players: Player[]): { powerPlayShooters: string[]; penaltyTaker: string } {
  const field = pickLineup(players).water.slice(1);
  const byShooting = [...field].sort((a, b) => shootingSkill(b) - shootingSkill(a));
  const penalty = (p: Player) => shootingSkill(p) + p.attrs.gameIQ * 0.3;
  return {
    powerPlayShooters: byShooting.slice(0, T.designatedShooters).map((p) => p.id),
    penaltyTaker: field.reduce((a, b) => (penalty(b) > penalty(a) ? b : a)).id,
  };
}

/**
 * A match that can be played one step at a time (a quarter start, one possession, …),
 * so a manager can change tactics, call timeouts and substitute between steps.
 * `simulateMatch` simply steps it to the end.
 */
export class LiveMatch {
  private rng: Rng;
  private sides: [Side, Side];
  private events: MatchEvent[] = [];
  private delivered = 0;
  private score: [number, number] = [0, 0];
  private quarter = 1;
  private energy = new Map<string, number>();
  private seconds = new Map<string, number>();
  private timeoutBoost: [number, number] = [0, 0];
  private lateCoachDone = false;
  /** Match-day form: some days a team just plays better or worse than its ratings. */
  private form: [number, number];
  private phase: Phase = 'quarter_start';
  /** seconds played in the current quarter */
  private t = 0;
  private poss: 0 | 1 = 0;
  private transition: Transition = 'restart';
  private quarterScores: [number, number][] = [];
  private quarterStartScore: [number, number] = [0, 0];
  private shootoutTally?: [number, number];
  private snapshots: EnergySnapshot[] = [];
  private readonly shootoutOnDraw: boolean;
  private readonly injuriesOn: boolean;
  readonly seed: number;

  constructor(private teams: [Team, Team], options: MatchOptions = {}) {
    this.seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = createRng(this.seed);
    this.shootoutOnDraw = options.shootoutOnDraw ?? true;
    const aiCoach = options.aiCoach ?? true;
    const coach = typeof aiCoach === 'boolean' ? [aiCoach, aiCoach] : aiCoach;
    const managed = options.managed ?? [false, false];
    this.injuriesOn = options.injuries ?? true;
    this.sides = [
      this.makeSide(teams[0], 0, coach[0] && !managed[0], managed[0], options.autoSubs ?? true, options.lineups?.[0]),
      this.makeSide(teams[1], 1, coach[1] && !managed[1], managed[1], options.autoSubs ?? true, options.lineups?.[1]),
    ];
    const formNoise = () => (this.rng.next() + this.rng.next() + this.rng.next() - 1.5) * 2 * T.matchFormSpread;
    this.form = [formNoise() + (options.formBonus?.[0] ?? 0), formNoise() + (options.formBonus?.[1] ?? 0)];
    for (const t of teams) for (const p of t.players) {
      this.energy.set(p.id, clamp(options.initialEnergy?.[p.id] ?? 100, 0, 100));
      this.seconds.set(p.id, 0);
    }
  }

  private makeSide(team: Team, idx: 0 | 1, aiCoach: boolean, managed: boolean, autoSubs: boolean, lineup?: string[]): Side {
    const { water, bench, custom } = lineupFor(team.players, lineup);
    // With the manager's own lineup, each player's position is his role: 3 centers stay 3 centers.
    const slots: Position[] = custom ? water.map((p) => p.position) : ['GK', ...LINEUP_SLOTS];
    return {
      slots,
      idx, team, tactics: { ...team.tactics }, aiCoach, water, bench, fouls: new Map(), fouledOut: new Set(), timeouts: T.timeouts, concededRun: 0,
      managed, autoSubs: !managed || autoSubs, pendingTimeout: false,
    };
  }

  // ------------------------------------------------------------ live control

  get finished() {
    return this.phase === 'finished';
  }

  /** Play the next step (a quarter start, one possession, the end of a quarter, or the shootout). Returns the new events. */
  step(): MatchEvent[] {
    switch (this.phase) {
      case 'quarter_start':
        if (this.quarter > 1) {
          this.quarterBreak();
          for (const side of this.sides) this.coach(side);
        }
        this.quarterStartScore = [...this.score];
        this.emit({ type: 'quarter_start', team: 0 }, 0);
        this.poss = this.sprint();
        this.t = 4;
        this.transition = 'restart';
        this.phase = 'play';
        this.snapshot();
        break;
      case 'play':
        if (T.quarterSeconds - this.t > 1) {
          this.possession();
          break;
        }
        this.emit({ type: 'quarter_end', team: 0 }, T.quarterSeconds);
        this.quarterScores.push([this.score[0] - this.quarterStartScore[0], this.score[1] - this.quarterStartScore[1]]);
        if (this.quarter < 4) {
          this.quarter++;
          this.phase = 'quarter_start';
        } else if (this.shootoutOnDraw && this.score[0] === this.score[1]) {
          this.phase = 'shootout';
        } else {
          this.finish();
        }
        break;
      case 'shootout':
        this.shootoutTally = this.shootout();
        this.finish();
        break;
      case 'finished':
        break;
    }
    return this.takeEvents();
  }

  /** Change a team's tactics from the next possession on. */
  setTactics(team: 0 | 1, changes: Partial<Tactics>) {
    const side = this.sides[team];
    side.tactics = { ...side.tactics, ...changes };
    if (this.phase !== 'finished') this.emit({ type: 'tactics', team, tactics: changes }, this.t);
  }

  /** Let the assistant handle rolling substitutions for a team (or stop it). */
  setAutoSubs(team: 0 | 1, on: boolean) {
    this.sides[team].autoSubs = on;
  }

  /** Ask for a timeout; it is taken as soon as the team has the ball. Returns false when none are left. */
  callTimeout(team: 0 | 1): boolean {
    const side = this.sides[team];
    if (side.timeouts === 0 || this.phase === 'finished') return false;
    side.pendingTimeout = true;
    return true;
  }

  /** Substitute a player in the water for one on the bench. Returns an error message, or null when done. */
  substitute(team: 0 | 1, outId: string, inId: string): string | null {
    const side = this.sides[team];
    const waterIndex = side.water.findIndex((p) => p.id === outId);
    const incoming = side.bench.find((p) => p.id === inId);
    if (waterIndex < 0) return 'That player is not in the water.';
    if (!incoming) return 'That player is not on the bench.';
    if (side.fouledOut.has(inId)) return 'That player is out of the game.';
    if ((waterIndex === 0) !== (incoming.position === 'GK')) return 'Goalkeepers can only be replaced by goalkeepers.';
    if (side.excluded === outId) return 'An excluded player cannot be substituted until the exclusion ends.';
    this.swap(side, waterIndex, incoming, this.t);
    // The manager decides the shape: the slot now plays in the incoming player's position.
    side.slots[waterIndex] = incoming.position;
    return null;
  }

  /**
   * Bench players ranked by how well they would fill the given water slot right now
   * (rating in that role, out-of-position penalty, fitness). Best first.
   */
  recommendSubs(team: 0 | 1, outId: string): { id: string; score: number; role: Position }[] {
    const side = this.sides[team];
    const waterIndex = side.water.findIndex((p) => p.id === outId);
    if (waterIndex < 0) return [];
    const role = side.slots[waterIndex];
    return side.bench
      .filter((b) => !side.fouledOut.has(b.id) && (waterIndex === 0) === (b.position === 'GK'))
      .map((b) => ({ id: b.id, score: Math.round(this.subValue(side, b, waterIndex) * 10) / 10, role }))
      .sort((a, b) => b.score - a.score);
  }

  /** Everything a manager needs to decide the next move. */
  state(): LiveState {
    return {
      phase: this.phase,
      quarter: Math.min(this.quarter, 4),
      clock: Math.max(0, Math.round(T.quarterSeconds - this.t)),
      score: [...this.score],
      possession: this.poss,
      teams: this.sides.map((s) => ({
        water: s.water.map((p) => p.id),
        bench: s.bench.map((p) => p.id),
        fouls: Object.fromEntries(s.fouls),
        unavailable: [...s.fouledOut],
        timeouts: s.timeouts,
        pendingTimeout: s.pendingTimeout,
        autoSubs: s.autoSubs,
        tactics: { ...s.tactics },
      })),
      energy: Object.fromEntries([...this.energy].map(([id, e]) => [id, Math.round(e)])),
    };
  }

  /** The match so far (complete once finished). */
  result(): MatchResult {
    return {
      seed: this.seed,
      teams: this.teams,
      score: [...this.score],
      quarterScores: [...this.quarterScores],
      shootout: this.shootoutTally,
      events: [...this.events],
      secondsPlayed: Object.fromEntries(this.seconds),
      energy: [...this.snapshots],
    };
  }

  private takeEvents() {
    const fresh = this.events.slice(this.delivered);
    this.delivered = this.events.length;
    return fresh;
  }

  private finish() {
    this.quarter = this.shootoutTally ? 5 : 4;
    this.emit({ type: 'full_time', team: 0 }, T.quarterSeconds);
    this.phase = 'finished';
  }

  private snapshot() {
    this.snapshots.push({ eventIndex: this.events.length, energy: Object.fromEntries([...this.energy].map(([id, e]) => [id, Math.round(e)])) });
  }

  /** Seconds since the start of the match. */
  private gameTime(t = this.t) {
    return (Math.min(this.quarter, 4) - 1) * T.quarterSeconds + t;
  }

  // ---------------------------------------------------------------- possession

  private possession() {
    const t = this.t;
    const att = this.sides[this.poss];
    const def = this.sides[1 - this.poss];
    const remaining = T.quarterSeconds - t;
    if (this.quarter === 4 && remaining <= T.coachLateCheck && !this.lateCoachDone) {
      this.lateCoachDone = true;
      for (const side of this.sides) this.coach(side, t);
    }
    for (const side of this.sides) if (side.autoSubs) this.rollingSubs(side, t);
    if (att.pendingTimeout) this.takeTimeout(att, t);
    else if (!att.managed) this.maybeTimeout(att, remaining, t);

    // A team that is a man down after a brutality defends every possession short-handed.
    const shortHanded = this.field(def).length < 6;
    const res: PossessionResult = shortHanded
      ? this.powerPlay(att, def, t, remaining)
      : this.transition !== 'restart' && this.rng.chance(this.counterChance(att, def, this.transition))
        ? this.counter(att, def, t, remaining)
        : this.setPossession(att, def, t, remaining);

    this.timeoutBoost[att.idx] = 0;
    def.excluded = undefined;
    // Swimming back into position after a change of possession (not after a counter).
    const swim = res.transition === 'restart' ? 0 : this.rng.range(2, 5);
    const elapsed = Math.min(res.elapsed + swim, T.quarterSeconds - t);
    this.applyFatigue(elapsed);
    this.t = t + elapsed;
    if (this.injuriesOn) for (const side of this.sides) this.maybeInjury(side, elapsed);
    for (const side of this.sides) this.replaceFouledOut(side, this.t);
    this.poss = (1 - this.poss) as 0 | 1;
    this.transition = res.transition;
    this.snapshot();
  }

  /** Swim-off at the start of each quarter. Returns the team that wins the ball. */
  private sprint(): 0 | 1 {
    const sprinters = this.sides.map((s) =>
      this.field(s).reduce((a, b) => (this.eff(b, 'speed') > this.eff(a, 'speed') ? b : a)),
    );
    const v = sprinters.map((p) => this.eff(p, 'speed') + this.rng.range(-3, 3));
    const winner: 0 | 1 = v[0] >= v[1] ? 0 : 1;
    this.emit({ type: 'sprint', team: winner, player: sprinters[winner].id, other: sprinters[1 - winner].id }, 0);
    return winner;
  }

  // ------------------------------------------------------------ possessions

  private setPossession(att: Side, def: Side, start: number, remaining: number): PossessionResult {
    const D = T.defense[def.tactics.defense];
    const front = def.tactics.frontCenter;
    const center = this.findRole(att, 'CENTER', 'wrestling');
    const cdef = this.findRole(def, 'CDEF', 'wrestling');

    // The 2m battle: positive favours the attacking center.
    const battle =
      (this.eff(center, 'wrestling') + this.eff(center, 'legStrength') - this.eff(cdef, 'wrestling') - this.eff(cdef, 'legStrength')) / 40;
    const iqEdge = (avg(this.field(att).map((p) => this.eff(p, 'gameIQ'))) - avg(this.field(def).map((p) => this.eff(p, 'positioning')))) / 20;
    const passEdge = (avg(this.field(def).map((p) => this.eff(p, 'positioning'))) - avg(this.field(att).map((p) => this.eff(p, 'passing')))) / 20;

    const pExclusion = T.exclusionChance * D.exclusion * (front ? T.frontCenterExclusion : 1) * (1 + battle * T.centerBattleWeight) * (1 + iqEdge * 0.5);
    const pPenalty = T.penaltyChance * (def.tactics.defense === 'press' ? 1.15 : 1);
    const pTurnover = T.turnoverChance * D.turnover * (1 + passEdge * 0.8);
    const pShotClock = T.shotClockChance * D.shotClock;

    let duration = this.rng.range(T.possessionMinSeconds, T.possessionMaxSeconds);
    if (def.tactics.defense === 'zone') duration += T.zoneExtraSeconds;
    // Second half: a leading team works the shot clock, a trailing team hurries.
    const lead = this.lead(att);
    if (this.quarter >= 3) duration += clamp(lead, -T.leadTempoMaxGoals, T.leadTempoMaxGoals) * T.leadTempoSeconds;
    duration = Math.min(duration, T.shotClock);
    // Ahead in the last possession of the match: run out the clock.
    if (this.quarter === 4 && lead > 0 && remaining <= T.shotClock && this.rng.chance(T.holdBallChance)) {
      return this.buzzer(att, def, start, remaining);
    }

    if (this.rng.chance(T.brutalityChance)) {
      const at = this.rng.range(3, Math.min(duration, 25));
      if (at < remaining) return this.brutality(att, def, start + at, at);
    }

    const r = this.rng.next();
    let cut = pExclusion;
    if (r < cut) {
      const at = this.rng.range(4, Math.min(duration, 25));
      if (at >= remaining) return this.buzzer(att, def, start, remaining);
      const twoMeter = this.rng.chance(clamp(T.centerExclusionShare * (1 + battle), 0.15, 0.65));
      const drawnBy = twoMeter ? center : this.pickBy(this.field(att), (p) => this.eff(p, 'speed') + this.eff(p, 'gameIQ'));
      // At 2m the foul usually falls on the center-defender, but teams switch who guards the center.
      const committedBy =
        twoMeter && this.rng.chance(T.twoMeterDefenderShare * this.foulCaution(def, cdef))
          ? cdef
          : this.pickBy(this.field(def), (p) => (22 - this.eff(p, 'positioning')) * this.foulCaution(def, p));
      this.personalFoul(def, committedBy, 'exclusion', att, drawnBy, start + at);
      const pp = this.powerPlay(att, def, start + at, remaining - at);
      return { elapsed: at + pp.elapsed, transition: pp.transition };
    }
    if (r < (cut += pPenalty)) {
      const at = this.rng.range(4, duration);
      if (at >= remaining) return this.buzzer(att, def, start, remaining);
      const drawnBy = this.pickBy(this.field(att), (p) => this.eff(p, 'gameIQ') + (p.position === 'CENTER' ? 8 : 0));
      const fouler = drawnBy.position === 'CENTER' ? cdef : this.rng.pick(this.field(def));
      this.personalFoul(def, fouler, 'penalty_awarded', att, drawnBy, start + at);
      return { elapsed: at, transition: this.penalty(att, def, start + at) };
    }
    if (r < (cut += pTurnover)) {
      const at = this.rng.range(3, duration);
      if (at >= remaining) return this.buzzer(att, def, start, remaining);
      if (this.rng.chance(T.offensiveFoulShare)) {
        this.emit({ type: 'offensive_foul', team: att.idx, player: center.id, other: cdef.id }, start + at);
        return { elapsed: at, transition: 'counter' };
      }
      const loser = this.pickBy(this.field(att), (p) => 22 - this.eff(p, 'passing'));
      const stealer = this.rng.chance(0.6) ? this.pickBy(this.field(def), (p) => this.eff(p, 'positioning')) : undefined;
      this.emit({ type: 'turnover', team: att.idx, player: loser.id, other: stealer?.id }, start + at);
      return { elapsed: at, transition: stealer ? 'steal' : 'counter' };
    }
    if (r < (cut += pShotClock)) {
      if (T.shotClock >= remaining) return this.buzzer(att, def, start, remaining);
      this.emit({ type: 'shot_clock', team: att.idx }, start + T.shotClock);
      return { elapsed: T.shotClock, transition: 'counter' };
    }

    if (duration >= remaining) return this.buzzer(att, def, start, remaining);
    const shooter = this.pickShooter(att, 'even');
    const base = T.evenShotGoal * D.shotGoal * (front ? T.frontCenterShotGoal : 1);
    const outcome = this.shot(att, def, shooter, start + duration, base, 'even');
    return { elapsed: duration, transition: outcome === 'goal' ? 'restart' : 'counter' };
  }

  /**
   * Brutality: the offender is sent off for the rest of the match, the opponents get a penalty,
   * and the team plays a man down for 4 minutes before a substitute may come in.
   */
  private brutality(att: Side, def: Side, at: number, elapsed: number): PossessionResult {
    const offender = this.pickBy(this.field(def), (p) => 22 - this.eff(p, 'gameIQ'));
    const victim = this.pickBy(this.field(att), () => 1);
    this.emit({ type: 'brutality', team: att.idx, player: victim.id, other: offender.id }, at);
    def.fouledOut.add(offender.id);
    def.sentOff = { id: offender.id, until: this.gameTime(at) + T.brutalitySeconds };
    return { elapsed, transition: this.penalty(att, def, at) };
  }

  /** 6 on 5 after an exclusion. */
  private powerPlay(att: Side, def: Side, start: number, remaining: number): PossessionResult {
    const duration = this.rng.range(T.powerPlayMinSeconds, T.powerPlayMaxSeconds);
    if (duration >= remaining) return this.buzzer(att, def, start, remaining);

    if (this.rng.chance(T.powerPlayTurnover)) {
      const loser = this.pickBy(this.field(att), (p) => 22 - this.eff(p, 'passing'));
      this.emit({ type: 'turnover', team: att.idx, player: loser.id, situation: 'powerplay' }, start + duration);
      return { elapsed: duration, transition: 'counter' };
    }

    const field = this.field(att);
    const shooting = (p: Player) => (this.eff(p, 'shootingPower') + this.eff(p, 'shootingAccuracy')) / 2;
    let fit: number;
    if (att.tactics.powerPlay === '4-2') {
      // Four perimeter shooters: reward the team's best shooters.
      fit = avg(field.map(shooting).sort((a, b) => b - a).slice(0, 4)) - 12;
    } else {
      // 3-3: two posts and quick passing.
      const passing = avg(field.map((p) => this.eff(p, 'passing')).sort((a, b) => b - a).slice(0, 3));
      const posts = avg(field.map((p) => this.eff(p, 'wrestling') + this.eff(p, 'legStrength')).sort((a, b) => b - a).slice(0, 2)) / 2;
      fit = (passing + posts) / 2 - 12;
    }
    const lefty = field.some((p) => this.rightLefty(att, p)) ? T.rightLeftyPowerPlay : 0;
    const base = T.powerPlayShotGoal + fit * T.formationFitWeight + lefty;
    const shooter = this.pickShooter(att, 'powerplay');
    const outcome = this.shot(att, def, shooter, start + duration, base, 'powerplay');
    return { elapsed: duration, transition: outcome === 'goal' ? 'restart' : 'counter' };
  }

  private counterChance(att: Side, def: Side, transition: Transition): number {
    const speed = avg(this.field(att).map((p) => this.eff(p, 'speed'))) - avg(this.field(def).map((p) => this.eff(p, 'speed')));
    return clamp(
      T.counterBase +
        T.counterPerAggression * (att.tactics.counterAggression - 3) +
        (transition === 'steal' ? T.counterAfterSteal : 0) +
        speed * T.counterSpeedWeight,
      0.02,
      0.6,
    );
  }

  private counter(att: Side, def: Side, start: number, remaining: number): PossessionResult {
    const leader = this.pickBy(this.field(att), (p) => this.eff(p, 'speed') ** 2);
    const duration = this.rng.range(4, 9);
    if (duration >= remaining) return this.buzzer(att, def, start, remaining);
    this.emit({ type: 'counter', team: att.idx, player: leader.id }, start + 1);

    const r = this.rng.next();
    if (r < T.counterExclusion) {
      const committedBy = this.pickBy(this.field(def), (p) => (22 - this.eff(p, 'speed')) * this.foulCaution(def, p));
      this.personalFoul(def, committedBy, 'exclusion', att, leader, start + duration);
      const pp = this.powerPlay(att, def, start + duration, remaining - duration);
      return { elapsed: duration + pp.elapsed, transition: pp.transition };
    }
    if (r < T.counterExclusion + T.counterPenalty) {
      const fouler = this.pickBy(this.field(def), (p) => 22 - this.eff(p, 'speed'));
      this.personalFoul(def, fouler, 'penalty_awarded', att, leader, start + duration);
      return { elapsed: duration, transition: this.penalty(att, def, start + duration) };
    }
    if (r < T.counterExclusion + T.counterPenalty + T.counterTurnover) {
      this.emit({ type: 'turnover', team: att.idx, player: leader.id, situation: 'counter' }, start + duration);
      return { elapsed: duration, transition: 'restart' };
    }
    const shooter = this.rng.chance(0.7) ? leader : this.pickShooter(att, 'even');
    const outcome = this.shot(att, def, shooter, start + duration, T.counterShotGoal, 'counter');
    return { elapsed: duration, transition: outcome === 'goal' ? 'restart' : 'counter' };
  }

  /** The quarter runs out mid-possession: a hopeful last shot, if there is time for one. */
  private buzzer(att: Side, def: Side, start: number, remaining: number): PossessionResult {
    if (remaining >= 3 && this.rng.chance(0.75)) {
      const shooter = this.pickShooter(att, 'even');
      this.shot(att, def, shooter, start + remaining - 0.5, T.buzzerShotGoal, 'buzzer');
    }
    return { elapsed: remaining, transition: 'restart' };
  }

  private penalty(att: Side, def: Side, at: number): Transition {
    const taker = this.penaltyTaker(att);
    const outcome = this.shot(att, def, taker, at, T.penaltyGoal, 'penalty');
    return outcome === 'goal' ? 'restart' : 'counter';
  }

  // ------------------------------------------------------------------ shots

  private shot(att: Side, def: Side, shooter: Player, at: number, base: number, situation: Situation): 'goal' | 'save' | 'miss' | 'block' {
    const keeper = def.water[0];
    const lefty = (situation === 'even' || situation === 'powerplay') && this.rightLefty(att, shooter) ? T.rightLeftyShotGoal : 0;
    const p = clamp(
      base +
        (this.shooterQuality(shooter) - this.keeperQuality(keeper)) * T.shooterVsKeeper +
        this.timeoutBoost[att.idx] +
        this.form[att.idx] -
        this.form[def.idx] * 0.5 +
        lefty +
        this.scoreEffect(att),
      0.04,
      0.93,
    );

    if (this.rng.chance(p)) {
      this.score[att.idx]++;
      att.concededRun = 0;
      def.concededRun++;
      const others = this.field(att).filter((x) => x !== shooter);
      const assisted = situation === 'even' || situation === 'powerplay' ? this.rng.chance(0.65) : situation === 'counter' && this.rng.chance(0.4);
      const assist = assisted ? this.pickBy(others, (x) => this.eff(x, 'passing')) : undefined;
      this.emit({ type: 'goal', team: att.idx, player: shooter.id, other: keeper.id, assist: assist?.id, situation }, at);
      return 'goal';
    }
    const r = this.rng.next();
    if (situation === 'penalty') {
      const saved = r < 0.7;
      this.emit({ type: saved ? 'save' : 'miss', team: att.idx, player: shooter.id, other: keeper.id, situation }, at);
      return saved ? 'save' : 'miss';
    }
    if (r < T.saveShare) {
      this.emit({ type: 'save', team: att.idx, player: shooter.id, other: keeper.id, situation }, at);
      return 'save';
    }
    if (r < T.saveShare + T.blockShare && situation !== 'counter') {
      const blocker = this.pickBy(this.field(def), (x) => this.eff(x, 'positioning'));
      this.emit({ type: 'block', team: att.idx, player: shooter.id, other: blocker.id, situation }, at);
      return 'block';
    }
    this.emit({ type: 'miss', team: att.idx, player: shooter.id, situation }, at);
    return 'miss';
  }

  private pickShooter(att: Side, situation: 'even' | 'powerplay'): Player {
    const posWeight: Record<Position, number> =
      situation === 'even'
        ? { GK: 0, CENTER: 1.1, CDEF: 0.7, DRIVER: 1.0, WING: 0.8, POINT: 1.0 }
        : att.tactics.powerPlay === '4-2'
          ? { GK: 0, CENTER: 0.6, CDEF: 0.6, DRIVER: 1.0, WING: 1.1, POINT: 1.1 }
          : { GK: 0, CENTER: 1.1, CDEF: 0.9, DRIVER: 1.0, WING: 0.9, POINT: 0.9 };
    const shooters = situation === 'powerplay' ? this.powerPlayShooters(att) : [];
    const leftyWeight = situation === 'powerplay' ? T.rightLeftyShooterWeight * 1.2 : T.rightLeftyShooterWeight;
    return this.pickBy(
      this.field(att),
      (p) =>
        posWeight[p.position] *
        this.shooterQuality(p) ** 1.5 *
        (shooters.includes(p) ? T.designatedShooterWeight : 1) *
        (this.rightLefty(att, p) ? leftyWeight : 1),
    );
  }

  /** The coach's named 6v5 shooters who are in play, or else the best shooters in the water. */
  private powerPlayShooters(side: Side): Player[] {
    const field = this.field(side);
    const named = field.filter((p) => side.tactics.powerPlayShooters?.includes(p.id));
    if (named.length) return named;
    return [...field].sort((a, b) => this.shooterQuality(b) - this.shooterQuality(a)).slice(0, T.designatedShooters);
  }

  private penaltyTaker(side: Side): Player {
    const field = this.field(side);
    const named = field.find((p) => p.id === side.tactics.penaltyTaker);
    return named ?? field.reduce((a, b) => (this.penaltySkill(b) > this.penaltySkill(a) ? b : a));
  }

  private penaltySkill(p: Player) {
    return this.shooterQuality(p) + this.eff(p, 'gameIQ') * 0.3;
  }

  private shooterQuality(p: Player) {
    return this.eff(p, 'shootingPower') * 0.45 + this.eff(p, 'shootingAccuracy') * 0.55;
  }

  private keeperQuality(p: Player) {
    return this.eff(p, 'reflexes') * 0.55 + this.eff(p, 'gkPositioning') * 0.45;
  }

  // ------------------------------------------------------- fouls and benches

  private personalFoul(def: Side, fouler: Player, type: 'exclusion' | 'penalty_awarded', att: Side, drawnBy: Player, at: number) {
    this.emit({ type, team: att.idx, player: drawnBy.id, other: fouler.id }, at);
    if (type === 'exclusion') def.excluded = fouler.id;
    const fouls = (def.fouls.get(fouler.id) ?? 0) + 1;
    def.fouls.set(fouler.id, fouls);
    if (fouls >= T.maxPersonalFouls) {
      def.fouledOut.add(fouler.id);
      this.emit({ type: 'fouled_out', team: def.idx, player: fouler.id }, at);
    }
  }

  /** Players with two fouls defend more carefully, so they commit fewer fouls. */
  private foulCaution(side: Side, p: Player) {
    const fouls = side.fouls.get(p.id) ?? 0;
    return fouls >= T.maxPersonalFouls - 1 ? T.foulTroubleCaution : 1;
  }

  private replaceFouledOut(side: Side, at: number) {
    side.water.forEach((p, i) => {
      if (!side.fouledOut.has(p.id)) return;
      if (side.sentOff?.id === p.id && this.gameTime(at) < side.sentOff.until) return;
      const options = side.bench.filter((b) => b.position !== 'GK' && !side.fouledOut.has(b.id));
      if (!options.length) return;
      const sub = options.reduce((a, b) => (this.subValue(side, b, i) > this.subValue(side, a, i) ? b : a));
      this.swap(side, i, sub, at);
    });
  }

  /**
   * Rolling substitutions. For every slot the coach compares how well the player
   * in the water would play right now with the best rested player on the bench.
   * A star stays in until fatigue really costs him and comes back once rested;
   * squad players rotate more freely.
   */
  private rollingSubs(side: Side, at: number) {
    let made = 0;
    for (let i = 1; i < side.water.length && made < T.maxSubsPerStoppage; i++) {
      const current = side.water[i];
      if (side.fouledOut.has(current.id)) continue;
      const options = side.bench.filter(
        (b) => b.position !== 'GK' && !side.fouledOut.has(b.id) && this.energy.get(b.id)! >= T.subMinBenchEnergy,
      );
      if (!options.length) continue;
      const sub = options.reduce((a, b) => (this.subValue(side, b, i) > this.subValue(side, a, i) ? b : a));
      const benchBoost = this.garbageTime(side) ? T.garbageTimeBenchBoost : 1;
      if (this.subValue(side, sub, i) * benchBoost <= this.subValue(side, current, i) * (1 + T.subMargin)) continue;
      this.swap(side, i, sub, at);
      made++;
    }
  }

  /** How well a player would fill water slot i right now, as the coach sees it. */
  private subValue(side: Side, p: Player, waterIndex: number) {
    const slot = side.slots[waterIndex];
    let value = overall(p, slot) * this.fitness(p);
    value *= positionFit(p.position, slot);
    if (RIGHT_SIDE.has(waterIndex) && p.hand === 'L') value += T.rightLeftyLineupBonus;
    // Everyone gets some minutes: a bench player who has barely played looks a little more attractive.
    if (side.bench.includes(p) && this.quarter >= 2) value *= 1 + T.rotationBonus * Math.max(0, 1 - this.seconds.get(p.id)! / T.rotationTargetSeconds);
    // Protect a player on two fouls for the 4th quarter, unless the team needs him now.
    if ((side.fouls.get(p.id) ?? 0) === T.maxPersonalFouls - 1 && this.quarter <= 3 && this.lead(side) >= 0) value *= T.foulTroubleBench;
    return value;
  }

  /** Comfortably ahead in the second half: rest the starters. */
  private garbageTime(side: Side) {
    return this.quarter >= 3 && this.lead(side) >= T.garbageTimeLead;
  }

  private swap(side: Side, waterIndex: number, incoming: Player, at: number) {
    const outgoing = side.water[waterIndex];
    side.water[waterIndex] = incoming;
    side.bench.splice(side.bench.indexOf(incoming), 1, outgoing);
    this.emit({ type: 'sub', team: side.idx, player: incoming.id, other: outgoing.id }, at);
  }

  /** Only the team in possession can call a timeout. */
  private maybeTimeout(side: Side, remaining: number, at: number) {
    if (side.timeouts === 0) return;
    const diff = this.lead(side);
    const q4 = this.quarter === 4;
    // Last chance to tie or win: draw up a set play.
    const lastChance = q4 && remaining < 40 && diff <= 0 && diff >= -1;
    // In the last 40 seconds a timeout is only worth it for a set play to tie or win.
    const lateAndClose = q4 && remaining < 150 && remaining >= 40 && diff <= 0 && diff >= -2;
    // Stop an opponent's run, but keep one timeout for the end unless it is already the 4th quarter.
    const stopTheRun = side.concededRun >= T.timeoutRun && (side.timeouts > 1 || q4) && diff <= 2 && !(q4 && remaining < 40);
    const chance = lastChance ? T.timeoutLastChance : lateAndClose ? T.timeoutLateClose : stopTheRun ? T.timeoutStopRun : 0;
    if (!this.rng.chance(chance)) return;
    this.takeTimeout(side, at);
  }

  private takeTimeout(side: Side, at: number) {
    side.pendingTimeout = false;
    if (side.timeouts === 0) return;
    side.timeouts--;
    side.concededRun = 0;
    this.timeoutBoost[side.idx] = T.timeoutBoost;
    for (const p of side.water) this.energy.set(p.id, Math.min(100, this.energy.get(p.id)! + 4));
    this.emit({ type: 'timeout', team: side.idx }, at);
  }

  // ---------------------------------------------------------------- coach

  /**
   * The AI coach reacts to the score: a trailing team presses and breaks harder,
   * a team protecting a big 4th-quarter lead stops gambling on counters, and once
   * the game is close again the coach goes back to the original plan.
   */
  private coach(side: Side, at = 0) {
    if (!side.aiCoach) return;
    const base = side.team.tactics;
    const diff = this.lead(side);
    const next: Tactics = { ...side.tactics, defense: base.defense, counterAggression: base.counterAggression };
    if (-diff >= T.coachPressDeficit[this.quarter - 1]) {
      next.defense = 'press';
      next.counterAggression = Math.min(5, base.counterAggression + (-diff >= 5 ? 2 : 1));
    } else if (this.quarter === 4 && diff >= T.coachProtectLead) {
      next.counterAggression = Math.max(1, base.counterAggression - 1);
    }
    const changed: Partial<Tactics> = {};
    if (next.defense !== side.tactics.defense) changed.defense = next.defense;
    if (next.counterAggression !== side.tactics.counterAggression) changed.counterAggression = next.counterAggression;
    if (!Object.keys(changed).length) return;
    side.tactics = next;
    this.emit({ type: 'tactics', team: side.idx, tactics: changed }, at);
  }

  /** Goals ahead (negative when behind). */
  private lead(side: Side) {
    return this.score[side.idx] - this.score[1 - side.idx];
  }

  /** Trailing teams push, leading teams ease off: added goal chance for the attacking side. */
  private scoreEffect(att: Side) {
    const deficit = clamp(-this.lead(att), -T.scoreEffectMaxGoals, T.scoreEffectMaxGoals);
    return deficit * T.scoreEffectPerGoal * T.scoreEffectByQuarter[this.quarter - 1];
  }

  /** A left-hander playing on the right side (right wing or right driver). */
  private rightLefty(side: Side, p: Player) {
    return p.hand === 'L' && RIGHT_SIDE.has(side.water.indexOf(p));
  }

  /** A player in the water may get injured; tired players are more at risk. They leave the match for good. */
  private maybeInjury(side: Side, seconds: number) {
    for (const p of this.field(side)) {
      const tiredness = 1 + (100 - this.energy.get(p.id)!) / T.injuryFatigueScale;
      if (!this.rng.chance(T.injuryPerSecond * seconds * tiredness)) continue;
      side.fouledOut.add(p.id);
      this.emit({ type: 'injury', team: side.idx, player: p.id }, this.t);
      return; // at most one per possession
    }
  }

  private applyFatigue(seconds: number) {
    for (const side of this.sides) {
      for (const p of side.water) {
        const drain = seconds * T.drainPerSecond * (1.6 - p.attrs.stamina / 20) * (p.position === 'GK' ? T.goalkeeperDrainFactor : 1);
        this.energy.set(p.id, Math.max(0, this.energy.get(p.id)! - drain));
        this.seconds.set(p.id, this.seconds.get(p.id)! + seconds);
      }
      for (const p of side.bench) this.energy.set(p.id, Math.min(100, this.energy.get(p.id)! + seconds * T.recoverPerSecond));
    }
  }

  private quarterBreak() {
    for (const [id, e] of this.energy) this.energy.set(id, Math.min(100, e + T.quarterBreakRecovery));
  }

  // ------------------------------------------------------------- shootout

  private shootout(): [number, number] {
    this.quarter = 5;
    const tally: [number, number] = [0, 0];
    const takers = this.sides.map((s) =>
      s.team.players
        .filter((p) => p.position !== 'GK' && !s.fouledOut.has(p.id))
        .sort((a, b) => this.penaltySkill(b) - this.penaltySkill(a))
        .sort((a, b) => Number(b.id === s.tactics.penaltyTaker) - Number(a.id === s.tactics.penaltyTaker)),
    );
    const kick = (side: 0 | 1, round: number) => {
      const shooter = takers[side][round % takers[side].length];
      const keeper = this.sides[1 - side].water[0];
      const p = clamp(T.penaltyGoal + (this.shooterQuality(shooter) - this.keeperQuality(keeper)) * T.shooterVsKeeper, 0.3, 0.95);
      const goal = this.rng.chance(p);
      if (goal) tally[side]++;
      const type = goal ? 'goal' : this.rng.chance(0.7) ? 'save' : 'miss';
      this.emit({ type, team: side, player: shooter.id, other: keeper.id, situation: 'shootout' }, T.quarterSeconds);
    };
    for (let round = 0; round < 5; round++) {
      kick(0, round);
      // Stop as soon as one side can no longer be caught.
      if (tally[0] - tally[1] > 5 - round || tally[1] - tally[0] > 4 - round) break;
      kick(1, round);
      const left = 4 - round;
      if (Math.abs(tally[0] - tally[1]) > left) break;
    }
    for (let round = 5; tally[0] === tally[1]; round++) {
      kick(0, round);
      kick(1, round);
    }
    return tally;
  }

  // -------------------------------------------------------------- helpers

  /** Field players currently in play (not sitting out an exclusion or fouled out). */
  private field(side: Side) {
    return side.water.slice(1).filter((p) => p.id !== side.excluded && !side.fouledOut.has(p.id));
  }

  private findRole(side: Side, position: Position, fallback: keyof Attributes): Player {
    const field = this.field(side);
    return field.find((p) => p.position === position) ?? field.reduce((a, b) => (b.attrs[fallback] > a.attrs[fallback] ? b : a));
  }

  /** Share of their attributes a player can use at their current energy. */
  private fitness(p: Player) {
    return T.fatigueAttributeFloor + (1 - T.fatigueAttributeFloor) * (this.energy.get(p.id)! / 100);
  }

  /** Attribute value adjusted for the player's current energy. */
  private eff(p: Player, key: keyof Attributes) {
    return p.attrs[key] * this.fitness(p);
  }

  private pickBy(players: Player[], weight: (p: Player) => number) {
    return this.rng.weighted(players, weight);
  }

  private emit(e: Omit<MatchEvent, 'quarter' | 'clock' | 'score'>, at: number) {
    this.events.push({
      ...e,
      quarter: this.quarter,
      clock: Math.max(0, Math.round(T.quarterSeconds - at)),
      score: [...this.score],
    });
  }
}

export function simulateMatch(home: Team, away: Team, options: MatchOptions = {}): MatchResult {
  const match = new LiveMatch([home, away], options);
  while (!match.finished) match.step();
  return match.result();
}
