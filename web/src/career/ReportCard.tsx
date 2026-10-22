import { formatMoney, playerReport, seasonLabel, type CareerState, type PlayerReport } from '../../../game';
import { PlayerLink } from './PlayerProfile';

const CONFIDENCE = { full: '', good: 'Scouted: attributes within a point.', rough: 'Not scouted: rough estimates only.' };

export function RecommendationBadge({ report }: { report: PlayerReport }) {
  return (
    <span className={`rec rec-${report.recommendation.tone}`} title={report.recommendation.summary}>
      {report.recommendation.label}
    </span>
  );
}

/** The scout's (or, for your players, the assistant's) full report: a verdict and the reasons behind it. */
export function ReportCard({ career, playerId, compact = false }: { career: CareerState; playerId: string; compact?: boolean }) {
  const r = playerReport(career, playerId);
  if (!r) return null;
  const m = r.money;
  return (
    <div className={`report-card rec-border-${r.recommendation.tone}`}>
      <div className="report-card-head">
        <div>
          <span className="muted small">{r.own ? "Assistant's assessment" : 'Scouting report'}</span>
          <div className="report-card-verdict">
            <RecommendationBadge report={r} /> <span>{r.recommendation.summary}</span>
          </div>
          {CONFIDENCE[r.confidence] && <div className="muted small">{CONFIDENCE[r.confidence]}</div>}
        </div>
        <div className="report-score" title="How good a move this is for your club (0–100)">
          <b>{r.score}</b>
          <span className="report-score-bar">
            <span style={{ width: `${r.score}%` }} className={`rec-${r.recommendation.tone}`} />
          </span>
        </div>
      </div>

      <div className="report-card-lists">
        <ul className="report-pros">
          {r.pros.map((p) => (
            <li key={p.text}>{p.text}</li>
          ))}
          {r.pros.length === 0 && <li className="muted">Nothing that stands out.</li>}
        </ul>
        <ul className="report-cons">
          {r.cons.map((p) => (
            <li key={p.text} className={p.tone === 'ok' ? 'mild' : ''}>
              {p.text}
            </li>
          ))}
          {r.cons.length === 0 && <li className="muted">No real concerns.</li>}
        </ul>
      </div>

      {!compact && (
        <div className="report-facts">
          <div>
            <span className="muted small">Ability</span>
            <b>{r.confidence === 'full' ? r.ability.estimate.toFixed(1) : `${r.ability.low.toFixed(0)}–${r.ability.high.toFixed(0)}`}</b>
            <span className="small-note">
              {r.outlook.trend === 'rising' ? '↗' : r.outlook.trend === 'declining' ? '↘' : '→'} {r.outlook.nextSeason.toFixed(1)} next season, {r.outlook.inTwo.toFixed(1)} in two
            </span>
          </div>
          <div>
            <span className="muted small">In your squad</span>
            <b>
              {r.depth.rank === 1 ? 'Best' : `${r.depth.rank}${r.depth.rank === 2 ? 'nd' : r.depth.rank === 3 ? 'rd' : 'th'}`} of {r.depth.of}
            </b>
            <span className="small-note">{r.depth.position}</span>
          </div>
          {r.strengths.length > 0 && (
            <div>
              <span className="muted small">Strengths</span>
              <span className="chips">
                {r.strengths.map((s) => (
                  <span key={s.label} className="chip chip-good">
                    {s.label} {s.value}
                  </span>
                ))}
              </span>
            </div>
          )}
          {r.weaknesses.length > 0 && (
            <div>
              <span className="muted small">Weaknesses</span>
              <span className="chips">
                {r.weaknesses.map((s) => (
                  <span key={s.label} className="chip chip-bad">
                    {s.label} {s.value}
                  </span>
                ))}
              </span>
            </div>
          )}
          {r.form && (
            <div className="wide">
              <span className="muted small">This season</span>
              <span>
                {r.form.line} · <b>better than {r.form.percentile}%</b> of {r.depth.position === 'GK' ? 'goalkeepers' : 'players in his position'}
              </span>
            </div>
          )}
          <div className="wide">
            <span className="muted small">Money</span>
            <span>
              {r.own ? (
                <>
                  Earns <b>{m.wage ? formatMoney(m.wage) : '–'}</b>
                  {m.contractUntil !== undefined && <> until {seasonLabel(m.contractUntil)}</>}
                  {m.yearsLeft !== undefined && m.yearsLeft <= 1 && (
                    <>
                      {' '}
                      · wants <b>{formatMoney(m.wantedWage)}</b> to renew
                    </>
                  )}{' '}
                  · worth paying up to <b>{formatMoney(m.maxWorthWage)}</b> · market value {formatMoney(m.value ?? 0)}
                </>
              ) : (
                <>
                  {m.fee ? (
                    <>
                      Fee <b>{formatMoney(m.fee)}</b>
                      {m.value !== undefined && <> (value {formatMoney(m.value)})</>}
                    </>
                  ) : (
                    <b className="up">Free</b>
                  )}{' '}
                  · wants <b>{formatMoney(m.wantedWage)}</b> a season · worth paying up to <b>{formatMoney(m.maxWorthWage)}</b> · your wage room {formatMoney(m.wageRoom)}
                </>
              )}
            </span>
          </div>
          {r.alternative && (
            <div className="wide">
              <span className="muted small">On the market</span>
              <span>
                <PlayerLink id={r.alternative.playerId}>{r.alternative.name}</PlayerLink> ({r.alternative.clubName}) is about as good (~{r.alternative.estimate.toFixed(1)}{r.alternative.scouted ? '' : ', not scouted'}) for{' '}
                {r.alternative.price ? formatMoney(r.alternative.price) : 'free'} and {formatMoney(r.alternative.wage)} a season.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
