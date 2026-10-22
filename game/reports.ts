// Detailed reports to help the manager decide: should we sign this player, and
// should we keep, renew or sell one of ours? Everything is based on what the
// club knows (scouting ranges for other clubs' players), never the hidden truth.

import { overall, POSITION_WEIGHTS, teamRating } from '../engine/ratings';
import type { Attributes, Player, Position } from '../engine/types';
import { averageRating, contractDemand, seasonYear, wageRoom, type CareerState, type PlayerSeason } from './career';
import { expectedWage, playerValue } from './finance';
import { playerView, type PlayerView } from './scouting';
import { ATTRIBUTE_LABELS } from './squad';
import { happinessOf, MOOD_LABELS, moodFactors, moodOf } from './happiness';
import { askingPrice, marketPlayers } from './transfers';

export type Tone = 'good' | 'ok' | 'bad';

export interface ReportPoint {
  text: string;
  tone: Tone;
}

export interface PlayerReport {
  playerId: string;
  own: boolean;
  /** how much of this report rests on real knowledge */
  confidence: 'full' | 'good' | 'rough';
  recommendation: { label: string; tone: Tone; summary: string };
  /** 0–100: how good a move this is for your club */
  score: number;
  ability: { estimate: number; low: number; high: number };
  /** where he would rank among your players in his position (1 = first choice) */
  depth: {
    rank: number;
    of: number;
    position: Position;
    best?: { name: string; overall: number };
  };
  strengths: { label: string; value: string }[];
  weaknesses: { label: string; value: string }[];
  outlook: {
    trend: 'rising' | 'peak' | 'declining';
    nextSeason: number;
    inTwo: number;
    text: string;
  };
  form?: { apps: number; line: string; percentile: number; text: string };
  money: {
    value?: number;
    fee?: number;
    /** wage he has now */
    wage?: number;
    /** wage he would want from you (to sign or to renew) */
    wantedWage: number;
    /** the most worth paying him, given his level and role */
    maxWorthWage: number;
    wageRoom: number;
    contractUntil?: number;
    yearsLeft?: number;
  };
  /** for your players: a cheaper or better option on the market at his position */
  alternative?: {
    playerId: string;
    name: string;
    clubName: string;
    estimate: number;
    price: number;
    wage: number;
    scouted: boolean;
  };
  pros: ReportPoint[];
  cons: ReportPoint[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1000 = (v: number) => Math.round(v / 1000) * 1000;
const money = (v: number) => (v >= 1_000_000 ? `€${(v / 1_000_000).toFixed(1)}m` : `€${Math.round(v / 1000)}k`);

/** The going wage for a level of play (same scale as expectedWage, from what we can see). */
const wageForLevel = (ovr: number, potential: number, age: number) => Math.max(3000, 6000 * Math.pow(1.5, ovr - 10) * (age <= 20 ? 0.6 : 1) + Math.max(0, potential - ovr) * 1000);

/** Expected overall a season ahead: growth toward potential while young, decline after 30. */
export function projectOverall(ovr: number, potential: number, age: number): number {
  if (age <= 24) return Math.min(potential, ovr + Math.max(0, potential - ovr) * (age <= 19 ? 0.36 : age <= 21 ? 0.3 : 0.22));
  if (age <= 29) return ovr;
  return ovr - (age <= 32 ? 0.45 : 1);
}

const midpoint = (view: PlayerView, k: keyof Attributes) => (view.attrs[k].low + view.attrs[k].high) / 2;
const shown = (view: PlayerView, k: keyof Attributes) => (view.attrs[k].low === view.attrs[k].high ? String(view.attrs[k].low) : `${view.attrs[k].low}–${view.attrs[k].high}`);

/** How this season's numbers compare with others in his position across the league (by average match rating). */
function formOf(state: CareerState, p: Player) {
  const s = state.playerStats[p.id];
  if (!s || s.apps < 2) return undefined;
  const gk = p.position === 'GK';
  const avg = averageRating(s);
  // Average rating when there are ratings; goals a game (or save rate) for older saves.
  const metric = (x: PlayerSeason) =>
    avg !== undefined ? (averageRating(x) ?? 0) : gk ? (x.saves + (x.conceded ?? 0) > 0 ? x.saves / (x.saves + (x.conceded ?? 0)) : 0) : x.goals / x.apps;
  const peers = state.teams
    .flatMap((t) => t.players)
    .filter((x) => x.position === p.position && (state.playerStats[x.id]?.apps ?? 0) >= 2)
    .map((x) => metric(state.playerStats[x.id]));
  const mine = metric(s);
  const percentile = peers.length > 1 ? Math.round((peers.filter((v) => v < mine).length / (peers.length - 1)) * 100) : 50;
  const rating = avg !== undefined ? `average rating ${avg.toFixed(2)}${s.mom ? `, ${s.mom}× man of the match` : ''}, ` : '';
  const line = gk
    ? `${rating}${s.saves} saves, ${s.saves + (s.conceded ?? 0) ? Math.round((s.saves / (s.saves + (s.conceded ?? 0))) * 100) : 0}% save rate in ${s.apps} matches`
    : `${rating}${s.goals} goals (${(s.goals / s.apps).toFixed(1)} a match), ${s.shots ? Math.round((s.goals / s.shots) * 100) : 0}% shooting, ${s.assists} assists, ${s.exclusionsDrawn} exclusions won in ${s.apps} matches`;
  const text =
    percentile >= 80 ? `One of the league's best ${gk ? 'goalkeepers' : 'in his position'} this season.` : percentile >= 55 ? 'Good season so far.' : percentile >= 30 ? 'An ordinary season.' : 'Struggling this season.';
  return { apps: s.apps, line, percentile, text };
}

/** The scouting / assistant's report on any player. */
export function playerReport(state: CareerState, playerId: string): PlayerReport | undefined {
  const team = state.teams.find((t) => t.players.some((p) => p.id === playerId));
  const free = state.freeAgents.find((f) => f.player.id === playerId);
  const p = team?.players.find((x) => x.id === playerId) ?? free?.player;
  if (!p) return undefined;
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const own = team?.id === mine.id;
  const view = playerView(state, p);
  const confidence = view.knowledge === 'own' || view.knowledge === 'exact' ? 'full' : view.knowledge === 'close' ? 'good' : 'rough';
  const est = view.overall.estimate;
  const potential = state.potential[p.id] ?? free?.potential ?? overall(p);
  // Potential is only as clear as the scouting: unscouted players are judged on age alone.
  const knownPotential = confidence === 'rough' ? est + (p.age <= 21 ? 1.5 : p.age <= 24 ? 0.7 : 0) : potential;
  const pros: ReportPoint[] = [];
  const cons: ReportPoint[] = [];
  let score = 50;

  // Depth: where he would sit among your players in his position.
  const rivals = mine.players.filter((x) => x.position === p.position && x.id !== p.id).sort((a, b) => overall(b) - overall(a));
  const rank = rivals.filter((x) => overall(x) > est + 0.05).length + 1;
  const keepers = p.position === 'GK';
  const starters = keepers ? 1 : p.position === 'DRIVER' ? 3 : 2;
  const depth = {
    rank,
    of: rivals.length + 1,
    position: p.position,
    best: rivals[0] ? { name: rivals[0].name, overall: overall(rivals[0]) } : undefined,
  };
  const level = teamRating(mine.players);

  // Strengths and weaknesses among the attributes his position needs.
  const relevant = (Object.entries(POSITION_WEIGHTS[p.position]) as [keyof Attributes, number][]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const extra: (keyof Attributes)[] = keepers ? [] : ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'positioning', 'gameIQ', 'wrestling', 'legStrength'];
  const pool = [...new Set([...relevant, ...extra])];
  const ranked = [...pool].sort((a, b) => midpoint(view, b) - midpoint(view, a));
  const strengths =
    confidence === 'rough'
      ? []
      : ranked
          .filter((k) => midpoint(view, k) >= Math.max(11, est + 0.5))
          .slice(0, 3)
          .map((k) => ({ label: ATTRIBUTE_LABELS[k], value: shown(view, k) }));
  const weaknesses =
    confidence === 'rough'
      ? []
      : [...relevant]
          .sort((a, b) => midpoint(view, a) - midpoint(view, b))
          .filter((k) => midpoint(view, k) <= est - 1.5)
          .slice(0, 2)
          .map((k) => ({ label: ATTRIBUTE_LABELS[k], value: shown(view, k) }));

  // Outlook.
  const next = projectOverall(est, knownPotential, p.age);
  const inTwo = projectOverall(next, knownPotential, p.age + 1);
  const trend = inTwo > est + 0.4 ? 'rising' : inTwo < est - 0.6 ? 'declining' : 'peak';
  const outlookText =
    trend === 'rising'
      ? `Still improving: around ${inTwo.toFixed(1)} in two seasons${confidence === 'rough' ? ' (a guess until scouted)' : ''}.`
      : trend === 'declining'
        ? `Past his best: expect around ${inTwo.toFixed(1)} in two seasons.`
        : 'At his peak: should hold this level for a while.';

  const form = formOf(state, p);
  const year = seasonYear(state.season);
  const contract = state.contracts[p.id];
  const yearsLeft = contract && team ? contract.until - year : undefined;

  // The most worth paying: what his level earns, scaled by how much you would use him.
  const roleFactor = rank <= starters ? 1.15 : rank <= starters + 1 ? 1 : 0.8;
  const maxWorthWage = round1000(wageForLevel(est, knownPotential, p.age) * roleFactor * (trend === 'declining' ? 0.85 : 1));
  const room = wageRoom(state, own ? p.id : undefined);

  // --- Shared judgement: role, outlook, form, personality, fitness.
  if (rank <= starters) {
    score += own ? 18 : 22;
    pros.push({
      text: own
        ? rank === 1
          ? `Your best ${posName(p.position)} (of ${depth.of}).`
          : `A starter: ${ordinal(rank)} best of your ${depth.of} ${posName(p.position)}s.`
        : rank === 1
          ? `Would be your best ${posName(p.position)}: better than ${depth.best ? `${depth.best.name} (${depth.best.overall.toFixed(1)})` : 'anyone you have'}.`
          : `Would start: ${ordinal(rank)} best of your ${posName(p.position)}s, behind ${depth.best!.name} (${depth.best!.overall.toFixed(1)}).`,
      tone: 'good',
    });
  } else if (rank <= starters + 2) {
    score += 6;
    pros.push({
      text: own ? `Rotation player: ${ordinal(rank)} of ${depth.of} at ${posName(p.position)}.` : `Would compete for a place: ${ordinal(rank)} of ${depth.of} at ${posName(p.position)}.`,
      tone: 'ok',
    });
  } else {
    score -= own ? 8 : 15;
    cons.push({
      text: own ? `Behind ${rank - 1} others at ${posName(p.position)}: rarely needed.` : `Would be behind ${rank - 1} of your ${posName(p.position)}s.`,
      tone: 'bad',
    });
  }
  if (!own && rivals.length < (keepers ? 2 : starters + 1)) {
    score += 8;
    pros.push({
      text: `You are short of ${posName(p.position)}s (${rivals.length}).`,
      tone: 'good',
    });
  }
  if (trend === 'rising') {
    score += clamp((inTwo - est) * 5, 3, 14);
    pros.push({ text: outlookText, tone: 'good' });
  } else if (trend === 'declining') {
    score -= clamp((est - inTwo) * 6, 4, 14);
    cons.push({ text: outlookText, tone: 'bad' });
  }
  if (est >= level + 1.5)
    pros.push({
      text: `Above your team's level (${level.toFixed(1)}).`,
      tone: 'good',
    });
  if (form) {
    if (form.percentile >= 70) {
      score += 6;
      pros.push({ text: `${form.text} ${form.line}.`, tone: 'good' });
    } else if (form.percentile <= 25) {
      score -= 4;
      cons.push({ text: `${form.text} ${form.line}.`, tone: 'bad' });
    }
  }
  if (view.personality === 'professional' || view.personality === 'ambitious') {
    score += 4;
    pros.push({
      text: view.personality === 'professional' ? 'Professional: trains hard, reliable progress.' : 'Ambitious: driven, but will want to play and be paid.',
      tone: 'good',
    });
  } else if (view.personality === 'lazy' || view.personality === 'temperamental') {
    score -= 5;
    cons.push({
      text: view.personality === 'lazy' ? 'Laid-back: coasts in training.' : 'Temperamental: inconsistent from week to week.',
      tone: 'bad',
    });
  }
  const injury = state.squad[p.id]?.injury;
  if (injury) {
    score -= injury.weeksLeft > 4 ? 8 : 3;
    cons.push({
      text: `Injured: ${injury.name}, out ${injury.weeksLeft} more week${injury.weeksLeft === 1 ? '' : 's'}.`,
      tone: 'bad',
    });
  }
  if (p.age >= 33) cons.push({ text: `Aged ${p.age}: could retire any summer.`, tone: 'bad' });

  let recommendation: PlayerReport['recommendation'];
  let alternative: PlayerReport['alternative'];
  let wantedWage: number;

  if (own) {
    // --- Keep, renew or sell?
    // His mood: a transfer request or deep unhappiness makes him hard to keep.
    const h = happinessOf(state, p.id);
    const worst = moodFactors(state, p)
      .filter((f) => f.points < 0)
      .sort((a, b) => a.points - b.points)[0];
    if (state.transferRequests?.includes(p.id)) {
      score -= 15;
      cons.push({ text: `Has asked to leave${worst ? `: ${worst.text.toLowerCase()}` : ''}.`, tone: 'bad' });
    } else if (h < 40) {
      score -= 8;
      cons.push({ text: `${MOOD_LABELS[moodOf(h)]}${worst ? `: ${worst.text.toLowerCase()}` : ''}.`, tone: 'bad' });
    } else if (h >= 80) pros.push({ text: 'Delighted at the club.', tone: 'good' });
    const demand = contractDemand(state, p.id);
    wantedWage = demand.wage;
    const ending = yearsLeft !== undefined && yearsLeft <= 1;
    const wage = contract?.wage ?? 0;
    if (wage > maxWorthWage * 1.25) {
      score -= 10;
      cons.push({
        text: `Paid ${money(wage)}, more than his role is worth (about ${money(maxWorthWage)}).`,
        tone: 'bad',
      });
    }
    if (ending) {
      if (demand.wage > maxWorthWage * 1.15) {
        score -= 8;
        cons.push({
          text: `Wants ${money(demand.wage)} to renew, well above what he is worth to you (${money(maxWorthWage)}).`,
          tone: 'bad',
        });
      } else if (demand.wage > maxWorthWage)
        cons.push({
          text: `Wants ${money(demand.wage)}, a little above his worth (${money(maxWorthWage)}): try a lower offer.`,
          tone: 'ok',
        });
      else
        pros.push({
          text: `His renewal demand (${money(demand.wage)}) is fair for his role.`,
          tone: 'good',
        });
      if (demand.wage - wage > room)
        cons.push({
          text: `The raise he wants does not fit the wage budget (room ${money(room)}).`,
          tone: 'bad',
        });
      if (demand.mood === 'reluctant')
        cons.push({
          text: 'Unhappy with his playing time: harder to keep.',
          tone: 'bad',
        });
    }
    // Is there a better or cheaper option on the market?
    const options = marketPlayers(state)
      .filter((m) => m.player.position === p.position && m.player.id !== p.id)
      .map((m) => ({ m, v: playerView(state, m.player) }))
      .filter(({ m, v }) => v.overall.estimate >= overall(p) - 0.2 && m.askingWage <= Math.max(wage, demand.wage) * 1.1 && m.player.age <= Math.max(p.age, 30))
      .sort((a, b) => a.m.askingPrice - b.m.askingPrice);
    if (options[0]) {
      const { m, v } = options[0];
      alternative = {
        playerId: m.player.id,
        name: m.player.name,
        clubName: m.clubName,
        estimate: v.overall.estimate,
        price: m.askingPrice,
        wage: m.askingWage,
        scouted: v.knowledge !== 'unknown',
      };
    }
    const value = playerValue(p, potential);
    score = clamp(Math.round(score), 0, 100);
    const youngTalent = p.age <= 22 && potential - overall(p) >= 2;
    if (youngTalent && score >= 40)
      recommendation = {
        label: ending ? 'Renew: future starter' : 'Keep and develop',
        tone: 'good',
        summary: `Young with real room to grow. ${ending ? `Lock him in for ${demand.years}+ seasons.` : 'Give him minutes.'}`,
      };
    else if (score >= 68)
      recommendation = ending
        ? {
            label: 'Renew',
            tone: 'good',
            summary: `A key player. Worth up to about ${money(maxWorthWage)} a season.`,
          }
        : {
            label: 'Key player: keep',
            tone: 'good',
            summary: 'One of the players the team is built around.',
          };
    else if (score >= 45)
      recommendation = ending
        ? {
            label: 'Renew if the price is right',
            tone: 'ok',
            summary: `Useful, but do not go above about ${money(maxWorthWage)} a season.`,
          }
        : {
            label: 'Squad player',
            tone: 'ok',
            summary: 'Fine to keep as depth.',
          };
    else if (value >= wage * 1.5 && p.age <= 29)
      recommendation = {
        label: 'Sell',
        tone: 'bad',
        summary: `Not essential, and still worth around ${money(value)}: cash in and spend the wages elsewhere.`,
      };
    else
      recommendation = ending
        ? {
            label: 'Let him go',
            tone: 'bad',
            summary: 'Not worth a new contract: let it run out and use the wages elsewhere.',
          }
        : {
            label: 'Sell or release',
            tone: 'bad',
            summary: 'Not part of your plans: frees a squad place and wages.',
          };
    return {
      playerId,
      own,
      confidence,
      recommendation,
      score,
      ability: {
        estimate: est,
        low: view.overall.low,
        high: view.overall.high,
      },
      depth,
      strengths,
      weaknesses,
      outlook: { trend, nextSeason: next, inTwo, text: outlookText },
      form,
      money: {
        value,
        wage,
        wantedWage,
        maxWorthWage,
        wageRoom: room,
        contractUntil: contract?.until,
        yearsLeft,
      },
      alternative,
      pros,
      cons,
    };
  }

  // --- Should we sign him?
  const fee = team ? askingPrice(state, p.id) : 0;
  wantedWage = free?.askingWage ?? expectedWage(p, potential);
  const balance = state.finances[mine.id].balance;
  const value = confidence === 'rough' ? undefined : playerValue(p, potential);
  if (!team) {
    score += 8;
    pros.push({ text: 'Free agent: no transfer fee.', tone: 'good' });
  } else if (value !== undefined) {
    if (fee <= value * 1.1) {
      score += 6;
      pros.push({
        text: `Fairly priced at ${money(fee)} (worth about ${money(value)}).`,
        tone: 'good',
      });
    } else if (fee > value * 1.6) {
      score -= 8;
      cons.push({
        text: `Overpriced: ${money(fee)} for a player worth about ${money(value)}.`,
        tone: 'bad',
      });
    } else
      cons.push({
        text: `A bit expensive: ${money(fee)} (worth about ${money(value)}).`,
        tone: 'ok',
      });
  }
  if (yearsLeft !== undefined && yearsLeft <= 0)
    pros.push({
      text: 'His contract ends this season: cheaper now, or free in the summer.',
      tone: 'good',
    });
  if (wantedWage > maxWorthWage * 1.2) {
    score -= 6;
    cons.push({
      text: `Wants ${money(wantedWage)} a season, more than his role would be worth (${money(maxWorthWage)}).`,
      tone: 'bad',
    });
  }
  const affordable = wantedWage <= room && fee <= balance;
  if (wantedWage > room)
    cons.push({
      text: `His wage (${money(wantedWage)}) does not fit your budget (room ${money(room)}).`,
      tone: 'bad',
    });
  if (fee > balance)
    cons.push({
      text: `The fee is more than your balance (${money(balance)}).`,
      tone: 'bad',
    });
  if (confidence === 'rough')
    cons.push({
      text: 'Not scouted: these are estimates. Send a scout before you bid.',
      tone: 'ok',
    });
  score = clamp(Math.round(score), 0, 100);
  recommendation = !affordable
    ? {
        label: "Can't afford him",
        tone: 'bad',
        summary: 'Free up wages or money first.',
      }
    : confidence === 'rough' && score < 45
      ? {
          label: 'Probably not for us',
          tone: 'bad',
          summary: 'Even the optimistic estimate would not improve your team much.',
        }
      : confidence === 'rough'
        ? {
            label: 'Scout him first',
            tone: 'ok',
            summary: score >= 60 ? 'Looks promising on paper: get a report before deciding.' : 'Not obviously what you need: scout him if you are curious.',
          }
        : score >= 72
          ? {
              label: 'Sign him',
              tone: 'good',
              summary: rank <= starters ? 'A clear upgrade for your team.' : 'A good addition at a sensible price.',
            }
          : score >= 52
            ? {
                label: 'Worth considering',
                tone: 'ok',
                summary: 'Decent option: depends on the price and what else is out there.',
              }
            : {
                label: 'Not for us',
                tone: 'bad',
                summary: 'Would not improve the team enough for the cost.',
              };
  return {
    playerId,
    own,
    confidence,
    recommendation,
    score,
    ability: { estimate: est, low: view.overall.low, high: view.overall.high },
    depth,
    strengths,
    weaknesses,
    outlook: { trend, nextSeason: next, inTwo, text: outlookText },
    form,
    money: {
      value,
      fee: team ? fee : 0,
      wage: contract && team ? contract.wage : undefined,
      wantedWage,
      maxWorthWage,
      wageRoom: room,
      contractUntil: team ? contract?.until : undefined,
      yearsLeft,
    },
    pros,
    cons,
  };
}

const POS_NAMES: Record<Position, string> = {
  GK: 'goalkeeper',
  CENTER: 'center',
  CDEF: 'center-defender',
  DRIVER: 'driver',
  WING: 'wing',
  POINT: 'point',
};
const posName = (p: Position) => POS_NAMES[p];
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
