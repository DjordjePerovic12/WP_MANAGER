// Clean, source-independent shapes for real-world data.
// Everything the server and game use comes from these, not from raw source formats.

import type { Hand, Position } from '../engine/types';

export interface Competition {
  id: string;            // e.g. "EA-1" (European Aquatics Champions League)
  name: string;
  tier: number;          // 1 = strongest
}

export interface Club {
  id: string;            // e.g. "EA-BRE"
  name: string;
  shortName: string;
  country: string;       // IOC code
  competitions: string[];
}

export interface RealPlayer {
  id: string;            // e.g. "EA-P12183"
  firstName: string;
  lastName: string;
  birthDate?: string;    // ISO yyyy-mm-dd
  nationality?: string;
  clubId: string;
  cap?: number;
  heightCm?: number;
  hand?: Hand;
  position: Position;
  /** official = from the source; inferred = from the player's stats; default = no information */
  positionSource: 'official' | 'inferred' | 'default';
}

export interface RealMatch {
  id: string;
  competitionId: string;
  round: string;
  date: string;          // ISO yyyy-mm-dd
  venue: string;
  homeId: string;
  awayId: string;
  score: [number, number];
  periods: [number, number][];
}

/** goals / attempts */
export type Shots = [number, number];

export interface PlayerMatchLine {
  matchId: string;
  playerId: string;
  clubId: string;
  cap: number;
  shots: { action: Shots; center: Shots; extra: Shots; sixMeter: Shots; penalty: Shots; counter: Shots; total: Shots };
  assists: number;
  turnovers: number;
  steals: number;
  blocks: number;
  sprints: [number, number];      // won / taken
  exclusionsCenter: number;       // committed at 2m
  exclusionsField: number;        // committed elsewhere
  penaltyFouls: number;
  fouledOut: boolean;
}

export interface GoalkeeperMatchLine {
  matchId: string;
  playerId: string;
  clubId: string;
  saves: number;
  shotsFaced: number;
}

export interface TeamMatchLine {
  matchId: string;
  clubId: string;
  opponentId: string;
  goals: number;
  shots: PlayerMatchLine['shots'];
  assists: number;
  turnovers: number;
  steals: number;
  blocks: number;
  exclusionsCommitted: number;
  penaltyFouls: number;
  saves: number;
}

export interface DataSet {
  source: string;
  season: string;
  fetchedAt: string;
  competitions: Competition[];
  clubs: Club[];
  players: RealPlayer[];
  matches: RealMatch[];
  playerLines: PlayerMatchLine[];
  goalkeeperLines: GoalkeeperMatchLine[];
  teamLines: TeamMatchLine[];
}
