// The manager's inbox: players coming to talk (playing time, contracts, interest from other
// clubs, transfer requests), the board, and bids for the manager's players. Messages wait for an
// answer; ignoring a player costs some of his happiness. Promises made in these talks are tracked:
// kept ones build trust, broken ones cost happiness and trust, and a broken promise to a team
// leader unsettles the whole squad. The captain and leaders carry the dressing room.

import { overall } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import { addDays, clubById, daysBetween, leagueRounds, leagueTable, nextMatchday, seasonYear, type CareerState } from './career';
import { expectedShare, happinessOf, moodFactors, rejectTransferRequest, setSquadStatus, STATUSES, statusOf } from './happiness';
import { personalityOf } from './training';
import { answerOffer, currentOffers, formatFee, setTransferListed } from './transfers';

export type InboxKind = 'playing-time' | 'contract' | 'interest' | 'transfer-request' | 'board' | 'offer' | 'promise';

export interface InboxOption {
  id: string;
  label: string;
  /** what it means, shown under the button */
  hint?: string;
}

export interface InboxItem {
  id: string;
  date: string;
  kind: InboxKind;
  /** a player of the club, when the message is from (or about) him */
  playerId?: string;
  from: string;
  subject: string;
  body: string;
  options?: InboxOption[];
  /** the option chosen, and what came of it */
  answer?: string;
  reply?: string;
  /** after this date an unanswered message counts as ignored */
  expires?: string;
  read?: boolean;
  /** offers: the offer it is about */
  offerId?: string;
}

export type PromiseKind = 'minutes' | 'contract' | 'move' | 'let-go';

export interface PlayerPromise {
  id: string;
  playerId: string;
  kind: PromiseKind;
  text: string;
  made: string;
  deadline: string;
  status: 'open' | 'kept' | 'broken';
}

const DEFAULT_TRUST = 60;
const COOLDOWN_DAYS = 42;
const ANSWER_DAYS = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const trustOf = (state: CareerState, playerId: string) => state.trust?.[playerId] ?? DEFAULT_TRUST;
export const unreadCount = (state: CareerState) => (state.inbox ?? []).filter((m) => !m.read || (m.options && !m.answer && !expired(state, m))).length;
export const openPromises = (state: CareerState, playerId?: string) => (state.promises ?? []).filter((p) => p.status === 'open' && (!playerId || p.playerId === playerId));
const today = (state: CareerState) => {
  const md = nextMatchday(state);
  const played = state.fixtures.filter((f) => f.result).map((f) => f.date).sort();
  return played.at(-1) ?? state.fixtures.find((f) => f.matchday === md)?.date ?? `${seasonYear(state.season)}-09-01`;
};
const expired = (state: CareerState, m: InboxItem) => !!m.expires && today(state) > m.expires;

// ---------------------------------------------------------------- captain and leaders

/** The captain: the manager's pick, else the most experienced of the best players. */
export function captainOf(state: CareerState): string | undefined {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  if (state.captainId && club.players.some((p) => p.id === state.captainId)) return state.captainId;
  return [...club.players].sort((a, b) => b.age * 0.4 + overall(b) - (a.age * 0.4 + overall(a)))[0]?.id;
}

/** The dressing-room leaders: the captain and the two most senior regulars. */
export function leadersOf(state: CareerState): string[] {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const captain = captainOf(state);
  const seniors = club.players
    .filter((p) => p.id !== captain && p.age >= 26 && ['key', 'regular'].includes(statusOf(state, p.id)))
    .sort((a, b) => b.age + overall(b) - (a.age + overall(a)))
    .slice(0, 2)
    .map((p) => p.id);
  return captain ? [captain, ...seniors] : seniors;
}

/** Name a new captain: an honour for him, a blow for the one who loses the armband. */
export function setCaptain(state: CareerState, playerId: string): { message: string; state: CareerState } {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { message: '', state };
  const old = captainOf(state);
  if (old === playerId) return { message: `${p.name} is already the captain.`, state };
  const happiness = { ...(state.happiness ?? {}), [playerId]: clamp(happinessOf(state, playerId) + 8, 0, 100) };
  if (old) happiness[old] = clamp(happinessOf(state, old) - 12, 0, 100);
  const oldName = club.players.find((x) => x.id === old)?.name;
  return { message: `${p.name} is the new captain${oldName ? `; ${oldName} is disappointed to lose the armband` : ''}.`, state: { ...state, captainId: playerId, happiness } };
}

// ---------------------------------------------------------------- new messages

function message(state: CareerState, item: Omit<InboxItem, 'date' | 'id'> & { id?: string }): InboxItem {
  const date = today(state);
  return { id: item.id ?? `${item.kind}-${item.playerId ?? 'club'}-${date}`, date, expires: item.options ? addDays(date, ANSWER_DAYS) : undefined, ...item };
}

const recentlyTalked = (state: CareerState, key: string) => {
  const last = state.lastTalk?.[key];
  return !!last && daysBetween(last, today(state)) < COOLDOWN_DAYS;
};
const hasOpen = (state: CareerState, playerId: string) => (state.inbox ?? []).some((m) => m.playerId === playerId && m.options && !m.answer && !expired(state, m));

/** Talks players might start this week, and the board's view. At most two new conversations a week. */
function newMessages(state: CareerState, rng: Rng): InboxItem[] {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const out: InboxItem[] = [];
  const year = seasonYear(state.season);
  const date = today(state);
  for (const p of [...club.players].sort(() => rng.next() - 0.5)) {
    if (out.filter((m) => m.playerId).length >= 2) break;
    if (hasOpen(state, p.id) || state.squad[p.id]?.injury) continue;
    const h = happinessOf(state, p.id);
    const personality = personalityOf(state.seed, p.id);
    const minutes = moodFactors(state, p).find((f) => f.text.startsWith('Wants more playing time'));
    // Transfer requests (from his happiness) always come with a talk.
    if (state.transferRequests?.includes(p.id) && !(state.inbox ?? []).some((m) => m.kind === 'transfer-request' && m.playerId === p.id && m.date.slice(0, 4) >= String(year))) {
      out.push(
        message(state, {
          kind: 'transfer-request',
          playerId: p.id,
          from: p.name,
          subject: 'Transfer request',
          body: `${p.name} has handed in a transfer request. "${minutes ? 'I am not playing, and I need to play.' : 'I think it is time for me to move on.'} I want to leave."`,
          options: [
            { id: 'list', label: 'Accept and list him', hint: 'Other clubs can bid; he calms down.' },
            { id: 'refuse', label: 'Refuse', hint: 'He stays and sulks, more so if ambitious.' },
            { id: 'promise-move', label: 'Promise a move next summer', hint: 'He waits. Break it and he will be furious.' },
          ],
        }),
      );
      continue;
    }
    if (minutes && minutes.points <= -10 && h < 55 && !openPromises(state, p.id).some((x) => x.kind === 'minutes') && !recentlyTalked(state, `minutes:${p.id}`) && rng.chance(0.5)) {
      out.push(
        message(state, {
          kind: 'playing-time',
          playerId: p.id,
          from: p.name,
          subject: 'Playing time',
          body:
            personality === 'ambitious'
              ? `"Boss, I didn't come here to sit on the bench. I need minutes, now."`
              : personality === 'temperamental'
                ? `"I'm fed up. Why am I not playing? Tell me straight."`
                : `"Can we talk? I'd like to play more. ${minutes.text}."`,
          options: [
            { id: 'promise-minutes', label: 'Promise him more minutes', hint: `He expects about ${Math.round(expectedShare(statusOf(state, p.id), p.position) * 32 * 0.8)} minutes a game over the next weeks.` },
            ...(statusOf(state, p.id) !== 'key' ? [{ id: 'raise-role', label: 'Give him a bigger role', hint: 'A step up in squad status, with the minutes that go with it.' }] : []),
            { id: 'earn-it', label: 'Tell him to earn his place', hint: personality === 'professional' ? 'He will take it on the chin.' : 'He will not like it.' },
          ],
        }),
      );
      continue;
    }
    const contract = state.contracts[p.id];
    if (
      contract &&
      contract.until <= year &&
      !state.negotiations[p.id]?.closed &&
      ['key', 'regular'].includes(statusOf(state, p.id)) &&
      p.age < 32 &&
      h >= 40 &&
      date.slice(5) >= '11-15' &&
      !recentlyTalked(state, `contract:${p.id}`) &&
      !openPromises(state, p.id).some((x) => x.kind === 'contract') &&
      rng.chance(0.25)
    ) {
      out.push(
        message(state, {
          kind: 'contract',
          playerId: p.id,
          from: p.name,
          subject: 'My contract',
          body: `"My contract ends this season and I haven't heard anything. I'd like to know where I stand."`,
          options: [
            { id: 'open-talks', label: 'Open talks now', hint: 'Go to the Club tab to make him an offer. He appreciates it.' },
            { id: 'promise-contract', label: 'Promise a new deal before the summer', hint: 'Renew him before the season ends.' },
            { id: 'not-now', label: 'Not now', hint: 'He will worry about his future.' },
          ],
        }),
      );
      continue;
    }
    // A bigger club sniffing around a key player.
    const month = date.slice(5, 7);
    if (statusOf(state, p.id) === 'key' && ['12', '01', '02', '03'].includes(month) && overall(p) >= 13 && !recentlyTalked(state, `interest:${p.id}`) && rng.chance(0.04)) {
      const ours = club.players.reduce((s, x) => s + overall(x), 0) / club.players.length;
      const suitors = [...state.teams, ...(state.foreign ?? [])].filter((t) => t.id !== club.id && t.players.reduce((s, x) => s + overall(x), 0) / t.players.length > ours + 0.3);
      const suitor = suitors.length ? rng.pick(suitors) : undefined;
      if (!suitor) continue;
      out.push(
        message(state, {
          kind: 'interest',
          playerId: p.id,
          from: p.name,
          subject: `Interest from ${suitor.name}`,
          body: `"I've heard ${suitor.name} want me. It's a big club… I'd like to know what you think."`,
          options: [
            { id: 'let-go', label: 'Promise he can go for a fair offer', hint: 'If a club bids his asking price, you let him go.' },
            { id: 'insist', label: 'Insist he stays', hint: personality === 'ambitious' ? 'He will be upset.' : 'He accepts, for now.' },
            { id: 'improve', label: 'Offer to improve his contract', hint: 'Open contract talks in the Club tab.' },
          ],
        }),
      );
    }
  }

  // Bids for the manager's players (also on the Transfers tab).
  for (const o of currentOffers(state)) {
    const id = `offer-${o.id}`;
    if ((state.inbox ?? []).some((m) => m.id === id)) continue;
    const p = club.players.find((x) => x.id === o.playerId);
    const buyer = clubById(state, o.clubId);
    if (!p || !buyer) continue;
    out.push(
      message(state, {
        id,
        kind: 'offer',
        playerId: p.id,
        offerId: o.id,
        from: buyer.name,
        subject: `Bid for ${p.name}`,
        body: `${buyer.name} offer ${formatFee(o.fee)} for ${p.name}.`,
        options: [
          { id: 'accept', label: 'Accept', hint: 'He leaves for the fee.' },
          { id: 'reject', label: 'Reject' },
        ],
      }),
    );
  }

  // The board: a word at the halfway point of the league if things are going badly.
  const rounds = leagueRounds(state);
  const played = state.fixtures.filter((f) => f.competition === 'league' && f.result && (f.homeId === club.id || f.awayId === club.id)).length;
  if (rounds && played >= Math.floor(rounds / 2) && !(state.inbox ?? []).some((m) => m.kind === 'board' && m.id === `board-half-${state.season}`)) {
    const position = leagueTable(state).findIndex((r) => r.clubId === club.id) + 1;
    if (position > state.expectation + 2)
      out.push(
        message(state, {
          id: `board-half-${state.season}`,
          kind: 'board',
          from: 'The board',
          subject: 'Halfway through the season',
          body: `The board expected a top-${state.expectation} finish and the club is ${position}th. They expect a clear improvement in the second half of the season.`,
        }),
      );
    else if (position < state.expectation)
      out.push(message(state, { id: `board-half-${state.season}`, kind: 'board', from: 'The board', subject: 'Halfway through the season', body: `The board is pleased: ${position}th at the halfway point, ahead of the target (${state.expectation}th).` }));
  }
  return out;
}

// ---------------------------------------------------------------- answers and promises

/** Change one player's happiness (and optionally trust). */
function adjust(state: CareerState, playerId: string, happy: number, trust = 0): CareerState {
  return {
    ...state,
    happiness: { ...(state.happiness ?? {}), [playerId]: clamp(happinessOf(state, playerId) + happy, 0, 100) },
    trust: trust ? { ...(state.trust ?? {}), [playerId]: clamp(trustOf(state, playerId) + trust, 0, 100) } : state.trust,
  };
}

function promise(state: CareerState, playerId: string, kind: PromiseKind, text: string, deadline: string): CareerState {
  const made = today(state);
  return { ...state, promises: [...(state.promises ?? []), { id: `${kind}-${playerId}-${made}`, playerId, kind, text, made, deadline, status: 'open' }] };
}

/** A promise is only worth what the player's trust makes it. */
const believed = (state: CareerState, playerId: string, points: number) => Math.round(points * clamp(trustOf(state, playerId) / DEFAULT_TRUST, 0.3, 1.3));

/** Answer a message. */
export function answerMessage(state: CareerState, itemId: string, optionId: string): { message: string; state: CareerState } {
  const item = (state.inbox ?? []).find((m) => m.id === itemId);
  if (!item || item.answer) return { message: '', state };
  const p = item.playerId ? state.teams.find((t) => t.id === state.managedClubId)!.players.find((x) => x.id === item.playerId) : undefined;
  let next = state;
  let reply = '';
  const personality = p ? personalityOf(state.seed, p.id) : 'steady';
  const year = seasonYear(state.season);
  const seasonEnd = `${year + 1}-06-30`;
  const talked = (key: string) => (next = { ...next, lastTalk: { ...(next.lastTalk ?? {}), [key]: today(state) } });
  switch (`${item.kind}:${optionId}`) {
    case 'playing-time:promise-minutes':
      next = promise(adjust(next, p!.id, believed(state, p!.id, 12)), p!.id, 'minutes', 'More playing time over the next six weeks', addDays(today(state), 42));
      reply = `${p!.name} thanks you. He will hold you to it.`;
      talked(`minutes:${p!.id}`);
      break;
    case 'playing-time:raise-role': {
      const up = STATUSES[Math.max(0, STATUSES.indexOf(statusOf(state, p!.id)) - 1)];
      next = setSquadStatus(next, p!.id, up).state;
      reply = `${p!.name} is now ${up === 'key' ? 'a key player' : `a ${up} player`}, and expects to play like one.`;
      talked(`minutes:${p!.id}`);
      break;
    }
    case 'playing-time:earn-it':
      next = adjust(next, p!.id, personality === 'professional' ? 2 : personality === 'ambitious' ? -10 : -5);
      reply = personality === 'professional' ? `${p!.name} nods: "Fair enough. I'll show you in training."` : `${p!.name} is not happy with that answer.`;
      talked(`minutes:${p!.id}`);
      break;
    case 'contract:open-talks':
      next = adjust(next, p!.id, 5);
      reply = `${p!.name} is glad. Make him an offer in the Club tab.`;
      talked(`contract:${p!.id}`);
      break;
    case 'contract:promise-contract':
      next = promise(adjust(next, p!.id, believed(state, p!.id, 6)), p!.id, 'contract', 'A new contract before the summer', seasonEnd);
      reply = `${p!.name} will wait for your offer, but not forever.`;
      talked(`contract:${p!.id}`);
      break;
    case 'contract:not-now':
      next = adjust(next, p!.id, personality === 'ambitious' ? -10 : -6);
      reply = `${p!.name} leaves worried about his future.`;
      talked(`contract:${p!.id}`);
      break;
    case 'interest:let-go':
      next = promise(adjust(next, p!.id, believed(state, p!.id, 8)), p!.id, 'let-go', 'Free to leave if a club bids his asking price', seasonEnd);
      reply = `${p!.name} appreciates your honesty.`;
      talked(`interest:${p!.id}`);
      break;
    case 'interest:insist':
      next = adjust(next, p!.id, personality === 'ambitious' ? -12 : -4);
      reply = personality === 'ambitious' ? `${p!.name} is upset: "You're holding me back."` : `${p!.name} accepts. For now.`;
      talked(`interest:${p!.id}`);
      break;
    case 'interest:improve':
      next = adjust(next, p!.id, 6);
      reply = `${p!.name} is listening. Make him an offer in the Club tab.`;
      talked(`interest:${p!.id}`);
      break;
    case 'transfer-request:list':
      next = setTransferListed(adjust(next, p!.id, 10), p!.id, true);
      reply = `${p!.name} is on the transfer list. He thanks you.`;
      break;
    case 'transfer-request:refuse':
      next = rejectTransferRequest(adjust(next, p!.id, personality === 'ambitious' ? -10 : -4), p!.id).state;
      reply = `${p!.name} stays. He is not happy about it.`;
      break;
    case 'transfer-request:promise-move':
      next = promise(adjust(next, p!.id, believed(state, p!.id, 12)), p!.id, 'move', 'A move next summer', `${year + 1}-09-30`);
      next = rejectTransferRequest(next, p!.id).state;
      reply = `${p!.name} will stay until the summer, on your word.`;
      break;
    case 'offer:accept':
    case 'offer:reject': {
      const out = answerOffer(next, item.offerId!, optionId === 'accept');
      next = out.state;
      reply = out.message;
      // Turning down his asking price after promising he could go breaks that promise.
      if (optionId === 'reject') next = breakLetGo(next, item.playerId!);
      break;
    }
  }
  next = { ...next, inbox: (next.inbox ?? []).map((m) => (m.id === itemId ? { ...m, answer: optionId, reply, read: true } : m)) };
  return { message: reply, state: next };
}

function breakLetGo(state: CareerState, playerId: string): CareerState {
  const open = openPromises(state, playerId).find((x) => x.kind === 'let-go');
  return open ? settle(state, open, false) : state;
}

/** Keep or break a promise: trust and happiness follow, and a leader's anger spreads. */
function settle(state: CareerState, pr: PlayerPromise, kept: boolean): CareerState {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = club.players.find((x) => x.id === pr.playerId);
  let next: CareerState = { ...state, promises: (state.promises ?? []).map((x) => (x.id === pr.id ? { ...x, status: kept ? 'kept' : 'broken' } : x)) };
  if (!p) return next;
  next = adjust(next, p.id, kept ? 8 : -20, kept ? 10 : -25);
  const leader = leadersOf(state).includes(p.id);
  if (!kept && leader) {
    // The dressing room hears about it.
    const happiness = { ...(next.happiness ?? {}) };
    for (const x of club.players) if (x.id !== p.id) happiness[x.id] = clamp(happinessOf(next, x.id) - 3, 0, 100);
    next = { ...next, happiness };
  }
  const text = kept ? `${p.name} feels you kept your word: ${pr.text.toLowerCase()}.` : `${p.name} feels let down: you promised ${pr.text.toLowerCase()}.${leader ? ' As a leader, his anger spreads through the squad.' : ''}`;
  return { ...next, inbox: [...(next.inbox ?? []), message(next, { id: `promise-${pr.id}-${kept ? 'kept' : 'broken'}`, kind: 'promise', playerId: p.id, from: p.name, subject: kept ? 'Promise kept' : 'Promise broken', body: text })] };
}

/** Check promises against what happened. */
function reviewPromises(state: CareerState): CareerState {
  let next = state;
  const date = today(state);
  const year = seasonYear(state.season);
  for (const pr of openPromises(state)) {
    const p = state.teams.find((t) => t.id === state.managedClubId)!.players.find((x) => x.id === pr.playerId);
    if (!p) {
      // He left: a promised move is kept; other promises lapse.
      next = { ...next, promises: (next.promises ?? []).map((x) => (x.id === pr.id ? { ...x, status: 'kept' } : x)) };
      continue;
    }
    if (pr.kind === 'minutes') {
      const games = next.fixtures.filter((f) => f.result && f.date > pr.made && (f.homeId === state.managedClubId || f.awayId === state.managedClubId));
      if (games.length >= 4) {
        const log = next.matchLog?.[p.id] ?? [];
        const minutes = games.reduce((s, f) => s + (log.find((m) => m.date === f.date)?.minutes ?? 0), 0);
        const share = minutes / (games.length * 32);
        if (share >= expectedShare(statusOf(state, p.id), p.position) * 0.8) next = settle(next, pr, true);
        else if (date >= pr.deadline) next = settle(next, pr, false);
      } else if (date >= pr.deadline) next = settle(next, pr, false);
    } else if (pr.kind === 'contract') {
      if ((next.contracts[p.id]?.until ?? 0) > year) next = settle(next, pr, true);
      else if (date >= pr.deadline) next = settle(next, pr, false);
    } else if ((pr.kind === 'move' || pr.kind === 'let-go') && date >= pr.deadline) {
      // Still here past the deadline: a promised move is broken; "free to go" simply lapses.
      next = pr.kind === 'move' ? settle(next, pr, false) : { ...next, promises: (next.promises ?? []).map((x) => (x.id === pr.id ? { ...x, status: 'kept' } : x)) };
    }
  }
  return next;
}

/** Unanswered player messages past their date count as ignored. */
function expireMessages(state: CareerState): CareerState {
  let next = state;
  for (const m of state.inbox ?? []) {
    if (!m.options || m.answer || !expired(state, m)) continue;
    if (m.kind === 'transfer-request') {
      next = setTransferListed(next, m.playerId!, true);
    } else if (m.playerId && m.kind !== 'offer') next = adjust(next, m.playerId, -6, -5);
    next = { ...next, inbox: (next.inbox ?? []).map((x) => (x.id === m.id ? { ...x, answer: 'ignored', reply: m.kind === 'offer' ? 'The offer lapsed.' : 'You never replied.' } : x)) };
  }
  return next;
}

/** After each of the manager's matches: promises reviewed, ignored messages expire, new talks. */
export function inboxWeek(state: CareerState): CareerState {
  const md = nextMatchday(state) ?? 0;
  const rng = createRng((state.seed ^ Math.imul(md + 101, 0x2c1b3c6d)) >>> 0);
  let next = expireMessages(reviewPromises(state));
  const fresh = newMessages(next, rng);
  if (fresh.length) next = { ...next, inbox: [...(next.inbox ?? []), ...fresh].slice(-120) };
  return next;
}

/** The board's message at the start of a season. */
export function boardWelcome(state: CareerState): CareerState {
  const item = message(state, {
    id: `board-start-${state.season}`,
    kind: 'board',
    from: 'The board',
    subject: `Expectations for ${state.season}`,
    body: `The board expects a top-${state.expectation} finish in the ${state.leagueName}${state.europe?.comps.some((c) => c.phases.some((id) => state.europe!.phases.find((p) => p.id === id)!.entrants.includes(state.managedClubId))) ? ', and a good showing in Europe' : ''}.`,
  });
  if ((state.inbox ?? []).some((m) => m.id === item.id)) return state;
  return { ...state, inbox: [...(state.inbox ?? []), item] };
}

export const markRead = (state: CareerState, itemId: string): CareerState => ({ ...state, inbox: (state.inbox ?? []).map((m) => (m.id === itemId ? { ...m, read: true } : m)) });

/** For the profile: a player's open and recent promises. */
export const promisesFor = (state: CareerState, playerId: string) => (state.promises ?? []).filter((p) => p.playerId === playerId).slice(-5);

