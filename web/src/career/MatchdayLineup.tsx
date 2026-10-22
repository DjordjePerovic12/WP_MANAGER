import { useState } from 'react';
import { overall } from '../../../engine';
import { matchdaySquad, setSelection, startingSeven, STATUS_LABELS, statusOf, type CareerState } from '../../../game';
import { PlayerLink } from './PlayerProfile';

const SHORT_ROLE = { key: 'Key', regular: 'Reg', rotation: 'Rot', backup: 'Bkp', youth: 'Yth' } as const;

/**
 * Before the match: the starting seven (yours, or the assistant's, which respects squad roles) and
 * the bench. Click a starter, then a substitute, to swap them.
 */
export function MatchdayLineup({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const squad = matchdaySquad(career, club.id);
  const starters = startingSeven(career) ?? [];
  const mine = !!career.selection?.starters?.length && career.selection.starters.length === 7;
  const [picked, setPicked] = useState<string | null>(null);
  const player = (id: string) => club.players.find((p) => p.id === id)!;
  const bench = squad.filter((id) => !starters.includes(id));

  const click = (id: string) => {
    if (starters.includes(id)) return setPicked(picked === id ? null : id);
    if (!picked) return;
    // A goalkeeper only swaps with a goalkeeper, a field player with a field player.
    if ((player(picked).position === 'GK') !== (player(id).position === 'GK')) return;
    const next = starters.map((s) => (s === picked ? id : s));
    setPicked(null);
    // Only the starters become yours; the 13 stays the assistant's unless you picked it in the Squad tab.
    onChange(setSelection(career, { matchday: career.selection?.matchday ?? [], starters: next }));
  };

  const chip = (id: string, starting: boolean) => {
    const p = player(id);
    const role = statusOf(career, id);
    const swappable = !starting && picked && (player(picked).position === 'GK') === (p.position === 'GK');
    return (
      <div key={id} className={`lineup-chip${starting ? ' starting' : ''}${picked === id ? ' picked' : ''}${swappable ? ' swappable' : ''}`} onClick={() => click(id)} role="button">
        <span className="lineup-cap">{p.cap}</span>
        <span className="lineup-name">
          <PlayerLink id={id}>{p.name.split(' ').slice(-1)[0]}</PlayerLink>
          <span className="muted small">
            {' '}
            {p.position} · {overall(p).toFixed(1)}
          </span>
        </span>
        <span className={`lineup-role role-${role}`} title={STATUS_LABELS[role]}>
          {SHORT_ROLE[role]}
        </span>
      </div>
    );
  };

  return (
    <div className="matchday-lineup">
      <div className="lineup-head">
        <b>Starting seven</b> <span className="muted small">{mine ? 'your pick' : "the assistant's pick (respects squad roles)"}</span>
        {mine && (
          <button className="link" onClick={() => onChange(setSelection(career, { matchday: career.selection!.matchday, starters: [] }))}>
            Let the assistant pick
          </button>
        )}
      </div>
      <div className="lineup-grid">{starters.map((id) => chip(id, true))}</div>
      <div className="lineup-head">
        <span className="muted small">{picked ? `Now click a substitute to bring on for ${player(picked).name}` : 'Bench · click a starter, then a substitute, to swap'}</span>
      </div>
      <div className="lineup-grid bench">{bench.map((id) => chip(id, false))}</div>
    </div>
  );
}
