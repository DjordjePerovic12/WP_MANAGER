// Contracts and club finances. Amounts are euros per year (wages) or euros (balances).
// The scale is water polo, not football: a top club's whole wage bill is around a million.

import { createRng, type Rng } from '../engine/rng';
import { overall, teamRating } from '../engine/ratings';
import type { Player, Team } from '../engine/types';
import { personalityOf, type Personality } from './training';

export interface Contract {
  /** euros per year */
  wage: number;
  /** start year of the last season covered: 2027 means the contract runs through 2027-28 */
  until: number;
}

export interface LedgerEntry {
  round: number;
  label: string;
  amount: number;
}

export interface SeasonFinance {
  season: string;
  income: number;
  wages: number;
  prizeMoney: number;
  balanceChange: number;
}

export interface ClubFinances {
  /** money in the bank (transfer funds) */
  balance: number;
  /** the club's yearly income from sponsors, tickets and the like */
  revenue: number;
  /** the most the board lets the club spend on wages per year */
  wageBudget: number;
  /** this season's money in and out (managed club) */
  ledger: LedgerEntry[];
  lastSeason?: SeasonFinance;
}

export interface FreeAgent {
  player: Player;
  potential: number;
  fromClubId: string;
  /** wage he wants per year */
  askingWage: number;
}

const round1000 = (v: number) => Math.round(v / 1000) * 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Market value: ability (steeply), age and room to grow. */
export function playerValue(p: Player, potential = overall(p)): number {
  const ovr = overall(p);
  const base = 15000 * Math.pow(1.55, ovr - 10);
  const age = p.age <= 21 ? 1.3 : p.age <= 27 ? 1.1 : p.age <= 30 ? 0.9 : p.age <= 32 ? 0.6 : 0.3;
  const growth = 1 + Math.max(0, potential - ovr) * 0.15;
  return Math.max(5000, round1000(base * age * growth));
}

/** What a player expects to earn per year. */
export function expectedWage(p: Player, potential = overall(p)): number {
  const ovr = overall(p);
  // Wages follow current ability more than market value: established players earn the most.
  const wage = 6000 * Math.pow(1.5, ovr - 10) * (p.age <= 20 ? 0.6 : 1);
  return Math.max(3000, round1000(wage + Math.max(0, potential - ovr) * 1000));
}

/** Contracts for every player at the start of a career. */
export function initialContracts(teams: Team[], seed: number, year: number, potential: Record<string, number>): Record<string, Contract> {
  const rng = createRng((seed ^ 0xc0ffee) >>> 0);
  const contracts: Record<string, Contract> = {};
  for (const t of teams) for (const p of t.players) contracts[p.id] = newContract(p, potential[p.id], year, rng);
  return contracts;
}

function newContract(p: Player, potential: number | undefined, year: number, rng: Rng): Contract {
  const years = p.age >= 32 ? rng.int(0, 1) : p.age <= 21 ? rng.int(1, 3) : rng.int(0, 3);
  return { wage: round1000(expectedWage(p, potential) * rng.range(0.85, 1.15)), until: year + years };
}

export const wageBill = (team: Team, contracts: Record<string, Contract>) => team.players.reduce((s, p) => s + (contracts[p.id]?.wage ?? 0), 0);

/** Starting finances: income a little above the wage bill, some money in the bank. */
export function initialFinances(teams: Team[], contracts: Record<string, Contract>, seed: number): Record<string, ClubFinances> {
  const rng = createRng((seed ^ 0xf1a4) >>> 0);
  return Object.fromEntries(
    teams.map((t) => {
      const bill = wageBill(t, contracts);
      const revenue = round1000(bill * rng.range(1.1, 1.3));
      return [t.id, { balance: round1000(revenue * rng.range(0.2, 0.45)), revenue, wageBudget: round1000(Math.max(bill * 1.05, revenue * 0.92)), ledger: [] }];
    }),
  );
}

/** Wages and income for one round (a share of the yearly figures). */
export function roundFinances(f: ClubFinances, team: Team, contracts: Record<string, Contract>, round: number, rounds: number, managed: boolean): ClubFinances {
  const wages = Math.round(wageBill(team, contracts) / rounds);
  const income = Math.round((f.revenue * 0.85) / rounds);
  const ledger = managed ? [...f.ledger, { round, label: 'Sponsors & tickets', amount: income }, { round, label: 'Wages', amount: -wages }] : f.ledger;
  return { ...f, balance: f.balance + income - wages, ledger };
}

/** Prize money: the rest of the year's income, more for clubs higher up the table. */
export function prizeMoney(revenue: number, position: number, clubs: number) {
  const share = 0.05 + 0.25 * ((clubs - position) / Math.max(1, clubs - 1));
  return round1000(revenue * share);
}

/** The board's budget for next season: better than expected → more money. */
export function nextBudget(f: ClubFinances, position: number, expected: number, bill: number): { revenue: number; wageBudget: number } {
  const factor = clamp(1 + (expected - position) * 0.03, 0.88, 1.15);
  const revenue = round1000(f.revenue * factor);
  // A club deep in debt has to cut its wage budget.
  const debtCut = f.balance < 0 ? clamp(1 + f.balance / revenue, 0.75, 1) : 1;
  return { revenue, wageBudget: round1000(Math.max(revenue * 0.92 * debtCut, Math.min(bill, revenue))) };
}

// ---------------------------------------------------------------- renewals

export interface RenewalDemand {
  wage: number;
  years: number;
  /** how the player feels about staying */
  mood: 'keen' | 'open' | 'reluctant';
}

/**
 * What a player wants to extend his contract. Ambitious players ask more; players
 * who barely play are reluctant; veterans want short deals, young players longer ones.
 */
export function renewalDemand(p: Player, potential: number, seed: number, minutesShare: number): RenewalDemand {
  const personality: Personality = personalityOf(seed, p.id);
  const base = expectedWage(p, potential);
  const greed = personality === 'ambitious' ? 1.2 : personality === 'professional' ? 1.0 : personality === 'lazy' ? 0.95 : personality === 'temperamental' ? 1.12 : 1.03;
  const unhappy = minutesShare < 0.25 && overall(p) > 11 ? 1.15 : 1;
  const mood: RenewalDemand['mood'] = unhappy > 1 ? 'reluctant' : personality === 'professional' || personality === 'steady' ? 'keen' : 'open';
  const years = p.age >= 31 ? 1 : p.age >= 28 ? 2 : p.age <= 22 ? 4 : 3;
  return { wage: round1000(base * greed * unhappy), years, mood };
}

/**
 * The player's answer to an offer. Meeting his demand always works; offering less
 * can still work (more likely for keen players and longer deals), but may be refused.
 */
export function respondToOffer(demand: RenewalDemand, offerWage: number, offerYears: number, rng: Rng): { accepted: boolean; message: string } {
  const ratio = offerWage / demand.wage;
  if (ratio >= 1) return { accepted: true, message: 'He signs: happy with the new deal.' };
  const tolerance = demand.mood === 'keen' ? 0.12 : demand.mood === 'open' ? 0.07 : 0.02;
  const yearsBonus = offerYears >= demand.years ? 0.02 : -0.03;
  const chance = clamp((ratio - (1 - tolerance - yearsBonus)) / (tolerance + 0.05), 0, 0.95);
  if (rng.chance(chance)) return { accepted: true, message: 'After some talks, he accepts.' };
  return { accepted: false, message: ratio < 0.85 ? 'He feels insulted by the offer.' : 'He turns it down; he wants closer to his asking wage.' };
}

/** Should an AI club keep a player whose contract ends? Useful and young players, yes. */
export function aiRenews(p: Player, team: Team, rng: Rng): boolean {
  const level = teamRating(team.players);
  const useful = overall(p) >= level - 1.5 || p.age <= 23;
  return useful ? rng.chance(0.88) : rng.chance(0.3);
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const a = Math.abs(amount);
  if (a >= 1_000_000) return `${sign}€${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 2)}M`;
  if (a >= 1000) return `${sign}€${Math.round(a / 1000)}k`;
  return `${sign}€${Math.round(a)}`;
}

export { newContract };
