import { boardVerdict, expiringContracts, formatMoney, potentialStars, seasonAwards, seasonRecord, startNextSeason, seasonYear, seasonLabel, type CareerState } from '../../../game';
import { Crest } from '../Crest';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export const Stars = ({ value }: { value: number }) => (
  <span className="stars" title={`Potential ${value}/5`} aria-label={`Potential ${value} of 5`}>
    {'★'.repeat(value)}
    <span className="stars-off">{'★'.repeat(5 - value)}</span>
  </span>
);

/** End of season: champion, board verdict, awards, and the way into next season. */
export function SeasonReview({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const record = seasonRecord(career);
  const verdict = boardVerdict(record.position, record.expectation);
  const champion = career.teams.find((t) => t.id === record.championId)!;
  const awards = seasonAwards(career);
  const next = seasonLabel(seasonYear(career.season) + 1);
  return (
    <div className="season-review">
      <h3>Season {career.season} is over</h3>
      <div className="review-champion">
        <Crest team={champion} size={56} />
        <div>
          <div className="muted small">{career.leagueName} champions</div>
          <b className="review-big">{champion.name}</b>
          <div className="muted small">{record.table[0].points} points</div>
        </div>
      </div>
      <div className={`verdict verdict-${verdict.tone}`}>
        <b>
          You finished {ordinal(record.position)} with {record.points} points
        </b>{' '}
        ({record.won}W {record.drawn}D {record.lost}L, {record.goalsFor}:{record.goalsAgainst}). The board expected {ordinal(record.expectation)}: <b>{verdict.label}</b>.
      </div>
      <h4>Awards</h4>
      <div className="awards">
        {awards.map((a) => (
          <div key={a.kind} className={`award${a.clubId === career.managedClubId ? ' mine' : ''}`}>
            <span className="muted small">{a.title}</span>
            <b>{a.name}</b>
            <span className="small">
              {a.clubName} · {a.detail}
            </span>
          </div>
        ))}
      </div>
      {expiringContracts(career).length > 0 && (
        <p className="warn-text small">
          {expiringContracts(career).length} of your players' contracts end now: {expiringContracts(career).map((p) => p.name).join(', ')}. Renew them in the Club tab before starting the new season, or they leave.
        </p>
      )}
      <p className="muted small">
        Over the summer players get a year older: youngsters develop, veterans decline and some retire, and academy players join every club. Prize money is paid and the board sets next season's budget.
      </p>
      <button className="primary big" onClick={() => onChange(startNextSeason(career))}>
        Start the {next} season →
      </button>
    </div>
  );
}

/** What happened over the summer, shown until the first round of the new season is played. */
export function SummerReport({ career, onDismiss }: { career: CareerState; onDismiss: () => void }) {
  const r = career.summer;
  if (!r) return null;
  const sign = (x: number) => (x > 0 ? `+${x.toFixed(1)}` : x.toFixed(1));
  return (
    <div className="card summer">
      <div className="summer-head">
        <h3>Summer report · welcome to {r.toSeason}</h3>
        <button onClick={onDismiss}>Hide</button>
      </div>
      <p className="muted small">Board expectation this season: finish {ordinal(career.expectation)}.</p>
      <div className="summer-grid">
        <div>
          <h4>From the academy</h4>
          {r.academy.length === 0 && <p className="muted small">No academy players this year.</p>}
          {r.academy.map((a) => (
            <div key={a.playerId} className="summer-row">
              <span>
                {a.name} <span className="muted small">{a.age} · {a.position}</span>
              </span>
              <Stars value={potentialStars(a.potential)} />
            </div>
          ))}
        </div>
        <div>
          <h4>Improved</h4>
          {r.improved.length === 0 && <p className="muted small">Nobody made a big step.</p>}
          {r.improved.map((c) => (
            <div key={c.playerId} className="summer-row">
              <span>
                {c.name} <span className="muted small">{c.age}</span>
              </span>
              <span className="up">
                {c.before.toFixed(1)} → {c.after.toFixed(1)} ({sign(c.after - c.before)})
              </span>
            </div>
          ))}
        </div>
        <div>
          <h4>Declined</h4>
          {r.declined.length === 0 && <p className="muted small">Nobody slowed down noticeably.</p>}
          {r.declined.map((c) => (
            <div key={c.playerId} className="summer-row">
              <span>
                {c.name} <span className="muted small">{c.age}</span>
              </span>
              <span className="down">
                {c.before.toFixed(1)} → {c.after.toFixed(1)} ({sign(c.after - c.before)})
              </span>
            </div>
          ))}
        </div>
        {r.finance && (
          <div>
            <h4>Money</h4>
            <div className="summer-row">
              <span>Income</span>
              <span>{formatMoney(r.finance.income)}</span>
            </div>
            <div className="summer-row">
              <span>Prize money</span>
              <span>{formatMoney(r.finance.prizeMoney)}</span>
            </div>
            <div className="summer-row">
              <span>Wages</span>
              <span>{formatMoney(-r.finance.wages)}</span>
            </div>
            <div className="summer-row">
              <b>Season result</b>
              <b className={r.finance.balanceChange < 0 ? 'down' : 'up'}>{formatMoney(r.finance.balanceChange)}</b>
            </div>
            <p className="muted small">New wage budget: {formatMoney(career.finances[career.managedClubId]?.wageBudget ?? 0)}.</p>
          </div>
        )}
        <div>
          <h4>Left the club</h4>
          {r.retired.filter((x) => x.clubId === career.managedClubId).map((x) => (
            <div key={x.name} className="summer-row">
              <span>{x.name}</span>
              <span className="muted small">retired at {x.age}</span>
            </div>
          ))}
          {r.released.map((x) => (
            <div key={x.name} className="summer-row">
              <span>{x.name}</span>
              <span className="muted small">released ({x.age})</span>
            </div>
          ))}
          {(r.contractsEnded ?? []).map((x) => (
            <div key={`c-${x.name}`} className="summer-row">
              <span>{x.name}</span>
              <span className="muted small">contract ended ({x.age})</span>
            </div>
          ))}
          {!r.released.length && !(r.contractsEnded ?? []).length && !r.retired.some((x) => x.clubId === career.managedClubId) && <p className="muted small">Nobody left.</p>}
          {r.retired.some((x) => x.clubId !== career.managedClubId) && (
            <p className="muted small">
              Around the league, retired: {r.retired.filter((x) => x.clubId !== career.managedClubId).map((x) => `${x.name} (${x.age})`).join(', ')}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
