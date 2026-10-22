// Transfers: windows, the market, bids, personal terms, selling, releasing,
// and the AI clubs' own summer business. Deterministic (seeded).

import { createRng, type Rng } from '../engine/rng';
import { overall, teamRating } from '../engine/ratings';
import type { Player, Team } from '../engine/types';
import { allClubs, clubById, nextRound, seasonYear, type CareerState } from './career';
import { MAX_REGISTERED, MAX_SQUAD } from './development';
import { expectedWage, playerValue, respondToOffer, wageBill, type Contract, type FreeAgent, type RenewalDemand } from './finance';
import { personalityOf } from './training';
import { staffWages } from './staff';
import type { NewsItem } from './squad';

export type TransferWindow = 'summer' | 'winter';

export interface IncomingOffer {
  id: string;
  /** the window it was made in, e.g. "2026-27/summer"; offers lapse when the window closes */
  window: string;
  playerId: string;
  clubId: string;
  fee: number;
}

export interface TransferRecord {
  season: string;
  playerId: string;
  playerName: string;
  fromClubId: string | null;
  fromClubName: string;
  toClubId: string;
  toClubName: string;
  fee: number;
}

export interface MarketEntry {
  player: Player;
  /** null for free agents */
  clubId: string | null;
  clubName: string;
  /** a club outside the manager's league */
  abroad?: boolean;
  /** the club's country (IOC code), when known */
  country?: string;
  potential: number;
  value: number;
  askingPrice: number;
  contract?: Contract;
  askingWage: number;
}

export interface Bid {
  attempts: number;
  /** a fee the selling club has agreed (personal terms still to come) */
  agreedFee?: number;
  /** the club's counter-offer */
  counter?: number;
  closed?: boolean;
}

export const MAX_BIDS = 3;
const round1000 = (v: number) => Math.round(v / 1000) * 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hashRng(seed: number, key: string) {
  let h = seed >>> 0;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return createRng(h);
}

/** The open transfer window, if any: pre-season (before the first matchday) or January. */
export function transferWindow(state: CareerState): TransferWindow | null {
  const round = nextRound(state);
  if (round === undefined) return null;
  if (!state.fixtures.some((f) => f.result)) return 'summer';
  const date = state.fixtures.find((f) => f.matchday === round)?.date ?? '';
  return date.slice(5, 7) === '01' ? 'winter' : null;
}

/** "2026-27/summer": bids and offers belong to one window. */
export const windowKey = (state: CareerState) => `${state.season}/${transferWindow(state) ?? 'closed'}`;

/** Bids made in the current window (older ones no longer count). */
export function currentBids(state: CareerState): Record<string, Bid> {
  return state.bidsWindow === windowKey(state) ? state.bids : {};
}

/** Offers for your players that are still open. */
export function currentOffers(state: CareerState): IncomingOffer[] {
  return transferWindow(state) ? state.offers.filter((o) => o.window === windowKey(state)) : [];
}

/** The club a player is at: in the manager's league or abroad. */
const clubOf = (state: CareerState, playerId: string) => allClubs(state).find((t) => t.players.some((p) => p.id === playerId));

/** How important a player is to his club: rank by ability within the squad. */
function squadRank(team: Team, p: Player) {
  return [...team.players].sort((a, b) => overall(b) - overall(a)).indexOf(p);
}

/** What a club wants for a player: his value, more for key players, less near the end of his contract. */
export function askingPrice(state: CareerState, playerId: string): number {
  const team = clubOf(state, playerId);
  if (!team) return 0;
  const p = team.players.find((x) => x.id === playerId)!;
  const value = playerValue(p, state.potential[playerId]);
  const rank = squadRank(team, p);
  const importance = rank < 2 ? 2.2 : rank < 6 ? 1.5 : rank < 10 ? 1.15 : 0.85;
  // Clubs abroad: their contracts aren't known in this game, so no discount for an ending deal.
  const contract = state.contracts[playerId];
  const yearsLeft = contract ? contract.until - seasonYear(state.season) : 2;
  const contractFactor = yearsLeft <= 0 ? 0.55 : yearsLeft === 1 ? 0.85 : 1;
  return round1000(Math.max(3000, value * importance * contractFactor));
}

/** Everyone you could sign: players at other clubs in the league and free agents. */
export function marketPlayers(state: CareerState): MarketEntry[] {
  const fromClubs = state.teams
    .filter((t) => t.id !== state.managedClubId)
    .flatMap((t) =>
      t.players.map((p) => ({
        player: p,
        clubId: t.id as string | null,
        clubName: t.name,
        potential: state.potential[p.id] ?? overall(p),
        value: playerValue(p, state.potential[p.id]),
        askingPrice: askingPrice(state, p.id),
        contract: state.contracts[p.id],
        askingWage: expectedWage(p, state.potential[p.id]),
      })),
    );
  // The rest of Europe: every club abroad is open for business too.
  const fromAbroad: MarketEntry[] = (state.foreign ?? []).flatMap((t) =>
    t.players.map((p) => ({
      player: p,
      clubId: t.id,
      clubName: t.name,
      abroad: true,
      country: state.clubCountries?.[t.id],
      potential: state.potential[p.id] ?? overall(p),
      value: playerValue(p, state.potential[p.id]),
      askingPrice: askingPrice(state, p.id),
      askingWage: expectedWage(p, state.potential[p.id]),
    })),
  );
  const free = state.freeAgents.map((f) => ({
    player: f.player,
    clubId: null,
    clubName: 'Free agent',
    potential: f.potential,
    value: playerValue(f.player, f.potential),
    askingPrice: 0,
    askingWage: f.askingWage,
  }));
  return [...fromClubs.map((m) => ({ ...m, country: state.clubCountries?.[m.clubId!] })), ...fromAbroad, ...free];
}

/**
 * Bid for a player at another club. The club accepts at or above its asking price,
 * counters a reasonable bid, and rejects lowballs. At most three bids per window.
 */
export function bidForPlayer(state: CareerState, playerId: string, fee: number): { response: 'accepted' | 'countered' | 'rejected'; message: string; state: CareerState } {
  const window = transferWindow(state);
  if (!window) return { response: 'rejected', message: 'The transfer window is closed.', state };
  const team = clubOf(state, playerId);
  if (!team || team.id === state.managedClubId) return { response: 'rejected', message: 'That player is not at another club.', state };
  const bids = currentBids(state);
  const bid = bids[playerId] ?? { attempts: 0 };
  if (bid.closed || bid.attempts >= MAX_BIDS) return { response: 'rejected', message: `${team.name} will not negotiate any more this window.`, state };
  if (fee > state.finances[state.managedClubId].balance) return { response: 'rejected', message: 'The board says no: you do not have that much money.', state };
  const asking = askingPrice(state, playerId);
  const rng = hashRng(state.seed, `${state.season}/${window}/${playerId}/${bid.attempts}`);
  let next: Bid;
  let response: 'accepted' | 'countered' | 'rejected';
  let message: string;
  if (fee >= asking * rng.range(0.95, 1.0)) {
    next = { attempts: bid.attempts + 1, agreedFee: fee };
    response = 'accepted';
    message = `${team.name} accept ${formatFee(fee)}. Now agree terms with the player.`;
  } else if (fee >= asking * 0.7) {
    const counter = round1000(asking * rng.range(0.92, 1.0));
    next = { attempts: bid.attempts + 1, counter };
    response = 'countered';
    message = `${team.name} want more: they would accept ${formatFee(counter)}.`;
  } else {
    next = { attempts: bid.attempts + 1, closed: fee < asking * 0.4 };
    response = 'rejected';
    message = fee < asking * 0.4 ? `${team.name} are not interested in talking at that price.` : `${team.name} reject the bid.`;
  }
  return { response, message, state: { ...state, bids: { ...bids, [playerId]: next }, bidsWindow: windowKey(state) } };
}

/** What a player wants to join the manager's club, and whether he would come at all. */
export function playerTerms(state: CareerState, playerId: string): RenewalDemand & { willing: boolean; reason?: string } {
  const entry = marketPlayers(state).find((m) => m.player.id === playerId);
  if (!entry) throw new Error('Unknown player');
  const p = entry.player;
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const theirs = entry.clubId ? clubById(state, entry.clubId) : undefined;
  const personality = personalityOf(state.seed, p.id);
  const step = theirs ? teamRating(mine.players) - teamRating(theirs.players) : 1;
  // Joining a stronger club: happy to take a little less. A weaker one: wants more, and ambitious players may refuse.
  const factor = clamp(1.08 - step * 0.04, 0.9, 1.3) * (personality === 'ambitious' ? 1.1 : 1);
  const willing = !(personality === 'ambitious' && step < -1.5);
  const years = p.age >= 31 ? 1 : p.age >= 28 ? 2 : p.age <= 22 ? 4 : 3;
  return {
    wage: round1000(entry.askingWage * factor),
    years,
    mood: step > 0.5 ? 'keen' : step > -0.5 ? 'open' : 'reluctant',
    willing,
    reason: willing ? undefined : `${p.name} is ambitious and does not want to join a weaker club.`,
  };
}

/** Free cap number for a newcomer. */
function freeCap(team: Team) {
  const used = new Set(team.players.map((p) => p.cap));
  let cap = 2;
  while (used.has(cap)) cap++;
  return cap;
}

/**
 * Sign a player: for a club's player the fee must have been agreed first; free
 * agents just need terms. Checks money, wage budget and squad size.
 */
export function signPlayer(state: CareerState, playerId: string, wage: number, years: number): { signed: boolean; message: string; state: CareerState } {
  if (!transferWindow(state)) return { signed: false, message: 'The transfer window is closed.', state };
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  if (mine.players.length >= MAX_REGISTERED) return { signed: false, message: `Your squad is full (${MAX_REGISTERED}): sell or release someone first.`, state };
  const fromTeam = clubOf(state, playerId);
  const free = state.freeAgents.find((f) => f.player.id === playerId);
  if (!fromTeam && !free) return { signed: false, message: 'That player is not available.', state };
  const bids = currentBids(state);
  const bid = bids[playerId];
  const fee = fromTeam ? bid?.agreedFee : 0;
  if (fromTeam && fee === undefined) return { signed: false, message: 'Agree a fee with his club first.', state };
  const f = state.finances[state.managedClubId];
  if ((fee ?? 0) > f.balance) return { signed: false, message: 'Not enough money for the fee.', state };
  const room = f.wageBudget - wageBill(mine, state.contracts) - staffWages(state.staff ?? {});
  if (wage > room)
    return {
      signed: false,
      message: `Not enough room in the wage budget: ${formatFee(Math.max(0, room))} left, he wants ${formatFee(wage)}. Raise the wage budget with your transfer funds in the Club tab, or free wages by selling.`,
      state,
    };
  const terms = playerTerms(state, playerId);
  if (!terms.willing) return { signed: false, message: terms.reason!, state };
  const talksKey = `terms:${playerId}`;
  const talks = bids[talksKey] ?? { attempts: 0 };
  if (talks.closed || talks.attempts >= MAX_BIDS) return { signed: false, message: 'He has stopped talking to you this window.', state };
  const answer = respondToOffer(terms, wage, years, hashRng(state.seed, `${state.season}/terms/${playerId}/${talks.attempts}`));
  if (!answer.accepted) {
    return { signed: false, message: answer.message, state: { ...state, bids: { ...bids, [talksKey]: { attempts: talks.attempts + 1, closed: wage / terms.wage < 0.85 } }, bidsWindow: windowKey(state) } };
  }

  const player = fromTeam ? fromTeam.players.find((p) => p.id === playerId)! : free!.player;
  const moved = { ...player, cap: freeCap(mine) };
  const year = seasonYear(state.season);
  const teams = state.teams.map((t) => {
    if (t.id === mine.id) return { ...t, players: [...t.players, moved].sort((a, b) => a.cap - b.cap) };
    if (fromTeam && t.id === fromTeam.id) return { ...t, players: t.players.filter((p) => p.id !== playerId) };
    return t;
  });
  // A player from abroad leaves his club there.
  const foreign = fromTeam && state.foreign?.some((t) => t.id === fromTeam.id) ? state.foreign.map((t) => (t.id === fromTeam.id ? { ...t, players: t.players.filter((p) => p.id !== playerId) } : t)) : state.foreign;
  const finances = { ...state.finances, [mine.id]: { ...f, balance: f.balance - (fee ?? 0), ledger: [...f.ledger, ...(fee ? [{ round: nextRound(state) ?? 0, label: `Transfer: ${player.name}`, amount: -(fee ?? 0) }] : [])] } };
  // Clubs abroad keep no books in this game; clubs in the league receive the fee.
  if (fromTeam && fee && finances[fromTeam.id]) finances[fromTeam.id] = { ...finances[fromTeam.id], balance: finances[fromTeam.id].balance + fee };
  const record: TransferRecord = { season: state.season, playerId, playerName: player.name, fromClubId: fromTeam?.id ?? null, fromClubName: fromTeam?.name ?? 'Free agent', toClubId: mine.id, toClubName: mine.name, fee: fee ?? 0 };
  const news: NewsItem = { round: nextRound(state) ?? 0, kind: 'result', text: `Signed ${player.name} from ${record.fromClubName}${fee ? ` for ${formatFee(fee)}` : ' on a free'}.` };
  return {
    signed: true,
    message: `${player.name} signs for ${years} season${years > 1 ? 's' : ''}. Welcome!`,
    state: {
      ...state,
      teams,
      foreign,
      finances,
      contracts: { ...state.contracts, [playerId]: { wage, until: year + years - 1 + (transferWindow(state) === 'summer' ? 0 : 1) } },
      squad: { ...state.squad, [playerId]: state.squad[playerId] ?? { condition: 100 } },
      potential: { ...state.potential, [playerId]: state.potential[playerId] ?? free?.potential ?? overall(player) },
      freeAgents: state.freeAgents.filter((x) => x.player.id !== playerId),
      bids: { ...bids, [playerId]: { attempts: MAX_BIDS, closed: true }, [talksKey]: { attempts: MAX_BIDS, closed: true } },
      bidsWindow: windowKey(state),
      transfers: [...state.transfers, record],
      news: [...state.news, news].slice(-60),
      selection: undefined,
    },
  };
}

// ---------------------------------------------------------------- selling

/** Clubs that want a player and can afford him make offers around his value. */
export function offersFor(state: CareerState, playerId: string, rng: Rng, chance = 0.6): IncomingOffer[] {
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = mine.players.find((x) => x.id === playerId);
  if (!p) return [];
  const value = playerValue(p, state.potential[playerId]);
  return state.teams
    .filter((t) => t.id !== mine.id && t.players.length < MAX_REGISTERED)
    .filter((t) => overall(p) >= teamRating(t.players) - 2.5) // he would be a useful player for them
    .filter((t) => state.finances[t.id].balance >= value * 0.8)
    .filter(() => rng.chance(chance))
    .slice(0, 3)
    .map((t, i) => ({ id: `${state.season}-${playerId}-${t.id}-${i}`, window: windowKey(state), playerId, clubId: t.id, fee: round1000(Math.min(state.finances[t.id].balance, value * rng.range(0.75, 1.2))) }));
}

/** Put a player on (or take him off) the transfer list. Listing brings offers right away while the window is open. */
export function setTransferListed(state: CareerState, playerId: string, listed: boolean): CareerState {
  const transferList = listed ? [...new Set([...state.transferList, playerId])] : state.transferList.filter((id) => id !== playerId);
  const others = currentOffers(state).filter((o) => o.playerId !== playerId);
  if (!listed || !transferWindow(state)) return { ...state, transferList, offers: listed ? state.offers : others };
  const offers = offersFor(state, playerId, hashRng(state.seed, `${state.season}/list/${playerId}`), 0.75);
  return { ...state, transferList, offers: [...others, ...offers] };
}

/** Accept or reject a club's offer for one of your players. */
export function answerOffer(state: CareerState, offerId: string, accept: boolean): { message: string; state: CareerState } {
  const offer = currentOffers(state).find((o) => o.id === offerId);
  if (!offer) return { message: 'That offer is no longer there.', state };
  if (!accept) return { message: 'Offer rejected.', state: { ...state, offers: state.offers.filter((o) => o.id !== offerId) } };
  if (!transferWindow(state)) return { message: 'The transfer window is closed.', state };
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const buyer = state.teams.find((t) => t.id === offer.clubId)!;
  const p = mine.players.find((x) => x.id === offer.playerId);
  if (!p) return { message: 'He is no longer at the club.', state };
  if (state.finances[buyer.id].balance < offer.fee) return { message: `${buyer.name} can no longer afford it.`, state: { ...state, offers: state.offers.filter((o) => o.id !== offerId) } };
  const moved = { ...p, cap: freeCap(buyer) };
  const teams = state.teams.map((t) => (t.id === mine.id ? { ...t, players: t.players.filter((x) => x.id !== p.id) } : t.id === buyer.id ? { ...t, players: [...t.players, moved] } : t));
  const f = state.finances[mine.id];
  const finances = {
    ...state.finances,
    [mine.id]: { ...f, balance: f.balance + offer.fee, ledger: [...f.ledger, { round: nextRound(state) ?? 0, label: `Sold: ${p.name}`, amount: offer.fee }] },
    [buyer.id]: { ...state.finances[buyer.id], balance: state.finances[buyer.id].balance - offer.fee },
  };
  const year = seasonYear(state.season);
  const record: TransferRecord = { season: state.season, playerId: p.id, playerName: p.name, fromClubId: mine.id, fromClubName: mine.name, toClubId: buyer.id, toClubName: buyer.name, fee: offer.fee };
  return {
    message: `${p.name} joins ${buyer.name} for ${formatFee(offer.fee)}.`,
    state: {
      ...state,
      teams,
      finances,
      contracts: { ...state.contracts, [p.id]: { wage: expectedWage(p, state.potential[p.id]), until: year + 2 } },
      offers: state.offers.filter((o) => o.playerId !== p.id),
      transferList: state.transferList.filter((id) => id !== p.id),
      transfers: [...state.transfers, record],
      selection: undefined,
      individual: Object.fromEntries(Object.entries(state.individual).filter(([id]) => id !== p.id)),
      news: [...state.news, { round: nextRound(state) ?? 0, kind: 'result' as const, text: `Sold ${p.name} to ${buyer.name} for ${formatFee(offer.fee)}.` }].slice(-60),
    },
  };
}

/** What it costs to release a player: half of what is left on his contract. */
export function releaseCost(state: CareerState, playerId: string): number {
  const c = state.contracts[playerId];
  if (!c) return 0;
  const seasonsLeft = Math.max(1, c.until - seasonYear(state.season) + 1);
  return round1000(c.wage * seasonsLeft * 0.5);
}

/** Release a player: pay off half his remaining contract; he becomes a free agent. */
export function releasePlayer(state: CareerState, playerId: string): { message: string; state: CareerState } {
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = mine.players.find((x) => x.id === playerId);
  if (!p) return { message: 'Not one of your players.', state };
  if (mine.players.length <= 13) return { message: 'Your squad is too small to release anyone.', state };
  const cost = releaseCost(state, playerId);
  const f = state.finances[mine.id];
  const freeAgent: FreeAgent = { player: p, potential: state.potential[p.id] ?? overall(p), fromClubId: mine.id, askingWage: expectedWage(p, state.potential[p.id]) };
  const contracts = { ...state.contracts };
  delete contracts[p.id];
  return {
    message: `${p.name} has been released (${formatFee(cost)} paid off).`,
    state: {
      ...state,
      teams: state.teams.map((t) => (t.id === mine.id ? { ...t, players: t.players.filter((x) => x.id !== p.id) } : t)),
      finances: { ...state.finances, [mine.id]: { ...f, balance: f.balance - cost, ledger: [...f.ledger, { round: nextRound(state) ?? 0, label: `Released: ${p.name}`, amount: -cost }] } },
      contracts,
      freeAgents: [...state.freeAgents, freeAgent],
      transferList: state.transferList.filter((id) => id !== p.id),
      offers: state.offers.filter((o) => o.playerId !== p.id),
      selection: undefined,
      news: [...state.news, { round: nextRound(state) ?? 0, kind: 'result' as const, text: `Released ${p.name}.` }].slice(-60),
    },
  };
}

// ---------------------------------------------------------------- AI business

/**
 * The AI clubs' summer: clubs sign free agents to fill thin squads or upgrade, and
 * richer clubs buy the best players of weaker clubs. Returns the updated pieces.
 */
export function aiTransferWindow(state: CareerState, rng: Rng): CareerState {
  let s = state;
  const year = seasonYear(s.season);
  const records: TransferRecord[] = [];
  for (const team of [...s.teams].sort((a, b) => teamRating(b.players) - teamRating(a.players))) {
    if (team.id === s.managedClubId) continue;
    const level = teamRating(team.players);
    // Free agents: fill the squad, or upgrade on a weak regular.
    for (let k = 0; k < 2; k++) {
      const current = s.teams.find((t) => t.id === team.id)!;
      if (current.players.length >= MAX_SQUAD) break;
      const room = s.finances[team.id].wageBudget - wageBill(current, s.contracts);
      const candidates = s.freeAgents.filter((f) => f.askingWage <= room && overall(f.player) >= level - 3 && f.player.age <= 33);
      if (!candidates.length || (current.players.length >= 15 && !rng.chance(0.4))) break;
      const pick = candidates.reduce((a, b) => (overall(b.player) > overall(a.player) ? b : a));
      const moved = { ...pick.player, cap: freeCap(current) };
      s = {
        ...s,
        teams: s.teams.map((t) => (t.id === team.id ? { ...t, players: [...t.players, moved] } : t)),
        freeAgents: s.freeAgents.filter((f) => f !== pick),
        contracts: { ...s.contracts, [moved.id]: { wage: pick.askingWage, until: year + rng.int(0, 2) } },
        potential: { ...s.potential, [moved.id]: pick.potential },
        squad: { ...s.squad, [moved.id]: { condition: 100 } },
      };
      records.push({ season: s.season, playerId: moved.id, playerName: moved.name, fromClubId: null, fromClubName: 'Free agent', toClubId: team.id, toClubName: team.name, fee: 0 });
    }
    // A purchase from a weaker club, about every other summer per club.
    if (!rng.chance(0.55)) continue;
    const buyer = s.teams.find((t) => t.id === team.id)!;
    if (buyer.players.length >= MAX_SQUAD) continue; // AI clubs respect the summer squad cap
    const targets = s.teams
      .filter((t) => t.id !== buyer.id && t.id !== s.managedClubId && teamRating(t.players) < level - 0.3 && t.players.length > 13)
      .flatMap((t) => t.players.filter((p) => p.position !== 'GK' && overall(p) >= level - 1 && p.age <= 31).map((p) => ({ p, t })));
    const affordable = targets.filter(({ p }) => askingPrice(s, p.id) <= s.finances[buyer.id].balance * 0.7 && expectedWage(p, s.potential[p.id]) <= s.finances[buyer.id].wageBudget - wageBill(buyer, s.contracts));
    if (!affordable.length) continue;
    const { p, t } = affordable[Math.floor(rng.next() * affordable.length)];
    const fee = askingPrice(s, p.id);
    const moved = { ...p, cap: freeCap(buyer) };
    s = {
      ...s,
      teams: s.teams.map((x) => (x.id === buyer.id ? { ...x, players: [...x.players, moved] } : x.id === t.id ? { ...x, players: x.players.filter((y) => y.id !== p.id) } : x)),
      finances: {
        ...s.finances,
        [buyer.id]: { ...s.finances[buyer.id], balance: s.finances[buyer.id].balance - fee },
        [t.id]: { ...s.finances[t.id], balance: s.finances[t.id].balance + fee },
      },
      contracts: { ...s.contracts, [p.id]: { wage: expectedWage(p, s.potential[p.id]), until: year + rng.int(1, 3) } },
    };
    records.push({ season: s.season, playerId: p.id, playerName: p.name, fromClubId: t.id, fromClubName: t.name, toClubId: buyer.id, toClubName: buyer.name, fee });
  }
  const news: NewsItem[] = records
    .filter((r) => r.fee > 0 || records.length < 8)
    .slice(0, 8)
    .map((r) => ({ round: 0, kind: 'result', text: `Transfer: ${r.playerName} moves from ${r.fromClubName} to ${r.toClubName}${r.fee ? ` for ${formatFee(r.fee)}` : ''}.` }));
  return { ...s, transfers: [...s.transfers, ...records], news: [...s.news, ...news].slice(-60) };
}

/** Clubs bid for your best players when the summer window opens. */
export function summerInterest(state: CareerState, rng: Rng): IncomingOffer[] {
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const stars = [...mine.players].sort((a, b) => overall(b) - overall(a)).slice(0, 6);
  return stars.filter(() => rng.chance(0.3)).flatMap((p) => offersFor(state, p.id, rng, 0.35).slice(0, 1));
}

export function formatFee(amount: number) {
  return amount >= 1_000_000 ? `€${(amount / 1_000_000).toFixed(2)}M` : `€${Math.round(amount / 1000)}k`;
}
