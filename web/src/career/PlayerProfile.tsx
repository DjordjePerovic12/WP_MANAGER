import { createContext, useContext, useState, type ReactNode } from 'react';
import { overall, type Player } from '../../../engine';
import {
  askingPrice,
  captainOf,
  leadersOf,
  promisesFor,
  setCaptain,
  trustOf,
  rejectTransferRequest,
  allClubs,
  clubById,
  promoteYouth,
  releaseYouth,
  averageRating,
  ATTRIBUTE_LABELS,
  expectedWage,
  formatMoney,
  PERSONALITY_HELP,
  PERSONALITY_LABELS,
  playerValue,
  playerView,
  releaseCost,
  releasePlayer,
  scoutingLeft,
  scoutPlayer,
  seasonLabel,
  setTransferListed,
  transferWindow,
  type CareerState,
  type PlayerSeasonEntry,
  type PlayerSeason,
} from '../../../game';
import { Crest } from '../Crest';
import { Stars } from './SeasonReview';
import { ReportCard } from './ReportCard';
import { MoodDetails, StatusSelect } from './Mood';

/** Opens the profile of any player (yours, another club's, or a free agent) from anywhere in the career screens. */
const ProfileContext = createContext<(playerId: string) => void>(() => {});

export function ProfileProvider({ career, onChange, children }: { career: CareerState; onChange: (c: CareerState) => void; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ProfileContext.Provider value={setOpen}>
      {children}
      {open && <PlayerProfile career={career} playerId={open} onChange={onChange} onClose={() => setOpen(null)} />}
    </ProfileContext.Provider>
  );
}

/** A player's name that opens his profile. */
export function PlayerLink({ id, children }: { id: string; children: ReactNode }) {
  const open = useContext(ProfileContext);
  return (
    <button className="link player-link" onClick={(e) => (e.stopPropagation(), open(id))}>
      {children}
    </button>
  );
}

/** A match rating out of 10, coloured: green for a good game, red for a poor one. */
export function RatingBadge({ value }: { value?: number }) {
  if (value === undefined) return <span className="muted">–</span>;
  return <span className={`rating-badge ${value >= 7.5 ? 'great' : value >= 6.8 ? 'good' : value >= 6 ? 'ok' : 'poor'}`}>{value.toFixed(1)}</span>;
}

const clubName = (career: CareerState, id: string) => clubById(career, id)?.name ?? id;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

type Line = PlayerSeasonEntry & { current?: boolean };

function locate(career: CareerState, playerId: string) {
  for (const team of allClubs(career)) {
    const player = team.players.find((p) => p.id === playerId);
    if (player) return { player, team, free: undefined };
  }
  const free = career.freeAgents.find((f) => f.player.id === playerId);
  if (free) return { player: free.player, team: undefined, free };
  const youth = career.academy?.find((p) => p.id === playerId);
  return youth ? { player: youth, team: career.teams.find((t) => t.id === career.managedClubId), free: undefined, academy: true } : undefined;
}

/** Everything about a player: what you know of his attributes, contract and money, fitness, and his stats season by season and match by match. */
export function PlayerProfile({ career, playerId, onChange, onClose }: { career: CareerState; playerId: string; onChange: (c: CareerState) => void; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const found = locate(career, playerId);
  if (!found) return null;
  const { player, team, free } = found;
  const academy = 'academy' in found && found.academy;
  const own = team?.id === career.managedClubId && !academy;
  const view = playerView(career, player);
  const known = view.knowledge === 'own' || view.knowledge === 'exact';
  const gk = player.position === 'GK';
  const potential = career.potential[player.id] ?? free?.potential ?? overall(player);
  const contract = career.contracts[player.id];
  const cond = career.squad[player.id];
  const window = transferWindow(career);
  const listed = career.transferList.includes(player.id);
  const progress = own ? (career.progress[player.id] ?? {}) : {};

  const now = career.playerStats[player.id];
  const lines: Line[] = [
    ...(career.playerHistory[player.id] ?? []),
    ...(now && team
      ? [
          {
            season: career.season,
            clubId: team.id,
            clubName: team.name,
            ...now,
            current: true,
          },
        ]
      : []),
  ];
  const log = career.matchLog?.[player.id] ?? [];
  const chartValue = (l: Line) => (gk ? l.saves : l.goals);
  const chartMax = Math.max(1, ...lines.map(chartValue));
  const total = lines.reduce(
    (s, l) => ({
      apps: s.apps + l.apps,
      goals: s.goals + l.goals,
      assists: s.assists + l.assists,
      saves: s.saves + l.saves,
    }),
    { apps: 0, goals: 0, assists: 0, saves: 0 },
  );

  const keys = (
    gk
      ? ['reflexes', 'gkPositioning', 'legStrength', 'positioning', 'gameIQ', 'passing', 'speed', 'stamina']
      : ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ']
  ) as (keyof Player['attrs'])[];

  const act = (out: { message: string; state: CareerState }) => {
    setMessage(out.message);
    onChange(out.state);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card profile" role="dialog" aria-label={player.name} onClick={(e) => e.stopPropagation()}>
        <button className="player-card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="player-card-head">
          {team ? <Crest team={team} size={40} /> : <span className="free-badge">FA</span>}
          <div>
            <div className="player-card-name">
              {player.cap ? `#${player.cap} ` : ''}
              {player.name}
            </div>
            <div className="muted small">
              {team ? `${clubName(career, team.id)}${academy ? ' academy' : ''}` : 'Free agent'} · {player.position} · {player.hand === 'L' ? 'left' : 'right'}
              -handed · age {player.age}
            </div>
            <div className="small">
              Overall <b>{known ? view.overall.estimate.toFixed(1) : <span className="range">{`${view.overall.low.toFixed(0)}–${view.overall.high.toFixed(0)}`}</span>}</b> · Potential{' '}
              {view.potentialStars.low === view.potentialStars.high ? (
                <Stars value={view.potentialStars.low} />
              ) : (
                <span className="stars" title="Estimate: scout him to know">
                  {'★'.repeat(view.potentialStars.low)}
                  <span className="stars-range">{'★'.repeat(view.potentialStars.high - view.potentialStars.low)}</span>
                </span>
              )}
              {view.personality && (
                <>
                  {' · '}
                  <span className={`personality personality-${view.personality}`} title={PERSONALITY_HELP[view.personality]}>
                    {PERSONALITY_LABELS[view.personality]}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <ReportCard career={career} playerId={player.id} />

        <div className="profile-grid">
          <div>
            <h4>
              Attributes{' '}
              <span className="muted small">
                {view.knowledge === 'own' ? '' : view.knowledge === 'exact' ? '· full scouting report' : view.knowledge === 'close' ? '· scouted, within a point' : '· estimates, not scouted'}
              </span>
            </h4>
            <div className="player-card-attrs">
              {keys.map((k) => {
                const a = view.attrs[k];
                return (
                  <div key={k} className="attr-row">
                    <span>{ATTRIBUTE_LABELS[k]}</span>
                    <span className="attr-bar">
                      {a.exact ? (
                        <span style={{ width: `${(a.low / 20) * 100}%` }} />
                      ) : (
                        <span
                          className="attr-range"
                          style={{
                            left: `${(a.low / 20) * 100}%`,
                            width: `${((a.high - a.low) / 20) * 100}%`,
                          }}
                        />
                      )}
                      {(progress[k] ?? 0) > 0 && (
                        <span
                          className="attr-progress"
                          style={{
                            left: `${(a.low / 20) * 100}%`,
                            width: `${((progress[k] ?? 0) / 20) * 100}%`,
                          }}
                          title="Training progress toward the next point"
                        />
                      )}
                    </span>
                    <b>{a.exact ? a.low : `${a.low}–${a.high}`}</b>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4>Contract & value</h4>
            <dl className="profile-facts">
              <dt>Value</dt>
              <dd>{view.knowledge === 'unknown' ? <span className="muted">scout him to know</span> : formatMoney(playerValue(player, potential))}</dd>
              {contract && team && (
                <>
                  <dt>Wage</dt>
                  <dd>{formatMoney(contract.wage)} / season</dd>
                  <dt>Contract</dt>
                  <dd>until {seasonLabel(contract.until)}</dd>
                </>
              )}
              {team && !own && (
                <>
                  <dt>Asking price</dt>
                  <dd>{formatMoney(askingPrice(career, player.id))}</dd>
                  <dt>Would want</dt>
                  <dd>{formatMoney(expectedWage(player, potential))} / season</dd>
                </>
              )}
              {free && (
                <>
                  <dt>Fee</dt>
                  <dd className="up">Free</dd>
                  <dt>Wants</dt>
                  <dd>{formatMoney(free.askingWage)} / season</dd>
                </>
              )}
              {own && (
                <>
                  <dt>Transfer list</dt>
                  <dd>{listed ? <b>Listed</b> : 'Not listed'}</dd>
                </>
              )}
              {cond && (
                <>
                  <dt>Fitness</dt>
                  <dd>{cond.condition}%</dd>
                </>
              )}
              {cond?.injury && (
                <>
                  <dt>Injury</dt>
                  <dd className="down">
                    {cond.injury.name}, {cond.injury.weeksLeft} week
                    {cond.injury.weeksLeft === 1 ? '' : 's'}
                  </dd>
                </>
              )}
            </dl>
            {own && (
              <>
                <h4>Mood and role</h4>
                <MoodDetails career={career} player={player} />
                <label className="small">
                  Role <StatusSelect career={career} player={player} onChange={onChange} onMessage={setMessage} />
                </label>{' '}
                {captainOf(career) === player.id ? (
                  <span className="captain-tag">Captain</span>
                ) : (
                  <button onClick={() => act(setCaptain(career, player.id))}>Make captain</button>
                )}
                {leadersOf(career).includes(player.id) && captainOf(career) !== player.id && <span className="muted small"> · a dressing-room leader</span>}
                <p className="muted small">
                  Trust in you: <b>{trustOf(career, player.id)}</b>/100
                </p>
                {promisesFor(career, player.id).length > 0 && (
                  <ul className="promise-list">
                    {promisesFor(career, player.id).map((pr) => (
                      <li key={pr.id} className={`promise-${pr.status}`}>
                        🤝 {pr.text} <span className="muted small">({pr.status === 'open' ? `by ${pr.deadline}` : pr.status})</span>
                      </li>
                    ))}
                  </ul>
                )}
                {career.transferRequests?.includes(player.id) && (
                  <p className="warn-text small">
                    He has asked to leave and is on the transfer list.{' '}
                    <button onClick={() => act(rejectTransferRequest(career, player.id))}>Refuse the request</button>
                  </p>
                )}
              </>
            )}
            <div className="profile-actions">
              {academy && (
                <>
                  <button
                    className="primary"
                    onClick={() => {
                      act(promoteYouth(career, player.id));
                    }}
                  >
                    Promote to the first team
                  </button>
                  <button className="link-danger" onClick={() => confirm(`Let ${player.name} go?`) && (act(releaseYouth(career, player.id)), onClose())}>
                    Release
                  </button>
                </>
              )}
              {!own && !academy && view.knowledge !== 'exact' && (
                <button
                  disabled={scoutingLeft(career) <= 0}
                  title={scoutingLeft(career) > 0 ? `${scoutingLeft(career)} report(s) left this week` : 'No reports left this week'}
                  onClick={() => act(scoutPlayer(career, player.id))}
                >
                  Scout ({scoutingLeft(career)} left)
                </button>
              )}
              {!own && !academy && <span className="muted small">{window ? 'Bid or offer terms from the Transfers tab.' : 'The transfer window is closed.'}</span>}
              {own && (
                <>
                  <button disabled={!window && !listed} onClick={() => onChange(setTransferListed(career, player.id, !listed))}>
                    {listed ? 'Take off the list' : 'Transfer list'}
                  </button>
                  <button
                    className="link-danger"
                    onClick={() => {
                      if (!confirm(`Release ${player.name}? It costs ${formatMoney(releaseCost(career, player.id))}.`)) return;
                      act(releasePlayer(career, player.id));
                      onClose();
                    }}
                  >
                    Release ({formatMoney(releaseCost(career, player.id))})
                  </button>
                </>
              )}
            </div>
            {message && <p className="manager-message">{message}</p>}
          </div>
        </div>

        <h4>
          Season by season{' '}
          {lines.length > 0 && (
            <span className="muted small">
              · career: {total.apps} apps, {gk ? `${total.saves} saves` : `${total.goals} goals, ${total.assists} assists`}
            </span>
          )}
        </h4>
        {lines.length === 0 ? (
          <p className="muted small">No matches yet.</p>
        ) : (
          <>
            <div className="season-chart" aria-label={gk ? 'Saves per season' : 'Goals per season'}>
              {lines.map((l) => (
                <div key={l.season + l.clubId} className={`season-bar${l.current ? ' current' : ''}`} title={`${l.season}: ${chartValue(l)} ${gk ? 'saves' : 'goals'}`}>
                  <b>{chartValue(l)}</b>
                  <span style={{ height: `${(chartValue(l) / chartMax) * 100}%` }} />
                  <small>{l.season.slice(2, 4) + '/' + l.season.slice(-2)}</small>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table className="league-table profile-table">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Club</th>
                    <th>Apps</th>
                    <th>Min</th>
                    {gk ? (
                      <>
                        <th>Saves</th>
                        <th>Conceded</th>
                        <th>Save %</th>
                      </>
                    ) : (
                      <>
                        <th>Goals</th>
                        <th>Shots</th>
                        <th>Shot %</th>
                        <th>Assists</th>
                        <th title="Exclusions drawn">Excl. won</th>
                        <th>Fouls</th>
                      </>
                    )}
                    <th title="Average match rating (man of the match awards)">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lines].reverse().map((l) => {
                    const has = l.shots !== undefined;
                    return (
                      <tr key={l.season + l.clubId} className={l.current ? 'mine' : ''}>
                        <td>{l.season}</td>
                        <td>{l.clubName}</td>
                        <td>{l.apps}</td>
                        <td>{l.minutes}</td>
                        {gk ? (
                          <>
                            <td>{l.saves}</td>
                            <td>{l.conceded ?? '–'}</td>
                            <td>{l.conceded !== undefined ? pct(l.saves, l.saves + l.conceded) : '–'}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <b>{l.goals}</b>
                            </td>
                            <td>{has ? l.shots : '–'}</td>
                            <td>{has ? pct(l.goals, l.shots!) : '–'}</td>
                            <td>{l.assists}</td>
                            <td>{l.exclusionsDrawn ?? '–'}</td>
                            <td>{l.fouls ?? '–'}</td>
                          </>
                        )}
                        <td>
                          <RatingBadge value={l.rating ?? averageRating(l as PlayerSeason)} />
                          {l.mom ? <span className="muted small"> ⭐{l.mom}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {log.length > 0 && (
          <>
            <h4>This season, match by match</h4>
            <div className="table-scroll">
              <table className="league-table profile-table">
                <thead>
                  <tr>
                    <th title="Matchday">MD</th>
                    <th>Opponent</th>
                    <th>Result</th>
                    <th>Min</th>
                    {gk ? (
                      <>
                        <th>Saves</th>
                        <th>Conceded</th>
                      </>
                    ) : (
                      <>
                        <th>Goals</th>
                        <th>Shots</th>
                        <th>Assists</th>
                        <th>Excl. won</th>
                        <th>Fouls</th>
                      </>
                    )}
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {[...log].reverse().map((m) => {
                    const [mine, theirs] = m.score[0] === m.score[1] && m.shootout ? m.shootout : m.score;
                    const result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
                    return (
                      <tr key={`${m.matchday ?? m.round}-${m.competition ?? ''}`}>
                        <td title={m.stage}>{m.matchday ?? m.round}</td>
                        <td>
                          {m.home ? 'vs' : '@'} {clubName(career, m.opponentId)}
                        </td>
                        <td>
                          <span className="form">
                            <span className={`form-${result}`}>{result}</span>
                          </span>{' '}
                          {m.score[0]}–{m.score[1]}
                          {m.shootout && <span className="muted small"> ({m.shootout[0]}–{m.shootout[1]} pen.)</span>}
                        </td>
                        <td>{m.minutes}</td>
                        {gk ? (
                          <>
                            <td>{m.saves}</td>
                            <td>{m.conceded}</td>
                          </>
                        ) : (
                          <>
                            <td>{m.goals ? <b>{m.goals}</b> : 0}</td>
                            <td>{m.shots}</td>
                            <td>{m.assists}</td>
                            <td>{m.exclusionsDrawn}</td>
                            <td>{m.fouls}</td>
                          </>
                        )}
                        <td>
                          <RatingBadge value={m.rating} />
                          {m.mom && <span title="Man of the match"> ⭐</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
