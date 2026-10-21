import { useState } from 'react';
import type { MatchResult } from '../../../engine';
import {
  findPlayer,
  leagueTable,
  managedFixture,
  matchdaySquad,
  nextRound,
  recordResult,
  seasonFinished,
  simulateRound,
  topScorers,
  totalRounds,
  matchSetup,
  type CareerState,
  type Fixture,
  type TableRow,
} from '../../../game';
import { Crest } from '../Crest';
import { MatchPlayer } from '../match/MatchPlayer';
import { TacticsFields } from '../TacticsFields';
import { Fitness, SquadTab } from './SquadTab';
import { NewsFeed, TrainingTab } from './TrainingTab';

type Tab = 'overview' | 'squad' | 'training' | 'table' | 'fixtures' | 'stats';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const formatDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function CareerHub({ career, onChange, onExit }: { career: CareerState; onChange: (s: CareerState) => void; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [playing, setPlaying] = useState<{ fixture: Fixture; watchOnly: boolean } | null>(null);
  const [finishedResult, setFinishedResult] = useState<MatchResult | null>(null);
  const [lastRound, setLastRound] = useState<number | null>(null);

  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const table = leagueTable(career);
  const myRow = table.find((r) => r.clubId === club.id)!;
  const position = table.indexOf(myRow) + 1;
  const round = nextRound(career);
  const fixture = round !== undefined ? managedFixture(career, round) : undefined;

  /** Finish the round: store the manager's match (if any), simulate the rest, and save. */
  const completeRound = (result?: MatchResult, live = true) => {
    if (round === undefined) return;
    let next = career;
    if (result && fixture) next = recordResult(next, fixture.id, result, live ? 'live' : 'simulated');
    next = simulateRound(next, round);
    setLastRound(round);
    setPlaying(null);
    setFinishedResult(null);
    setTab('overview');
    onChange(next);
  };

  if (playing) {
    const setup = matchSetup(career, playing.fixture);
    return (
      <section>
        <div className="career-match-head card">
          <span className="muted">
            {career.leagueName} · Round {playing.fixture.round} · {formatDate(playing.fixture.date)}
          </span>
          {finishedResult ? (
            <button className="primary" onClick={() => completeRound(finishedResult, true)}>
              Continue → results of round {playing.fixture.round}
            </button>
          ) : (
            <span className="muted small">{playing.watchOnly ? 'Watching: the assistant coaches' : 'You are in charge: pause any time to make changes'}</span>
          )}
        </div>
        <MatchPlayer
          home={setup.home}
          away={setup.away}
          seed={setup.options.seed}
          options={setup.options}
          shootoutOnDraw={false}
          manage={playing.watchOnly ? null : playing.fixture.homeId === club.id ? 0 : 1}
          onFinished={setFinishedResult}
        />
      </section>
    );
  }

  return (
    <section className="career">
      <div className="career-header card">
        <div className="career-club">
          <Crest team={club} size={48} />
          <div>
            <h2>{club.name}</h2>
            <div className="muted">
              {career.leagueName} · {career.season}
            </div>
          </div>
        </div>
        <div className="career-badges">
          <span className="badge">
            <b>{ordinal(position)}</b> of {table.length}
          </span>
          <span className="badge">
            <b>{myRow.points}</b> pts
          </span>
          <span className="badge">
            Round <b>{round ?? totalRounds(career)}</b>/{totalRounds(career)}
          </span>
          <button onClick={onExit}>Save &amp; exit</button>
        </div>
      </div>

      <nav className="tabs sub-tabs">
        {(['overview', 'squad', 'training', 'table', 'fixtures', 'stats'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="career-grid">
          <div className="card">
            {seasonFinished(career) ? (
              <SeasonEnd career={career} table={table} />
            ) : fixture ? (
              <>
                <h3>Next match · Round {round}</h3>
                <div className="next-match">
                  <TeamBadge career={career} id={fixture.homeId} table={table} />
                  <div className="vs">
                    <div className="muted small">{formatDate(fixture.date)}</div>
                    <b>vs</b>
                    <div className="muted small">{fixture.homeId === club.id ? 'Home' : 'Away'}</div>
                  </div>
                  <TeamBadge career={career} id={fixture.awayId} table={table} />
                </div>
                <Readiness career={career} />
                <h4>Your tactics</h4>
                <TacticsFields tactics={career.tactics} onChange={(t) => onChange({ ...career, tactics: t })} />
                <div className="controls">
                  <button className="primary" onClick={() => setPlaying({ fixture, watchOnly: false })}>
                    ▶ Play live (you manage)
                  </button>
                  <button onClick={() => setPlaying({ fixture, watchOnly: true })}>Watch</button>
                  <button onClick={() => completeRound()}>⚡ Quick result</button>
                </div>
              </>
            ) : (
              <>
                <h3>Round {round}: no match this week</h3>
                <p className="muted">Your club rests this round (the league has an odd number of clubs).</p>
                <button className="primary" onClick={() => completeRound()}>
                  Play the round →
                </button>
              </>
            )}
          </div>
          <div className="card">
            <h3>Table</h3>
            <LeagueTable career={career} table={table} compact />
          </div>
          {lastRound !== null && <RoundResults career={career} round={lastRound} />}
          <NewsFeed career={career} />
        </div>
      )}
      {tab === 'table' && (
        <div className="card">
          <LeagueTable career={career} table={table} />
        </div>
      )}
      {tab === 'fixtures' && <Fixtures career={career} />}
      {tab === 'squad' && <SquadTab career={career} onChange={onChange} />}
      {tab === 'training' && <TrainingTab career={career} onChange={onChange} />}
      {tab === 'stats' && <Stats career={career} />}
      <p className="muted small">
        {career.generated.length > 0 && `Clubs marked * are generated: fictional names and players to complete the league. `}Your career is saved after every round.
      </p>
    </section>
  );
}

/** Squad readiness for the next match: fitness, injuries, morale. */
function Readiness({ career }: { career: CareerState }) {
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const squad = matchdaySquad(career, club.id);
  const fitness = Math.round(squad.reduce((s, id) => s + (career.squad[id]?.condition ?? 100), 0) / squad.length);
  const injured = club.players.filter((p) => career.squad[p.id]?.injury).length;
  const tired = squad.filter((id) => (career.squad[id]?.condition ?? 100) < 60).length;
  return (
    <div className="readiness">
      <span>
        Fitness <b>{fitness}%</b> <Fitness value={fitness} />
      </span>
      <span>
        Morale <b>{career.morale[club.id] ?? 60}</b>
      </span>
      <span className={injured ? 'warn' : ''}>
        Injured <b>{injured}</b>
      </span>
      {tired > 0 && (
        <span className="warn">
          {tired} tired in your 13
        </span>
      )}
    </div>
  );
}

function TeamBadge({ career, id, table }: { career: CareerState; id: string; table: TableRow[] }) {
  const t = career.teams.find((x) => x.id === id)!;
  const row = table.find((r) => r.clubId === id)!;
  return (
    <div className={`team-badge${id === career.managedClubId ? ' mine' : ''}`}>
      <Crest team={t} size={44} />
      <b>{clubName(career, id)}</b>
      <span className="muted small">
        {ordinal(table.indexOf(row) + 1)} · {row.points} pts
      </span>
      <Form form={row.form} />
    </div>
  );
}

const clubName = (career: CareerState, id: string) => `${career.teams.find((t) => t.id === id)?.name ?? id}${career.generated.includes(id) ? ' *' : ''}`;

function Form({ form }: { form: TableRow['form'] }) {
  return (
    <span className="form">
      {form.map((f, i) => (
        <span key={i} className={`form-${f}`}>
          {f}
        </span>
      ))}
    </span>
  );
}

function LeagueTable({ career, table, compact = false }: { career: CareerState; table: TableRow[]; compact?: boolean }) {
  return (
    <table className="league-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Club</th>
          <th title="Played">P</th>
          {!compact && (
            <>
              <th title="Won">W</th>
              <th title="Drawn">D</th>
              <th title="Lost">L</th>
              <th title="Goals for">GF</th>
              <th title="Goals against">GA</th>
            </>
          )}
          <th title="Goal difference">GD</th>
          <th title="Points">Pts</th>
          {!compact && <th>Form</th>}
        </tr>
      </thead>
      <tbody>
        {table.map((r, i) => {
          const t = career.teams.find((x) => x.id === r.clubId)!;
          return (
            <tr key={r.clubId} className={r.clubId === career.managedClubId ? 'mine' : ''}>
              <td>{i + 1}</td>
              <td className="club-cell">
                <Crest team={t} size={18} /> {clubName(career, r.clubId)}
              </td>
              <td>{r.played}</td>
              {!compact && (
                <>
                  <td>{r.won}</td>
                  <td>{r.drawn}</td>
                  <td>{r.lost}</td>
                  <td>{r.goalsFor}</td>
                  <td>{r.goalsAgainst}</td>
                </>
              )}
              <td>{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
              <td>
                <b>{r.points}</b>
              </td>
              {!compact && (
                <td>
                  <Form form={r.form} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FixtureRow({ career, f }: { career: CareerState; f: Fixture }) {
  const mine = f.homeId === career.managedClubId || f.awayId === career.managedClubId;
  const name = (id: string) => clubName(career, id);
  return (
    <div className={`fixture-row${mine ? ' mine' : ''}`}>
      <span className="fixture-home">
        {name(f.homeId)} <Crest team={career.teams.find((t) => t.id === f.homeId)!} size={18} />
      </span>
      <span className="fixture-score">{f.result ? `${f.result.score[0]} – ${f.result.score[1]}` : 'vs'}</span>
      <span className="fixture-away">
        <Crest team={career.teams.find((t) => t.id === f.awayId)!} size={18} /> {name(f.awayId)}
      </span>
    </div>
  );
}

function RoundResults({ career, round }: { career: CareerState; round: number }) {
  const fixtures = career.fixtures.filter((f) => f.round === round);
  const mine = fixtures.find((f) => f.homeId === career.managedClubId || f.awayId === career.managedClubId);
  return (
    <div className="card">
      <h3>Round {round} results</h3>
      {fixtures.map((f) => (
        <FixtureRow key={f.id} career={career} f={f} />
      ))}
      {mine?.result && mine.result.scorers.length > 0 && (
        <p className="muted small">
          Your scorers:{' '}
          {mine.result.scorers
            .filter((s) => career.teams.find((t) => t.id === career.managedClubId)!.players.some((p) => p.id === s.playerId))
            .map((s) => `${findPlayer(career, s.playerId)?.player.name}${s.goals > 1 ? ` ${s.goals}` : ''}`)
            .join(', ') || 'none'}
        </p>
      )}
    </div>
  );
}

function Fixtures({ career }: { career: CareerState }) {
  const rounds = [...new Set(career.fixtures.map((f) => f.round))];
  const next = nextRound(career);
  return (
    <div className="fixtures">
      {rounds.map((r) => {
        const fixtures = career.fixtures.filter((f) => f.round === r);
        return (
          <div key={r} className={`card${r === next ? ' current-round' : ''}`}>
            <h4>
              Round {r} <span className="muted small">· {formatDate(fixtures[0].date)}</span>
            </h4>
            {fixtures.map((f) => (
              <FixtureRow key={f.id} career={career} f={f} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Stats({ career }: { career: CareerState }) {
  const scorers = topScorers(career, 15);
  return (
    <div className="card">
      <h3>Top scorers</h3>
      {scorers.length === 0 && <p className="muted">No goals yet: play the first round.</p>}
      <table className="league-table">
        <tbody>
          {scorers.map((s, i) => {
            const found = findPlayer(career, s.playerId);
            if (!found) return null;
            return (
              <tr key={s.playerId} className={found.team.id === career.managedClubId ? 'mine' : ''}>
                <td>{i + 1}</td>
                <td>{found.player.name}</td>
                <td className="club-cell">
                  <Crest team={found.team} size={18} /> {clubName(career, found.team.id)}
                </td>
                <td>
                  <b>{s.goals}</b> goals
                </td>
                <td className="muted">{s.apps} apps</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SeasonEnd({ career, table }: { career: CareerState; table: TableRow[] }) {
  const champion = table[0];
  const myPosition = table.findIndex((r) => r.clubId === career.managedClubId) + 1;
  const champ = career.teams.find((t) => t.id === champion.clubId)!;
  return (
    <div className="season-end">
      <h3>Season complete</h3>
      <Crest team={champ} size={64} />
      <p>
        <b>{clubName(career, champion.clubId)}</b> are the {career.leagueName} champions with {champion.points} points.
      </p>
      <p>{myPosition === 1 ? '🏆 That is you: congratulations, champion!' : `Your club finished ${ordinal(myPosition)}.`}</p>
    </div>
  );
}
