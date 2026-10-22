import type { Player } from '../../../engine';
import { happinessOf, MOOD_LABELS, moodFactors, moodOf, setSquadStatus, STATUS_LABELS, STATUSES, statusOf, type CareerState, type SquadStatus } from '../../../game';

/** A player's mood as a coloured label; hover for the reasons. */
export function MoodBadge({ career, player }: { career: CareerState; player: Player }) {
  const h = happinessOf(career, player.id);
  const mood = moodOf(h);
  const reasons = moodFactors(career, player)
    .filter((f) => f.points !== 0)
    .map((f) => `${f.points > 0 ? '+' : '−'} ${f.text}`)
    .join('\n');
  const request = career.transferRequests?.includes(player.id);
  return (
    <span className={`mood mood-${mood}`} title={`${MOOD_LABELS[mood]} (${h}/100)${reasons ? `\n${reasons}` : ''}`}>
      {request ? 'Transfer request' : MOOD_LABELS[mood]}
    </span>
  );
}

/** The squad status dropdown (key player … youth). */
export function StatusSelect({ career, player, onChange, onMessage }: { career: CareerState; player: Player; onChange: (c: CareerState) => void; onMessage?: (m: string) => void }) {
  return (
    <select
      className="status-select"
      value={statusOf(career, player.id)}
      onChange={(e) => {
        const out = setSquadStatus(career, player.id, e.target.value as SquadStatus);
        onMessage?.(out.message);
        onChange(out.state);
      }}
      title="His role in the squad: it sets how many minutes he expects"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

/** Mood details for the profile: the reasons, worst first. */
export function MoodDetails({ career, player }: { career: CareerState; player: Player }) {
  const h = happinessOf(career, player.id);
  const factors = moodFactors(career, player).sort((a, b) => a.points - b.points);
  return (
    <div className="mood-details">
      <div>
        <MoodBadge career={career} player={player} /> <span className="muted small">{h}/100</span>
      </div>
      <div className="mood-bar">
        <span style={{ width: `${h}%` }} className={`mood-${moodOf(h)}`} />
      </div>
      <ul>
        {factors.map((f) => (
          <li key={f.text} className={f.points < 0 ? 'down' : 'up'}>
            {f.points > 0 ? '+' : '−'} {f.text}
          </li>
        ))}
        {factors.length === 0 && <li className="muted">Nothing on his mind.</li>}
      </ul>
    </div>
  );
}
