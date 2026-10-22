// Combine data sets from several sources (European Aquatics + domestic federations)
// into one, without duplicates: the same club or player appearing in two sources
// becomes one entry, keeping the first source's id and filling in missing details
// (birth date, height, hand, an official position) from the other.

import type { Club, DataSet, RealPlayer } from './model';
import { nameKey } from './normalize';

/** Club names without sponsors and prefixes, for matching across sources. */
export function clubKey(name: string) {
  return nameKey(name.replace(/\b(VK|VPK|HAVK|PVK|SPD|CN|AN|ASD|VSE|SE|SC|SV|KPK|OVK|HVK|WPC|ASC)\b/gi, ' '));
}

const firstToken = (s: string) => nameKey(s.split(/[\s-]+/)[0] ?? '');

/** Is this the same person? Same surname, and the same birth date or (with no birth date) the same first name. */
function samePlayer(a: RealPlayer, b: RealPlayer) {
  const la = nameKey(a.lastName);
  const lb = nameKey(b.lastName);
  const surname = la === lb || (la.length > 3 && lb.length > 3 && (la.startsWith(lb) || lb.startsWith(la)));
  if (!surname) return false;
  if (a.birthDate && b.birthDate) return a.birthDate === b.birthDate;
  return firstToken(a.firstName) === firstToken(b.firstName);
}

export interface MergeOptions {
  /** extra club id → base club id, for clubs whose names differ between sources */
  clubAliases?: Record<string, string>;
}

/**
 * Add `extra` to `base`. Clubs match by alias or by name; players match within the same
 * (matched) club by name and birth date. Everything else is appended.
 */
export function mergeDataSets(base: DataSet, extra: DataSet, options: MergeOptions = {}): DataSet {
  const clubId = new Map<string, string>();
  const clubs: Club[] = base.clubs.map((c) => ({ ...c, competitions: [...c.competitions] }));
  const byKey = new Map(clubs.map((c) => [clubKey(c.name), c]));
  const byShortKey = new Map(clubs.map((c) => [clubKey(c.shortName), c]));
  for (const c of extra.clubs) {
    const target =
      clubs.find((x) => x.id === options.clubAliases?.[c.id]) ?? (c.country ? [byKey.get(clubKey(c.name)), byShortKey.get(clubKey(c.name))].find((x) => x && x.country === c.country) : undefined);
    if (target) {
      clubId.set(c.id, target.id);
      for (const comp of c.competitions) if (!target.competitions.includes(comp)) target.competitions.push(comp);
    } else {
      clubId.set(c.id, c.id);
      clubs.push({ ...c, competitions: [...c.competitions] });
    }
  }
  const mapClub = (id: string) => clubId.get(id) ?? id;

  // Players: match within the club (after club matching), then anywhere with a birth date.
  const playerId = new Map<string, string>();
  const players = base.players.map((p) => ({ ...p }));
  for (const p of extra.players) {
    const club = mapClub(p.clubId);
    const target = players.find((x) => x.clubId === club && samePlayer(x, p)) ?? (p.birthDate ? players.find((x) => x.birthDate === p.birthDate && samePlayer(x, p)) : undefined);
    if (target) {
      playerId.set(p.id, target.id);
      target.birthDate ??= p.birthDate;
      target.nationality ??= p.nationality;
      target.heightCm ??= p.heightCm;
      target.hand ??= p.hand;
      target.cap ??= p.cap;
      if (target.positionSource !== 'official' && p.positionSource === 'official') {
        target.position = p.position;
        target.positionSource = 'official';
      }
    } else {
      playerId.set(p.id, p.id);
      players.push({ ...p, clubId: club });
    }
  }
  const mapPlayer = (id: string) => playerId.get(id) ?? id;

  return {
    source: `${base.source}; ${extra.source}`,
    season: base.season,
    fetchedAt: base.fetchedAt > extra.fetchedAt ? base.fetchedAt : extra.fetchedAt,
    competitions: [...base.competitions, ...extra.competitions.filter((c) => !base.competitions.some((b) => b.id === c.id))],
    clubs,
    players,
    matches: [...base.matches, ...extra.matches.map((m) => ({ ...m, homeId: mapClub(m.homeId), awayId: mapClub(m.awayId) }))],
    playerLines: [...base.playerLines, ...extra.playerLines.map((l) => ({ ...l, playerId: mapPlayer(l.playerId), clubId: mapClub(l.clubId) }))],
    goalkeeperLines: [...base.goalkeeperLines, ...extra.goalkeeperLines.map((l) => ({ ...l, playerId: mapPlayer(l.playerId), clubId: mapClub(l.clubId) }))],
    teamLines: [...base.teamLines, ...extra.teamLines.map((l) => ({ ...l, clubId: mapClub(l.clubId), opponentId: mapClub(l.opponentId) }))],
  };
}
