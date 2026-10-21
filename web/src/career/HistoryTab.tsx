import { Fragment, useState } from 'react';
import { overall, type Player } from '../../../engine';
import { ATTRIBUTE_LABELS, PERSONALITY_HELP, PERSONALITY_LABELS, personalityOf, potentialStars, type CareerState } from '../../../game';
import { Crest } from '../Crest';
import { Stars } from './SeasonReview';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function HistoryTab({ career }: { career: CareerState }) {
  const titles = career.history.filter((h) => h.position === 1).length;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card">
      <h3>Club history</h3>
      <p className="muted">
        {career.history.length === 0
          ? 'Your first season with the club. Results will be kept here, season by season.'
          : `${career.history.length} season${career.history.length > 1 ? 's' : ''} in charge · ${titles} title${titles === 1 ? '' : 's'}`}
      </p>
      {career.history.length > 0 && (
        <table className="league-table history-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Finished</th>
              <th>Pts</th>
              <th>W-D-L</th>
              <th>Goals</th>
              <th>Champion</th>
              <th>Board</th>
            </tr>
          </thead>
          <tbody>
            {[...career.history].reverse().map((h) => (
              <Fragment key={h.season}>
                <tr className={h.position === 1 ? 'mine' : ''} onClick={() => setOpen(open === h.season ? null : h.season)} style={{ cursor: 'pointer' }}>
                  <td>{h.season}</td>
                  <td>
                    <b>{h.position === 1 ? '🏆 1st' : ordinal(h.position)}</b> <span className="muted small">(exp. {ordinal(h.expectation)})</span>
                  </td>
                  <td>{h.points}</td>
                  <td>
                    {h.won}-{h.drawn}-{h.lost}
                  </td>
                  <td>
                    {h.goalsFor}:{h.goalsAgainst}
                  </td>
                  <td>{h.championName}</td>
                  <td className="muted small">{h.verdict}</td>
                </tr>
                {open === h.season && (
                  <tr>
                    <td colSpan={7} className="history-awards">
                      {h.awards.map((a) => `${a.title}: ${a.name} (${a.clubName}, ${a.detail})`).join(' · ')}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A player's profile: attributes, potential and career history. */
export function PlayerProfile({ career, player, onClose }: { career: CareerState; player: Player; onClose: () => void }) {
  const team = career.teams.find((t) => t.players.some((p) => p.id === player.id))!;
  const history = career.playerHistory[player.id] ?? [];
  const now = career.playerStats[player.id];
  const cond = career.squad[player.id];
  const keys = (player.position === 'GK'
    ? ['reflexes', 'gkPositioning', 'legStrength', 'gameIQ', 'passing', 'stamina']
    : ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ']) as (keyof Player['attrs'])[];
  const progress = career.progress[player.id] ?? {};
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-label={player.name} onClick={(e) => e.stopPropagation()}>
        <button className="player-card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="player-card-head">
          <Crest team={team} size={36} />
          <div>
            <div className="player-card-name">
              #{player.cap} {player.name}
            </div>
            <div className="muted small">
              {player.position} · {player.hand === 'L' ? 'left' : 'right'}-handed · age {player.age} · overall {overall(player).toFixed(1)}
            </div>
            <div className="small">
              Potential <Stars value={potentialStars(career.potential[player.id] ?? overall(player))} /> ·{' '}
              <span className={`personality personality-${personalityOf(career.seed, player.id)}`} title={PERSONALITY_HELP[personalityOf(career.seed, player.id)]}>
                {PERSONALITY_LABELS[personalityOf(career.seed, player.id)]}
              </span>
              {cond?.injury && <span className="injury-tag"> · {cond.injury.name}, {cond.injury.weeksLeft}w</span>}
            </div>
          </div>
        </div>
        <div className="player-card-attrs">
          {keys.map((k) => (
            <div key={k} className="attr-row">
              <span>{ATTRIBUTE_LABELS[k]}</span>
              <span className="attr-bar">
                <span style={{ width: `${(player.attrs[k] / 20) * 100}%` }} />
                {team.id === career.managedClubId && (progress[k] ?? 0) > 0 && <span className="attr-progress" style={{ left: `${(player.attrs[k] / 20) * 100}%`, width: `${((progress[k] ?? 0) / 20) * 100}%` }} title="Training progress toward the next point" />}
              </span>
              <b>{player.attrs[k]}</b>
            </div>
          ))}
        </div>
        <h4>Career</h4>
        <table className="league-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Club</th>
              <th>Apps</th>
              <th>Goals</th>
              <th>Assists</th>
              {player.position === 'GK' && <th>Saves</th>}
            </tr>
          </thead>
          <tbody>
            {now && (
              <tr className="mine">
                <td>{career.season}</td>
                <td>{team.name}</td>
                <td>{now.apps}</td>
                <td>{now.goals}</td>
                <td>{now.assists}</td>
                {player.position === 'GK' && <td>{now.saves}</td>}
              </tr>
            )}
            {[...history].reverse().map((h) => (
              <tr key={h.season}>
                <td>{h.season}</td>
                <td>{h.clubName}</td>
                <td>{h.apps}</td>
                <td>{h.goals}</td>
                <td>{h.assists}</td>
                {player.position === 'GK' && <td>{h.saves}</td>}
              </tr>
            ))}
            {!now && history.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No matches yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
