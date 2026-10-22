import { Fragment, useState } from 'react';
import { boardVerdict, type CareerState, type SeasonRecord } from '../../../game';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

const SHORT_VERDICT = { great: 'Delighted', good: 'Satisfied', meh: 'Below target', bad: 'Disappointed' } as const;

/** "Out in the semi-final" → "Semi-final"; keeps "Winners", "Runners-up", "Did not qualify". */
const shortResult = (r: string | undefined) => (r ? r.replace(/^Out in the /, '').replace(/^./, (c) => c.toUpperCase()) : undefined);

function Result({ value, note }: { value?: string; note?: string }) {
  const r = shortResult(value);
  if (!r) return <span className="muted">–</span>;
  const tone = r === 'Winners' ? 'win' : r === 'Runners-up' || r === 'Final' ? 'final' : r === 'Did not qualify' || r === 'Did not enter' ? 'none' : '';
  return (
    <span className={`history-result ${tone}`} title={note ? `${note}: ${value}` : value}>
      {r === 'Winners' && '🏆 '}
      {r}
    </span>
  );
}

export function HistoryTab({ career }: { career: CareerState }) {
  const trophies = career.history.flatMap((h) => h.trophies ?? (h.position === 1 ? [h.leagueName] : []));
  const [open, setOpen] = useState<string | null>(null);
  const hasNational = career.history.some((h) => h.national);
  const hasEurope = career.history.some((h) => h.europe);
  const columns = 9 + (hasNational ? 1 : 0) + (hasEurope ? 1 : 0);
  return (
    <div className="card">
      <h3>Club history</h3>
      <p className="muted">
        {career.history.length === 0
          ? 'Your first season with the club. Results will be kept here, season by season.'
          : `${career.history.length} season${career.history.length > 1 ? 's' : ''} in charge · ${trophies.length} troph${trophies.length === 1 ? 'y' : 'ies'}${trophies.length ? `: ${trophies.join(', ')}` : ''}`}
      </p>
      {career.history.length > 0 && (
        <div className="table-scroll">
          <table className="league-table history-table">
            <thead>
              <tr>
                <th>Season</th>
                <th title="Final position (after the playoffs)">Final</th>
                <th title="Regular season">League</th>
                <th>Playoffs</th>
                {hasNational && <th>National title</th>}
                <th>Cup</th>
                {hasEurope && <th>Europe</th>}
                <th title="Wins and losses in the regular season">W–L</th>
                <th>Goals</th>
                <th>Champion</th>
                <th>Board</th>
              </tr>
            </thead>
            <tbody>
              {[...career.history].reverse().map((h: SeasonRecord) => {
                const verdict = boardVerdict(h.position, h.expectation);
                return (
                  <Fragment key={h.season}>
                    <tr className={h.position === 1 ? 'mine' : ''} onClick={() => setOpen(open === h.season ? null : h.season)} style={{ cursor: 'pointer' }} title="Show the season's awards">
                      <td>{h.season}</td>
                      <td>
                        <b>{ordinal(h.position)}</b> <span className="muted history-note">exp. {ordinal(h.expectation)}</span>
                      </td>
                      <td>{ordinal(h.leaguePosition ?? h.position)}</td>
                      <td>
                        <Result value={h.playoffs} note="Playoffs" />
                      </td>
                      {hasNational && (
                        <td>
                          <Result value={h.national} note={h.nationalName} />
                        </td>
                      )}
                      <td>
                        <Result value={h.cup} note={h.cupName} />
                      </td>
                      {hasEurope && (
                        <td>
                          {h.europe ? (
                            <>
                              <span className="muted history-note">{h.europe.split(': ')[0].replace('Champions League', 'CL').replace('Euro Cup', 'EC').replace('Conference Cup', 'Conf.').replace('Challenger Cup', 'Chall.')}</span>{' '}
                              <Result value={h.europe.split(': ')[1]} note={h.europe.split(': ')[0]} />
                            </>
                          ) : (
                            <span className="muted">–</span>
                          )}
                        </td>
                      )}
                      <td>
                        {h.won}–{h.drawn ? `${h.drawn}–` : ''}
                        {h.lost}
                      </td>
                      <td>
                        {h.goalsFor}:{h.goalsAgainst}
                      </td>
                      <td className="history-champion">{h.championName}</td>
                      <td>
                        <span className={`verdict-tag verdict-${verdict.tone}`} title={h.verdict}>
                          {SHORT_VERDICT[verdict.tone]}
                        </span>
                      </td>
                    </tr>
                    {open === h.season && (
                      <tr>
                        <td colSpan={columns} className="history-awards">
                          {h.trophies?.length ? <div>🏆 {h.trophies.join(' · ')}</div> : null}
                          {h.awards.map((a) => `${a.title}: ${a.name} (${a.clubName}, ${a.detail})`).join(' · ')}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
