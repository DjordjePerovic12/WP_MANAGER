import { useMemo, useState } from 'react';
import { matchRatings, type MatchResult } from '../../../engine';
import {
  findPlayer,
  leagueTable,
  managedFixture,
  matchdaySquad,
  formatMoney,
  transferWindow,
  currentOffers,
  nextMatchday,
  recordResult,
  seasonFinished,
  simulateMatchday,
  totalMatchdays,
  competitionName,
  knockoutResult,
  europeanZones,
  EURO_NAMES,
  leagueDef,
  europeanResult,
  isEuropean,
  clubById,
  takesPart,
  averageRating,
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
import { HistoryTab } from './HistoryTab';
import { ClubTab } from './ClubTab';
import { TransfersTab } from './TransfersTab';
import { StaffPanel } from './StaffPanel';
import { AcademyTab } from './AcademyTab';
import { PlayerLink, ProfileProvider, RatingBadge } from './PlayerProfile';
import { Bracket, CompTag, competitionKind, playoffCutoff } from './CompetitionsTab';
import { EuropeFocus, EuropePanel } from './EuropePanel';
import { SeasonReview, SummerReport } from './SeasonReview';

type Tab = 'overview' | 'squad' | 'academy' | 'training' | 'staff' | 'club' | 'transfers' | 'competitions' | 'fixtures' | 'stats' | 'history';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export function CareerHub({ career, onChange, onExit }: { career: CareerState; onChange: (s: CareerState) => void; onExit: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [playing, setPlaying] = useState<{
    fixture: Fixture;
    watchOnly: boolean;
  } | null>(null);
  const [finishedResult, setFinishedResult] = useState<MatchResult | null>(null);
  const [lastMatchday, setLastMatchday] = useState<number | null>(null);
  const [summerHidden, setSummerHidden] = useState(false);
  const seasonStarted = career.fixtures.some((f) => f.result);

  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const table = leagueTable(career);
  const myRow = table.find((r) => r.clubId === club.id)!;
  const position = table.indexOf(myRow) + 1;
  const matchday = nextMatchday(career);
  const fixture = matchday !== undefined ? managedFixture(career, matchday) : undefined;
  const matchdayFixtures = matchday !== undefined ? career.fixtures.filter((f) => f.matchday === matchday) : [];

  /** Finish the matchday: store the manager's match (if any), simulate the rest, and save. */
  const completeMatchday = (result?: MatchResult, live = true) => {
    if (matchday === undefined) return;
    let next = career;
    if (result && fixture) next = recordResult(next, fixture.id, result, live ? 'live' : 'simulated');
    next = simulateMatchday(next, matchday);
    // Like Football Manager: days without a match for the manager's club are played straight through
    // to the club's next game (the summer report and season end stop the run).
    for (let md = nextMatchday(next); md !== undefined && !managedFixture(next, md); md = nextMatchday(next)) next = simulateMatchday(next, md);
    setLastMatchday(matchday);
    setPlaying(null);
    setFinishedResult(null);
    setTab('overview');
    onChange(next);
  };

  if (playing) {
    const setup = matchSetup(career, playing.fixture);
    return (
      <ProfileProvider career={career} onChange={onChange}>
      <section>
        <div className="career-match-head card">
          <span className="muted">
            <CompTag career={career} id={playing.fixture.competition} /> {playing.fixture.stage} · {formatDate(playing.fixture.date)}
          </span>
          {finishedResult ? (
            <button className="primary" onClick={() => completeMatchday(finishedResult, true)}>
              Continue → results
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
          shootoutOnDraw
          manage={playing.watchOnly ? null : playing.fixture.homeId === club.id ? 0 : 1}
          onFinished={setFinishedResult}
        />
        {finishedResult && <MatchRatingsPanel career={career} result={finishedResult} />}
      </section>
      </ProfileProvider>
    );
  }

  return (
    <ProfileProvider career={career} onChange={onChange}>
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
              Matchday <b>{matchday ?? totalMatchdays(career)}</b>/{totalMatchdays(career)}
            </span>
            <span className="badge" title="Club balance">
              <b>{formatMoney(career.finances[club.id]?.balance ?? 0)}</b>
            </span>
            <span className="badge" title="Where the board expects you to finish">
              Board: <b>{ordinal(career.expectation)}</b>
            </span>
            <button onClick={onExit}>Save &amp; exit</button>
          </div>
        </div>

        <nav className="tabs sub-tabs">
          {(['overview', 'squad', 'academy', 'training', 'staff', 'club', 'transfers', 'competitions', 'fixtures', 'stats', 'history'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {tab === 'overview' && transferWindow(career) && (
          <div className="card window-banner open">
            <div>
              <b>{transferWindow(career) === 'summer' ? 'The summer transfer window is open' : 'The January transfer window is open'}</b>
              <div className="muted small">
                {currentOffers(career).length ? `${currentOffers(career).length} offer${currentOffers(career).length > 1 ? 's' : ''} for your players. ` : ''}
                Buy, sell and sign free agents before {transferWindow(career) === 'summer' ? 'the first round' : 'January ends'}.
              </div>
            </div>
            <button className="primary" onClick={() => setTab('transfers')}>
              Go to transfers →
            </button>
          </div>
        )}
        {tab === 'overview' && career.summer && !seasonStarted && !summerHidden && <SummerReport career={career} onDismiss={() => setSummerHidden(true)} />}
        {tab === 'overview' && (
          <div className="career-grid">
            <div className="card">
              {seasonFinished(career) ? (
                <SeasonReview
                  career={career}
                  onChange={(next) => {
                    setLastMatchday(null);
                    setSummerHidden(false);
                    onChange(next);
                  }}
                />
              ) : fixture ? (
                <>
                  <h3>
                    Next match <CompTag career={career} id={fixture.competition} /> <span className="muted small">{fixture.stage}</span>
                  </h3>
                  <div className={`next-match comp-border-${competitionKind(career, fixture.competition)}`}>
                    <TeamBadge career={career} id={fixture.homeId} table={table} fixture={fixture} />
                    <div className="vs">
                      <div className="muted small">{formatDate(fixture.date)}</div>
                      <b>vs</b>
                      <div className="muted small">{fixture.homeId === club.id ? 'Home' : 'Away'}</div>
                    </div>
                    <TeamBadge career={career} id={fixture.awayId} table={table} fixture={fixture} />
                  </div>
                  <Readiness career={career} />
                  <h4>Your tactics</h4>
                  <TacticsFields tactics={career.tactics} onChange={(t) => onChange({ ...career, tactics: t })} />
                  <div className="controls">
                    <button className="primary" onClick={() => setPlaying({ fixture, watchOnly: false })}>
                      ▶ Play live (you manage)
                    </button>
                    <button onClick={() => setPlaying({ fixture, watchOnly: true })}>Watch</button>
                    <button onClick={() => completeMatchday()}>⚡ Quick result</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>No match for you · {formatDate(matchdayFixtures[0]?.date ?? '')}</h3>
                  <p className="muted">
                    {matchdayFixtures.some((f) => f.competition === 'league')
                      ? 'Your club rests this matchday (the league has an odd number of clubs).'
                      : `Other clubs play: ${[...new Set(matchdayFixtures.map((f) => competitionName(career, f.competition)))].join(', ')}.`}
                  </p>
                  <button className="primary" onClick={() => completeMatchday()}>
                    Continue to your next match →
                  </button>
                </>
              )}
            </div>
            {fixture && isEuropean(fixture.competition) ? (
              // A European game next: the group table or the tie.
              <div>
                <EuropeFocus career={career} fixture={fixture} />
                <div className="card">
                  <KnockoutStatus career={career} />
                </div>
              </div>
            ) : fixture && fixture.competition !== 'league' ? (
              // A cup or playoff game next: show where it stands in that competition.
              <div>
                <Bracket career={career} comp={career.competitions.find((c) => c.id === fixture.competition)!} />
                <div className="card">
                  <KnockoutStatus career={career} />
                </div>
              </div>
            ) : (
              <div className="card">
                <h3>Table</h3>
                <LeagueTable career={career} table={table} compact cutoff={playoffCutoff(career)} />
                <KnockoutStatus career={career} />
              </div>
            )}
            {lastMatchday !== null && <MatchdayResults career={career} matchday={lastMatchday} />}
            <NewsFeed career={career} />
          </div>
        )}
        {tab === 'competitions' && (
          <>
            <div className="card">
              <h3>{career.leagueName}</h3>
              <LeagueTable career={career} table={table} cutoff={playoffCutoff(career)} />
              <p className="muted small">
                No draws: a game level after regular time goes to penalties. A win is worth 3 points, a shootout win 2, a shootout loss 1. The top {playoffCutoff(career)} go to the playoffs (below the
                line), and the playoff winner is champion.
              </p>
            </div>
            {career.competitions
              .filter((c) => c.kind !== 'league' && c.kind !== 'europe')
              .map((c) => (
                <Bracket key={c.id} career={career} comp={c} />
              ))}
            <EuropePanel career={career} />
          </>
        )}
        {tab === 'fixtures' && <Fixtures career={career} />}
        {tab === 'squad' && <SquadTab career={career} onChange={onChange} />}
        {tab === 'training' && <TrainingTab career={career} onChange={onChange} />}
        {tab === 'stats' && <Stats career={career} />}
        {tab === 'history' && <HistoryTab career={career} />}
        {tab === 'club' && <ClubTab career={career} onChange={onChange} />}
        {tab === 'transfers' && <TransfersTab career={career} onChange={onChange} />}
        {tab === 'staff' && <StaffPanel career={career} onChange={onChange} />}
        {tab === 'academy' && <AcademyTab career={career} onChange={onChange} />}
        <p className="muted small">
          {career.generated.length > 0 && `Clubs marked * have generated players (we have no roster for them yet). `}
          Your career is saved after every matchday.
        </p>
      </section>
    </ProfileProvider>
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
      {tired > 0 && <span className="warn">{tired} tired in your 13</span>}
    </div>
  );
}

function TeamBadge({ career, id, table, fixture }: { career: CareerState; id: string; table: TableRow[]; fixture?: Fixture }) {
  const t = clubById(career, id)!;
  const row = table.find((r) => r.clubId === id)!;
  // In a knockout game: the seed and the series score instead of the league position.
  const comp = fixture?.seriesId ? career.competitions.find((c) => c.id === fixture.competition) : undefined;
  const series = comp?.series?.find((s) => s.id === fixture!.seriesId);
  return (
    <div className={`team-badge${id === career.managedClubId ? ' mine' : ''}`}>
      <Crest team={t} size={44} />
      <b>{clubName(career, id)}</b>
      <span className="muted small">
        {series ? (
          <>
            Seed {comp!.seeds?.[id] ?? '–'}
            {series.bestOf > 1 && ` · ${series.wins[series.homeId === id ? 0 : 1]} win${series.wins[series.homeId === id ? 0 : 1] === 1 ? '' : 's'} (first to ${Math.floor(series.bestOf / 2) + 1})`}
          </>
        ) : row ? (
          `${ordinal(table.indexOf(row) + 1)} · ${row.points} pts`
        ) : (
          // A club from abroad (European games): its country instead of a league position.
          `${career.clubCountries?.[id] ?? 'Abroad'}`
        )}
      </span>
      {row && <Form form={row.form} />}
    </div>
  );
}

const clubName = (career: CareerState, id: string) => `${clubById(career, id)?.name ?? id}${career.generated.includes(id) ? ' *' : ''}`;

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

/** Where the managed club stands in the cup and playoffs. */
function KnockoutStatus({ career }: { career: CareerState }) {
  const lines = career.competitions
    .filter((c) => c.kind !== 'league' && (c.kind === 'europe' ? !!europeanResult(career, career.managedClubId) && europeanResult(career, career.managedClubId)!.comp === c.id : takesPart(c, career.managedClubId)))
    .map((c) => {
      if (c.kind === 'europe') {
        const r = europeanResult(career, career.managedClubId)!;
        const next = career.fixtures.find((f) => f.competition === c.id && !f.result && (f.homeId === career.managedClubId || f.awayId === career.managedClubId));
        return { name: c.name, text: next ? `${next.stage} v ${clubName(career, next.homeId === career.managedClubId ? next.awayId : next.homeId)}, ${formatDate(next.date)}` : r.result };
      }
      const result = knockoutResult(career, c.id, career.managedClubId);
      const next = career.fixtures.find((f) => f.competition === c.id && !f.result && (f.homeId === career.managedClubId || f.awayId === career.managedClubId));
      const text = c.championId
        ? c.championId === career.managedClubId
          ? '🏆 Winners!'
          : `${result ?? 'Not in it'} · won by ${clubName(career, c.championId)}`
        : next
          ? `${next.stage} v ${clubName(career, next.homeId === career.managedClubId ? next.awayId : next.homeId)}, ${formatDate(next.date)}`
          : !c.series?.length
            ? c.kind === 'playoff'
              ? `Top ${2 ** (c.plan?.length ?? 0)}${c.clubs ? ` ${c.name.split(' ')[0]} clubs` : ''} qualify${c.after ? ' (after the league playoffs)' : ''}`
              : 'Not started'
            : result && !result.startsWith('Out') && result !== 'Did not qualify'
              ? `${result}: waiting for the draw`
              : (result ?? 'Not in it');
      return { name: c.name, text };
    });
  if (!lines.length) return null;
  return (
    <div className="knockout-status">
      {lines.map((l) => (
        <div key={l.name} className="small">
          <span className="muted">{l.name}:</span> {l.text}
        </div>
      ))}
    </div>
  );
}

function LeagueTable({ career, table, compact = false, cutoff }: { career: CareerState; table: TableRow[]; compact?: boolean; cutoff?: number }) {
  const draws = table.some((r) => r.drawn > 0);
  // European places by final position (single-country leagues; the VRL qualifies through national championships).
  const def = leagueDef(career.leagueId);
  const zones = career.foreign?.length && !def.national && def.countries.length === 1 ? europeanZones(def.countries[0]) : {};
  return (
    <table className="league-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Club</th>
          <th title="Played">P</th>
          {!compact && (
            <>
              <th title="Won in regular time">W</th>
              <th title="Won on penalties (2 points)">WP</th>
              <th title="Lost on penalties (1 point)">LP</th>
              {draws && <th title="Drawn (before the no-draw rule)">D</th>}
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
            <tr key={r.clubId} className={`${r.clubId === career.managedClubId ? 'mine' : ''}${cutoff && i === cutoff - 1 ? ' cutoff' : ''}${zones[i + 1] ? ` zone-${zones[i + 1]}` : ''}`} title={zones[i + 1] ? `Finishing here: ${EURO_NAMES[zones[i + 1]]}` : undefined}>
              <td>{i + 1}</td>
              <td className="club-cell">
                <Crest team={t} size={18} /> {clubName(career, r.clubId)}
              </td>
              <td>{r.played}</td>
              {!compact && (
                <>
                  <td>{r.won}</td>
                  <td>{r.shootoutWon}</td>
                  <td>{r.shootoutLost}</td>
                  {draws && <td>{r.drawn}</td>}
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
        {name(f.homeId)} <Crest team={clubById(career, f.homeId)!} size={18} />
      </span>
      <span className="fixture-score">{f.result ? `${f.result.score[0]} – ${f.result.score[1]}` : 'vs'}</span>
      <span className="fixture-away">
        <Crest team={clubById(career, f.awayId)!} size={18} /> {name(f.awayId)}
      </span>
    </div>
  );
}

/** Group a matchday's fixtures by competition and stage. */
function byCompetition(career: CareerState, fixtures: Fixture[]) {
  const groups = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const key = `${competitionName(career, f.competition)} · ${f.stage}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups];
}

function MatchdayResults({ career, matchday }: { career: CareerState; matchday: number }) {
  const fixtures = career.fixtures.filter((f) => f.matchday === matchday);
  const mine = fixtures.find((f) => f.homeId === career.managedClubId || f.awayId === career.managedClubId);
  const mom = mine?.result?.manOfTheMatch ? findPlayer(career, mine.result.manOfTheMatch) : undefined;
  return (
    <div className="card">
      <h3>
        Results <span className="muted small">· {formatDate(fixtures[0]?.date ?? '')}</span>
      </h3>
      {byCompetition(career, fixtures).map(([label, list]) => (
        <div key={label}>
          <h4 className="muted small">
            <CompTag career={career} id={list[0].competition} /> {list[0].stage}
          </h4>
          {list.map((f) => (
            <FixtureRow key={f.id} career={career} f={f} />
          ))}
        </div>
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
      {mom && (
        <p className="small">
          ⭐ Man of the match: <PlayerLink id={mom.player.id}>{mom.player.name}</PlayerLink> <span className="muted">({mom.team.name})</span>
        </p>
      )}
    </div>
  );
}

/** Ratings out of 10 for both teams after a match, best first. */
function MatchRatingsPanel({ career, result }: { career: CareerState; result: MatchResult }) {
  const { ratings, manOfTheMatch } = matchRatings(result);
  return (
    <div className="card">
      <h3>Player ratings</h3>
      <div className="ratings-grid">
        {result.teams.map((team) => (
          <div key={team.id}>
            <h4 className={team.id === career.managedClubId ? '' : 'muted'}>{team.name}</h4>
            <table className="league-table">
              <tbody>
                {team.players
                  .filter((p) => ratings[p.id] !== undefined)
                  .sort((a, b) => ratings[b.id] - ratings[a.id])
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.cap}</td>
                      <td style={{ textAlign: 'left' }}>
                        <PlayerLink id={p.id}>{p.name}</PlayerLink> {p.id === manOfTheMatch && <span title="Man of the match">⭐</span>}
                      </td>
                      <td className="muted small">{p.position}</td>
                      <td>
                        <RatingBadge value={ratings[p.id]} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The season calendar: every matchday with its date, grouped by competition. */
function Fixtures({ career }: { career: CareerState }) {
  const [mineOnly, setMineOnly] = useState(true);
  const next = nextMatchday(career);
  const club = career.managedClubId;
  const days = [...new Set(career.fixtures.map((f) => f.matchday))].sort((a, b) => a - b);
  if (mineOnly) {
    const mine = career.fixtures.filter((f) => f.homeId === club || f.awayId === club).sort((a, b) => a.matchday - b.matchday);
    return (
      <div className="card">
        <CalendarToggle mineOnly={mineOnly} onChange={setMineOnly} />
        <table className="league-table calendar-table">
          <tbody>
            {mine.map((f) => {
              const home = f.homeId === club;
              const opp = home ? f.awayId : f.homeId;
              const score = f.result ? (home ? f.result.score : ([f.result.score[1], f.result.score[0]] as [number, number])) : undefined;
              const outcome = score ? (score[0] > score[1] ? 'W' : score[0] < score[1] ? 'L' : 'D') : undefined;
              return (
                <tr key={f.id} className={f.matchday === next ? 'mine' : ''}>
                  <td className="muted small">{formatDate(f.date)}</td>
                  <td style={{ textAlign: 'left' }}>
                    <CompTag career={career} id={f.competition} /> <span className="muted small">{f.stage}</span>
                  </td>
                  <td className="muted">{home ? 'H' : 'A'}</td>
                  <td className="club-cell">
                    <Crest team={clubById(career, opp)!} size={18} /> {clubName(career, opp)}
                  </td>
                  <td>
                    {score ? (
                      <>
                        <span className="form">
                          <span className={`form-${outcome}`}>{outcome}</span>
                        </span>{' '}
                        {score[0]}–{score[1]}
                      </>
                    ) : f.matchday === next ? (
                      <b>Next</b>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className="card">
        <CalendarToggle mineOnly={mineOnly} onChange={setMineOnly} />
      </div>
      <div className="fixtures">
        {days.map((d) => {
          const fixtures = career.fixtures.filter((f) => f.matchday === d);
          return (
            <div key={d} className={`card${d === next ? ' current-round' : ''}`}>
              <h4>
                {formatDate(fixtures[0].date)} <span className="muted small">· matchday {d}</span>
              </h4>
              {byCompetition(career, fixtures).map(([label, list]) => (
                <div key={label}>
                  <div className="muted small">{label}</div>
                  {list.map((f) => (
                    <FixtureRow key={f.id} career={career} f={f} />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CalendarToggle({ mineOnly, onChange }: { mineOnly: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="tabs">
      <button className={mineOnly ? 'active' : ''} onClick={() => onChange(true)}>
        My matches
      </button>
      <button className={mineOnly ? '' : 'active'} onClick={() => onChange(false)}>
        All matches
      </button>
    </div>
  );
}

type StatKey = 'rating' | 'mom' | 'apps' | 'minutes' | 'goals' | 'shots' | 'shotPct' | 'assists' | 'exclusionsDrawn' | 'fouls' | 'saves' | 'savePct';
const STAT_COLUMNS: { key: StatKey; label: string; title?: string }[] = [
  { key: 'rating', label: 'Rating', title: 'Average match rating out of 10 (at least 3 rated matches)' },
  { key: 'mom', label: '⭐', title: 'Man of the match' },
  { key: 'apps', label: 'Apps' },
  { key: 'minutes', label: 'Min' },
  { key: 'goals', label: 'Goals' },
  { key: 'shots', label: 'Shots' },
  {
    key: 'shotPct',
    label: 'Shot %',
    title: 'Goals per shot (at least 10 shots)',
  },
  { key: 'assists', label: 'Ast' },
  { key: 'exclusionsDrawn', label: 'Excl. won', title: 'Exclusions drawn' },
  { key: 'fouls', label: 'Fouls', title: 'Personal fouls' },
  { key: 'saves', label: 'Saves' },
  {
    key: 'savePct',
    label: 'Save %',
    title: 'Saves per shot on goal (goalkeepers, at least 3 apps)',
  },
];

/** League-wide player stats for this season: sortable, filterable, every name opens the profile. */
function Stats({ career }: { career: CareerState }) {
  const [sort, setSort] = useState<StatKey>('goals');
  const [position, setPosition] = useState<'ALL' | 'GK' | 'FIELD'>('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const rows = useMemo(
    () =>
      Object.entries(career.playerStats)
        .map(([playerId, s]) => {
          const found = findPlayer(career, playerId);
          const conceded = s.conceded ?? 0;
          return {
            playerId,
            found,
            ...s,
            shotPct: s.shots >= 10 ? s.goals / s.shots : -1,
            rating: (s.rated ?? 0) >= 3 ? (averageRating(s) ?? -1) : -1,
            mom: s.mom ?? 0,
            savePct: s.apps >= 3 && s.saves + conceded > 0 ? s.saves / (s.saves + conceded) : -1,
          };
        })
        .filter((r) => r.found && r.apps > 0),
    [career],
  );
  const shown = rows
    .filter((r) => position === 'ALL' || (position === 'GK') === (r.found!.player.position === 'GK'))
    .filter((r) => !mineOnly || r.found!.team.id === career.managedClubId)
    .sort((a, b) => b[sort] - a[sort] || a.apps - b.apps)
    .slice(0, 60);
  const fmt = (r: (typeof rows)[number], k: StatKey) =>
    k === 'rating' ? (r.rating < 0 ? '–' : r.rating.toFixed(2)) : k === 'shotPct' || k === 'savePct' ? (r[k] < 0 ? '–' : `${Math.round(r[k] * 100)}%`) : r[k];
  return (
    <div className="card">
      <h3>Player stats · {career.season}</h3>
      <div className="market-filters">
        <select value={position} onChange={(e) => setPosition(e.target.value as typeof position)}>
          <option value="ALL">All players</option>
          <option value="FIELD">Field players</option>
          <option value="GK">Goalkeepers</option>
        </select>
        <label className="small">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> My club only
        </label>
        <span className="muted small">Click a column to sort, a name to open the player.</span>
      </div>
      {rows.length === 0 && <p className="muted">No matches played yet: play the first round.</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="league-table stats-table">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>Player</th>
                <th style={{ textAlign: 'left' }}>Club</th>
                <th>Pos</th>
                {STAT_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title} className={`sortable${sort === c.key ? ' sorted' : ''}`} onClick={() => setSort(c.key)}>
                    {c.label}
                    {sort === c.key ? ' ▾' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.playerId} className={r.found!.team.id === career.managedClubId ? 'mine' : ''}>
                  <td>{i + 1}</td>
                  <td style={{ textAlign: 'left' }}>
                    <PlayerLink id={r.playerId}>{r.found!.player.name}</PlayerLink>
                  </td>
                  <td className="club-cell">
                    <Crest team={r.found!.team} size={16} /> {clubName(career, r.found!.team.id)}
                  </td>
                  <td>{r.found!.player.position}</td>
                  {STAT_COLUMNS.map((c) => (
                    <td key={c.key}>{sort === c.key ? <b>{fmt(r, c.key)}</b> : fmt(r, c.key)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
