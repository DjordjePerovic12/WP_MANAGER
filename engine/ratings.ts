import type { Attributes, Player, Position } from './types';

type Weights = Partial<Record<keyof Attributes, number>>;

/** How much each attribute matters for each position (each row sums to 1). */
export const POSITION_WEIGHTS: Record<Position, Weights> = {
  GK: { reflexes: 0.45, gkPositioning: 0.35, legStrength: 0.1, gameIQ: 0.1 },
  CENTER: { wrestling: 0.3, legStrength: 0.25, shootingAccuracy: 0.15, shootingPower: 0.1, gameIQ: 0.1, stamina: 0.1 },
  CDEF: { wrestling: 0.3, legStrength: 0.25, positioning: 0.25, gameIQ: 0.1, stamina: 0.1 },
  DRIVER: { speed: 0.25, shootingPower: 0.15, shootingAccuracy: 0.15, gameIQ: 0.15, passing: 0.1, stamina: 0.1, positioning: 0.1 },
  WING: { shootingAccuracy: 0.25, speed: 0.2, shootingPower: 0.15, passing: 0.15, gameIQ: 0.15, stamina: 0.1 },
  POINT: { passing: 0.25, shootingPower: 0.25, gameIQ: 0.2, shootingAccuracy: 0.15, positioning: 0.15 },
};

export function weightedRating(attrs: Attributes, weights: Weights): number {
  let total = 0;
  for (const [key, w] of Object.entries(weights)) total += attrs[key as keyof Attributes] * (w ?? 0);
  return total;
}

/** Overall rating (1–20) of a player in a given position (defaults to their own). */
export function overall(player: Player, position: Position = player.position): number {
  return weightedRating(player.attrs, POSITION_WEIGHTS[position]);
}

export function teamRating(players: Player[]): number {
  const best = [...players].sort((a, b) => overall(b) - overall(a)).slice(0, 9);
  return best.reduce((s, p) => s + overall(p), 0) / best.length;
}
