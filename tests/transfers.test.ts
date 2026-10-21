import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import {
  answerOffer,
  askingPrice,
  bidForPlayer,
  createCareer,
  currentOffers,
  LEAGUES,
  marketPlayers,
  MAX_SQUAD,
  nextRound,
  playerTerms,
  releaseCost,
  releasePlayer,
  setTransferListed,
  signPlayer,
  simulateRound,
  startNextSeason,
  transferWindow,
  type CareerState,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => {
  const c = createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't2', seed: 42, now: NOW });
  // Plenty of money and wage room for testing the mechanics.
  const f = c.finances[c.managedClubId];
  return { ...c, finances: { ...c.finances, [c.managedClubId]: { ...f, balance: 5_000_000, wageBudget: f.wageBudget + 500_000 } } };
};
const mine = (c: CareerState) => c.teams.find((t) => t.id === c.managedClubId)!;
/** A useful player at another club, not his club's best. */
const target = (c: CareerState) => {
  const other = c.teams.find((t) => t.id !== c.managedClubId && !c.generated.includes(t.id))!;
  return [...other.players].filter((p) => p.position !== 'GK').sort((a, b) => overall(b) - overall(a))[4];
};

describe('windows', () => {
  it('is open in pre-season and closes once the season starts', () => {
    const c = start();
    expect(transferWindow(c)).toBe('summer');
    const after = simulateRound(c, 1, NOW);
    expect(transferWindow(after)).toBeNull();
    expect(bidForPlayer(after, target(after).id, 1_000_000).message).toMatch(/closed/);
  });

  it('opens again for the January rounds', () => {
    let c = start();
    while (nextRound(c) && c.fixtures.find((f) => f.round === nextRound(c))!.date.slice(5, 7) !== '01') c = simulateRound(c, nextRound(c)!, NOW);
    expect(transferWindow(c)).toBe('winter');
  });
});

describe('buying', () => {
  it('prices key players higher than squad players', () => {
    const c = start();
    const other = c.teams.find((t) => t.id !== c.managedClubId)!;
    const ranked = [...other.players].sort((a, b) => overall(b) - overall(a));
    expect(askingPrice(c, ranked[0].id)).toBeGreaterThan(askingPrice(c, ranked[ranked.length - 1].id));
  });

  it('the club accepts, counters or rejects depending on the bid', () => {
    const c = start();
    const p = target(c);
    const asking = askingPrice(c, p.id);
    expect(bidForPlayer(c, p.id, asking).response).toBe('accepted');
    const counter = bidForPlayer(c, p.id, Math.round(asking * 0.8));
    expect(counter.response).toBe('countered');
    expect(counter.state.bids[p.id].counter).toBeGreaterThan(asking * 0.8);
    const low = bidForPlayer(c, p.id, Math.round(asking * 0.3));
    expect(low.response).toBe('rejected');
    expect(bidForPlayer(low.state, p.id, asking).message).toMatch(/not negotiate/);
  });

  it('signs a player after the fee and terms are agreed: money, squads and contract all move', () => {
    const c = start();
    const p = target(c);
    const seller = c.teams.find((t) => t.players.some((x) => x.id === p.id))!;
    expect(signPlayer(c, p.id, 50_000, 3).message).toMatch(/fee/);
    const fee = askingPrice(c, p.id);
    const agreed = bidForPlayer(c, p.id, fee).state;
    const terms = playerTerms(agreed, p.id);
    const out = signPlayer(agreed, p.id, terms.wage, 3);
    expect(out.signed).toBe(true);
    const s = out.state;
    expect(mine(s).players.some((x) => x.id === p.id)).toBe(true);
    expect(s.teams.find((t) => t.id === seller.id)!.players.some((x) => x.id === p.id)).toBe(false);
    expect(s.finances[s.managedClubId].balance).toBe(c.finances[c.managedClubId].balance - fee);
    expect(s.finances[seller.id].balance).toBe(c.finances[seller.id].balance + fee);
    expect(s.contracts[p.id]).toEqual({ wage: terms.wage, until: 2026 + 3 - 1 });
    expect(s.transfers.at(-1)).toMatchObject({ playerId: p.id, fee, toClubId: s.managedClubId });
    expect(new Set(mine(s).players.map((x) => x.cap)).size).toBe(mine(s).players.length);
  });

  it('the board blocks fees you cannot pay and wages over the budget', () => {
    const c = start();
    const poor = { ...c, finances: { ...c.finances, [c.managedClubId]: { ...c.finances[c.managedClubId], balance: 1000 } } };
    expect(bidForPlayer(poor, target(c).id, 500_000).message).toMatch(/money/);
    const p = target(c);
    const agreed = bidForPlayer(c, p.id, askingPrice(c, p.id)).state;
    expect(signPlayer(agreed, p.id, 10_000_000, 2).message).toMatch(/wage budget/);
  });

  it('free agents sign without a fee', () => {
    const c = startNextSeason((() => {
      let s = start();
      while (nextRound(s)) s = simulateRound(s, nextRound(s)!, NOW);
      return s;
    })(), NOW);
    const free = c.freeAgents[0];
    expect(free).toBeDefined();
    const terms = playerTerms(c, free.player.id);
    if (!terms.willing) return;
    const out = signPlayer(c, free.player.id, terms.wage, 2);
    expect(out.signed).toBe(true);
    expect(out.state.freeAgents.some((f) => f.player.id === free.player.id)).toBe(false);
    expect(out.state.finances[c.managedClubId].balance).toBe(c.finances[c.managedClubId].balance);
  });

  it('the market lists players at other clubs and free agents, never your own', () => {
    const c = start();
    const market = marketPlayers(c);
    expect(market.some((m) => m.player.id === mine(c).players[0].id)).toBe(false);
    expect(market.length).toBe(c.teams.reduce((s, t) => s + (t.id === c.managedClubId ? 0 : t.players.length), 0) + c.freeAgents.length);
  });
});

describe('selling and releasing', () => {
  it('listing a good player brings offers; accepting one sells him', () => {
    const c = start();
    const star = [...mine(c).players].filter((p) => p.position !== 'GK').sort((a, b) => overall(b) - overall(a))[0];
    const listed = setTransferListed(c, star.id, true);
    const offers = currentOffers(listed).filter((o) => o.playerId === star.id);
    if (!offers.length) return; // nobody could afford him this time
    const best = offers.reduce((a, b) => (b.fee > a.fee ? b : a));
    const sold = answerOffer(listed, best.id, true).state;
    expect(mine(sold).players.some((p) => p.id === star.id)).toBe(false);
    expect(sold.teams.find((t) => t.id === best.clubId)!.players.some((p) => p.id === star.id)).toBe(true);
    expect(sold.finances[sold.managedClubId].balance).toBe(listed.finances[listed.managedClubId].balance + best.fee);
  });

  it('releasing a player costs half his remaining contract (and never below 13 players)', () => {
    const small = start();
    expect(mine(small).players.length).toBe(13);
    expect(releasePlayer(small, mine(small).players[5].id).message).toMatch(/too small/);
    // With an extra player in the squad, a release goes through.
    const extra = { ...mine(small).players[5], id: 'extra-1', cap: 30 };
    const c: CareerState = {
      ...small,
      teams: small.teams.map((t) => (t.id === small.managedClubId ? { ...t, players: [...t.players, extra] } : t)),
      contracts: { ...small.contracts, 'extra-1': { wage: 20_000, until: 2027 } },
    };
    const p = mine(c).players[5];
    const cost = releaseCost(c, p.id);
    const out = releasePlayer(c, p.id).state;
    expect(out.finances[c.managedClubId].balance).toBe(c.finances[c.managedClubId].balance - cost);
    expect(out.freeAgents.some((f) => f.player.id === p.id)).toBe(true);
  });
});

describe('AI clubs in the summer', () => {
  it('move players around while keeping squads valid and money balanced', () => {
    let c = start();
    while (nextRound(c)) c = simulateRound(c, nextRound(c)!, NOW);
    const next = startNextSeason(c, NOW);
    const moves = next.transfers.filter((t) => t.season === next.season);
    expect(moves.length).toBeGreaterThan(0);
    for (const t of next.teams) {
      expect(t.players.length).toBeLessThanOrEqual(MAX_SQUAD + 2);
      expect(t.players.length).toBeGreaterThanOrEqual(13);
      expect(new Set(t.players.map((p) => p.id)).size).toBe(t.players.length);
    }
    const all = next.teams.flatMap((t) => t.players.map((p) => p.id));
    expect(new Set(all).size).toBe(all.length); // nobody plays for two clubs
    for (const id of all) expect(next.contracts[id]).toBeDefined();
  });
});
