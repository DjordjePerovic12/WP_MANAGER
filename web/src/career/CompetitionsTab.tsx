import { clubById, gameWinner, isEuropean, leagueDef, type CareerState, type Competition, type Fixture, type Series } from '../../../game';
import { Crest } from '../Crest';

const formatDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const clubName = (career: CareerState, id: string) => clubById(career, id)?.name ?? id;

/** Playoffs and cup: one column per round, a box per tie. */
export function Bracket({ career, comp }: { career: CareerState; comp: Competition }) {
  const plan = comp.plan ?? [];
  const champion = comp.championId ? clubById(career, comp.championId) : undefined;
  return (
    <div className="card">
      <h3>
        {comp.name}
        {champion && (
          <span className="bracket-champion">
            {' '}
            🏆 <Crest team={champion} size={18} /> {champion.name}
          </span>
        )}
      </h3>
      {!comp.series?.length ? (
        <p className="muted">
          {comp.kind === 'playoff'
            ? comp.after
              ? `The top ${2 ** plan.length} ${comp.name.split(' ')[0]} clubs in the league table qualify. It starts after the league playoffs.`
              : `The top ${2 ** plan.length} of the regular season qualify. The playoffs start when the league is over.`
            : 'The draw is made at the start of the season.'}
        </p>
      ) : (
        <div className="bracket">
          {plan.map((spec, i) => {
            const round = comp.rounds?.[i];
            const series = (comp.series ?? []).filter((s) => s.round === i + 1);
            const planned = comp.roundDates?.[i];
            return (
              <div key={i} className="bracket-round">
                <div className="bracket-round-head">
                  <b>{spec.name}</b>
                  <span className="muted small">
                    {spec.finalFour ? 'Final Four' : spec.bestOf > 1 ? `best of ${spec.bestOf}` : 'one game'}
                    {round ? ` · ${formatDate(round.date)}` : planned ? ` · ${formatDate(planned)}` : ''}
                  </span>
                </div>
                {series.length === 0 && <div className="muted small bracket-tbd">To be decided</div>}
                {series.map((s) => (
                  <Tie key={s.id} career={career} s={s} games={career.fixtures.filter((f) => f.seriesId === s.id)} />
                ))}
                {i === 1 && comp.byes?.length ? <div className="muted small">Byes in round 1: {comp.byes.map((id) => clubName(career, id)).join(', ')}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tie({ career, s, games }: { career: CareerState; s: Series; games: Fixture[] }) {
  const mine = s.homeId === career.managedClubId || s.awayId === career.managedClubId;
  const single = s.bestOf === 1;
  const g = games[0];
  const row = (id: string, side: 0 | 1) => {
    const team = clubById(career, id)!;
    const score = single && g?.result ? (g.homeId === id ? g.result.score[0] : g.result.score[1]) : s.wins[side];
    return (
      <div className={`tie-row${s.winnerId === id ? ' winner' : s.winnerId ? ' loser' : ''}`}>
        <Crest team={team} size={16} /> <span className="tie-name">{team.name}</span>
        <b>{single && !g?.result ? '' : score}</b>
      </div>
    );
  };
  const shootout = single && g?.result?.shootout ? ` · ${g.result.shootout[0]}–${g.result.shootout[1]} pen.` : '';
  return (
    <div className={`tie${mine ? ' mine' : ''}`} title={games.map((x) => (x.result ? `${clubName(career, x.homeId)} ${x.result.score[0]}–${x.result.score[1]} ${clubName(career, x.awayId)}${x.result.shootout ? ' (pen.)' : ''}` : `${formatDate(x.date)}: ${clubName(career, x.homeId)} v ${clubName(career, x.awayId)}`)).join('\n')}>
      {row(s.homeId, 0)}
      {row(s.awayId, 1)}
      {!single && games.length > 0 && (
        <div className="tie-games muted small">
          {games.map((x) => {
            if (!x.result) return <span key={x.id}>next {formatDate(x.date)}</span>;
            // Scores from the better seed's side, whoever was at home.
            const [h, a] = x.result.score;
            const [mine, theirs] = x.homeId === s.homeId ? [h, a] : [a, h];
            return (
              <span key={x.id} className={gameWinner(x) === s.homeId ? '' : 'tie-lost'}>
                {mine}–{theirs}
                {x.result.shootout ? 'p' : ''}
              </span>
            );
          })}
        </div>
      )}
      {shootout && <div className="tie-games muted small">{shootout.slice(3)}</div>}
    </div>
  );
}

/** How many clubs make the playoffs (for the line in the table). */
export const playoffCutoff = (career: CareerState) => {
  const comp = career.competitions.find((c) => c.kind === 'playoff');
  return comp?.plan ? 2 ** comp.plan.length : leagueDef(career.leagueId).playoffs.teams;
};

/** Colour family of a competition: the league, its playoffs, a national championship, or a cup. */
export function competitionKind(career: CareerState, id: string): 'league' | 'playoff' | 'national' | 'cup' | 'cl' | 'ec' | 'cc' | 'ch' {
  if (isEuropean(id)) return id as 'cl' | 'ec' | 'cc' | 'ch';
  if (id.startsWith('playoffs-')) return 'national';
  const kind = career.competitions.find((c) => c.id === id)?.kind;
  return kind === 'cup' ? 'cup' : kind === 'playoff' ? 'playoff' : 'league';
}

/** A coloured label with the competition's name. */
export function CompTag({ career, id }: { career: CareerState; id: string }) {
  const name = career.competitions.find((c) => c.id === id)?.name ?? id;
  return <span className={`comp-tag comp-${competitionKind(career, id)}`}>{name}</span>;
}
