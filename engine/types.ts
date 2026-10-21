// Core data model for the water polo match engine.
// Everything here is plain data so it can be saved, sent over the network or
// shared with a future mobile app.

export type Position = 'GK' | 'CENTER' | 'CDEF' | 'DRIVER' | 'WING' | 'POINT';
export type Hand = 'L' | 'R';

/** All attributes are on a 1–20 scale, like Football Manager. */
export interface Attributes {
  speed: number;            // swimming speed: sprints, counters
  stamina: number;          // how fast energy drains
  shootingPower: number;
  shootingAccuracy: number;
  passing: number;
  legStrength: number;      // eggbeater: holding position, lifting for shots
  wrestling: number;        // physical battle at 2m
  positioning: number;      // defensive reading, steals, blocks
  gameIQ: number;           // decisions, drawing exclusions, avoiding turnovers
  reflexes: number;         // goalkeepers
  gkPositioning: number;    // goalkeepers
}

export interface Player {
  id: string;
  name: string;
  cap: number;              // cap number 1–14
  position: Position;
  hand: Hand;
  age: number;
  attrs: Attributes;
}

export type DefenseSystem = 'press' | 'zone' | 'mdrop';
export type PowerPlaySetup = '4-2' | '3-3';

export interface Tactics {
  /** press = man-to-man pressure, zone = sag back, mdrop = drop a player onto the center */
  defense: DefenseSystem;
  /** Front the opposing center (deny the 2m entry pass) */
  frontCenter: boolean;
  /** 1 (never leave early) .. 5 (counter at every chance) */
  counterAggression: number;
  powerPlay: PowerPlaySetup;
  /** Designated 6v5 shooters (player ids). Unset or empty = picked automatically from shooting attributes. */
  powerPlayShooters?: string[];
  /** Designated penalty taker (player id). Unset = the best penalty shooter in the water. */
  penaltyTaker?: string;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  players: Player[];
  tactics: Tactics;
}

export type Situation = 'even' | 'powerplay' | 'counter' | 'penalty' | 'buzzer' | 'shootout';

export type EventType =
  | 'quarter_start'
  | 'quarter_end'
  | 'full_time'
  | 'sprint'
  | 'goal'
  | 'save'
  | 'miss'
  | 'block'
  | 'turnover'
  | 'offensive_foul'
  | 'shot_clock'
  | 'exclusion'
  | 'penalty_awarded'
  | 'fouled_out'
  | 'counter'
  | 'timeout'
  | 'sub'
  | 'tactics'
  | 'brutality';

export interface MatchEvent {
  quarter: number;          // 1–4, 5 = penalty shootout
  clock: number;            // seconds remaining in the quarter
  type: EventType;
  team: 0 | 1;              // the team the event belongs to (the acting side)
  player?: string;          // main actor (shooter, player who drew the exclusion, player coming on…)
  other?: string;           // second actor (goalkeeper, excluded defender, player going off…)
  assist?: string;
  situation?: Situation;
  /** For 'brutality' events, player is the victim and other the offender (sent off for the rest of the match). */
  /** For 'tactics' events: the tactics the coach changed. */
  tactics?: Partial<Tactics>;
  score: [number, number];  // score after this event
}

export interface MatchOptions {
  seed?: number;
  /** Decide a drawn match with a penalty shootout (default true, as in European club competitions) */
  shootoutOnDraw?: boolean;
  /**
   * Let the AI coach change defense and counter aggression during the match in response to the score.
   * One flag for both teams or [home, away]. Defaults to true; set false for a team the user manages.
   */
  aiCoach?: boolean | [boolean, boolean];
  /**
   * Teams run by a human manager: [home, away]. A managed team gets no AI coach and no automatic
   * timeouts; its manager uses LiveMatch.setTactics / callTimeout / substitute instead.
   */
  managed?: [boolean, boolean];
  /** Let the assistant coach make rolling substitutions for managed teams (default true). */
  autoSubs?: boolean;
}

/** Energy (0–100) of every player at a point in the match, recorded after each possession. */
export interface EnergySnapshot {
  /** number of events emitted when the snapshot was taken (applies from events[eventIndex - 1] on) */
  eventIndex: number;
  energy: Record<string, number>;
}

export interface MatchResult {
  seed: number;
  teams: [Team, Team];
  score: [number, number];
  quarterScores: [number, number][];
  shootout?: [number, number];
  events: MatchEvent[];
  /** seconds each player spent in the water */
  secondsPlayed: Record<string, number>;
  /** energy of every player over the match, for fatigue displays */
  energy?: EnergySnapshot[];
}
