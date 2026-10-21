// Fill the local database from the real data set (data/cache → ratings → SQLite).
// Usage: npm run db:seed   (run `npm run data:fetch` first)

import { teamRating } from '../engine/ratings';
import { buildDataSet } from '../data/build';
import { isPlayable, ratePlayers, toEngineTeams } from '../data/ratings';
import { openDatabase, schema } from './db';

const { db, sqlite } = openDatabase();
const data = buildDataSet();
const rated = ratePlayers(data);
const teams = toEngineTeams(data, rated);

async function insertAll<T>(table: any, rows: T[]) {
  for (let i = 0; i < rows.length; i += 200) await db.insert(table).values(rows.slice(i, i + 200) as any);
}

sqlite.exec('BEGIN');
// Career saves point at clubs: check those links when the reload is complete, not row by row.
sqlite.exec('PRAGMA defer_foreign_keys = ON');
for (const t of ['player_match_stats', 'player_attributes', 'players', 'matches', 'club_competitions', 'clubs', 'competitions']) sqlite.exec(`DELETE FROM ${t}`);

await insertAll(schema.competitions, data.competitions);
await insertAll(
  schema.clubs,
  teams.map((t) => {
    const club = data.clubs.find((c) => c.id === t.id)!;
    return { id: t.id, name: t.name, shortName: club.shortName, country: club.country, rating: Number(teamRating(t.players).toFixed(2)), playable: isPlayable(t) };
  }),
);
await insertAll(schema.clubCompetitions, data.clubs.flatMap((c) => c.competitions.map((competitionId) => ({ clubId: c.id, competitionId }))));

const realById = new Map(data.players.map((p) => [p.id, p]));
await insertAll(
  schema.players,
  rated.map((p) => {
    const real = realById.get(p.realId)!;
    return {
      id: p.id, clubId: p.clubId, firstName: real.firstName, lastName: real.lastName, birthDate: real.birthDate ?? null,
      nationality: real.nationality ?? null, cap: p.cap, heightCm: real.heightCm ?? null, hand: p.hand, handGuessed: p.handGuessed,
      position: p.position, positionSource: real.positionSource,
    };
  }),
);
await insertAll(schema.playerAttributes, rated.map((p) => ({ playerId: p.id, ...p.attrs })));
await insertAll(
  schema.matches,
  data.matches.map((m) => ({ id: m.id, competitionId: m.competitionId, round: m.round, date: m.date, venue: m.venue, homeId: m.homeId, awayId: m.awayId, homeScore: m.score[0], awayScore: m.score[1] })),
);

const known = new Set(rated.map((p) => p.id));
const stats = new Map<string, any>();
for (const l of data.playerLines) {
  if (!known.has(l.playerId)) continue;
  stats.set(`${l.matchId}|${l.playerId}`, {
    matchId: l.matchId, playerId: l.playerId, goals: l.shots.total[0], attempts: l.shots.total[1], extraGoals: l.shots.extra[0],
    assists: l.assists, steals: l.steals, blocks: l.blocks, exclusions: l.exclusionsCenter + l.exclusionsField, saves: 0, shotsFaced: 0,
  });
}
for (const g of data.goalkeeperLines) {
  const row = stats.get(`${g.matchId}|${g.playerId}`);
  if (row) Object.assign(row, { saves: g.saves, shotsFaced: g.shotsFaced });
}
await insertAll(schema.playerMatchStats, [...stats.values()]);
sqlite.exec('COMMIT');

console.log(`Seeded ${data.competitions.length} competitions, ${teams.length} clubs (${teams.filter(isPlayable).length} playable), ${rated.length} players, ${data.matches.length} matches, ${stats.size} stat lines.`);
