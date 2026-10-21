// Database schema (Drizzle ORM). Plain column types so it can move from SQLite
// (local development) to Postgres when the game is deployed.

import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const competitions = sqliteTable('competitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tier: integer('tier').notNull(),
});

export const clubs = sqliteTable('clubs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  country: text('country').notNull(),
  rating: real('rating').notNull(),
  playable: integer('playable', { mode: 'boolean' }).notNull(),
});

export const clubCompetitions = sqliteTable(
  'club_competitions',
  {
    clubId: text('club_id').notNull().references(() => clubs.id),
    competitionId: text('competition_id').notNull().references(() => competitions.id),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.competitionId] })],
);

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  clubId: text('club_id').notNull().references(() => clubs.id),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  birthDate: text('birth_date'),
  nationality: text('nationality'),
  cap: integer('cap').notNull(),
  heightCm: integer('height_cm'),
  hand: text('hand').notNull(),
  handGuessed: integer('hand_guessed', { mode: 'boolean' }).notNull(),
  position: text('position').notNull(),
  positionSource: text('position_source').notNull(),
});

/** Game attributes (1–20). Kept apart from bio data because they change over time (training, aging). */
export const playerAttributes = sqliteTable('player_attributes', {
  playerId: text('player_id').primaryKey().references(() => players.id),
  speed: integer('speed').notNull(),
  stamina: integer('stamina').notNull(),
  shootingPower: integer('shooting_power').notNull(),
  shootingAccuracy: integer('shooting_accuracy').notNull(),
  passing: integer('passing').notNull(),
  legStrength: integer('leg_strength').notNull(),
  wrestling: integer('wrestling').notNull(),
  positioning: integer('positioning').notNull(),
  gameIQ: integer('game_iq').notNull(),
  reflexes: integer('reflexes').notNull(),
  gkPositioning: integer('gk_positioning').notNull(),
});

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competitions.id),
  round: text('round').notNull(),
  date: text('date').notNull(),
  venue: text('venue').notNull(),
  homeId: text('home_id').notNull().references(() => clubs.id),
  awayId: text('away_id').notNull().references(() => clubs.id),
  homeScore: integer('home_score').notNull(),
  awayScore: integer('away_score').notNull(),
});

/** Real per-match player stats (season totals are summed from these). */
export const playerMatchStats = sqliteTable(
  'player_match_stats',
  {
    matchId: text('match_id').notNull().references(() => matches.id),
    playerId: text('player_id').notNull().references(() => players.id),
    goals: integer('goals').notNull(),
    attempts: integer('attempts').notNull(),
    extraGoals: integer('extra_goals').notNull(),
    assists: integer('assists').notNull(),
    steals: integer('steals').notNull(),
    blocks: integer('blocks').notNull(),
    exclusions: integer('exclusions').notNull(),
    saves: integer('saves').notNull(),
    shotsFaced: integer('shots_faced').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.playerId] })],
);

// ---- Placeholders for later: accounts and saved games ----

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const saves = sqliteTable('saves', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  clubId: text('club_id').notNull().references(() => clubs.id),
  state: text('state', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});
