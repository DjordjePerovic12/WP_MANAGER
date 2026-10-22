import { useState } from 'react';
import { clubById, EURO_IDS, gameWinner, groupTable, type CareerState, type EuroGroup, type EuroId, type EuroPhase, type Fixture } from '../../../game';
import { Crest } from '../Crest';
import { PlayerLink } from './PlayerProfile';

const formatDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const name = (career: CareerState, id: string) => clubById(career, id)?.name ?? id;

/** A group's table, with the places that go through highlighted. */
function GroupTable({ career, phase, group, through }: { career: CareerState; phase: EuroPhase; group: EuroGroup; through: number }) {
  const rating = (id: string) => clubById(career, id)?.players.length ?? 0;
  const rows = groupTable(career.fixtures, group, `${phase.id}-${group.id}`, rating);
  const next = career.fixtures.filter((f) => f.groupId === `${phase.id}-${group.id}` && !f.result).sort((a, b) => a.date.localeCompare(b.date))[0];
  return (
    <div className="euro-group">
      <div className="euro-group-head">
        <b>{group.name}</b>
        {group.host && <span className="muted small"> · at {name(career, group.host)}</span>}
        {next && <span className="muted small"> · next {formatDate(next.date)}</span>}
      </div>
      <table className="league-table compact-table">
        <thead>
          <tr>
            <th>#</th>
            <th style={{ textAlign: 'left' }}>Club</th>
            <th>P</th>
            <th title="Won (regular time)">W</th>
            <th title="Won on penalties">WP</th>
            <th title="Lost on penalties">LP</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={`${r.clubId === career.managedClubId ? 'mine' : ''}${i < through ? ' through' : ''}`}>
              <td>{i + 1}</td>
              <td className="club-cell" style={{ textAlign: 'left' }}>
                <Crest team={clubById(career, r.clubId) ?? { id: r.clubId, name: r.clubId }} size={16} /> {name(career, r.clubId)}
              </td>
              <td>{r.played}</td>
              <td>{r.won}</td>
              <td>{r.shootoutWon}</td>
              <td>{r.shootoutLost}</td>
              <td>{r.lost}</td>
              <td>{r.goalsFor - r.goalsAgainst > 0 ? `+${r.goalsFor - r.goalsAgainst}` : r.goalsFor - r.goalsAgainst}</td>
              <td>
                <b>{r.points}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One game's line: home – away and the score (with penalties). */
function GameLine({ career, f }: { career: CareerState; f: Fixture }) {
  const w = f.result ? gameWinner(f) : undefined;
  return (
    <div className={`euro-game${f.homeId === career.managedClubId || f.awayId === career.managedClubId ? ' mine' : ''}`}>
      <span className="muted small">{f.stage.split(' · ').pop()}</span>
      <span className={w === f.homeId ? 'winner' : ''}>{name(career, f.homeId)}</span>
      <b>{f.result ? `${f.result.score[0]}–${f.result.score[1]}${f.result.shootout ? ` (${f.result.shootout[0]}–${f.result.shootout[1]} pen.)` : ''}` : formatDate(f.date)}</b>
      <span className={w === f.awayId ? 'winner' : ''}>{name(career, f.awayId)}</span>
    </div>
  );
}

/** Two-legged ties with the aggregate score. */
function Ties({ career, phase }: { career: CareerState; phase: EuroPhase }) {
  const rounds = [...new Set((phase.ties ?? []).map((t) => t.round))];
  return (
    <div className="bracket">
      {rounds.map((r) => {
        const ties = (phase.ties ?? []).filter((t) => t.round === r);
        const legs = career.fixtures.filter((f) => f.phaseId === phase.id && f.round === r);
        return (
          <div key={r} className="bracket-round">
            <div className="bracket-round-head">
              <b>{legs[0]?.stage.replace(/, (1st|2nd) leg$/, '') ?? `Round ${r}`}</b>
              <span className="muted small">two legs{legs[0] ? ` · ${formatDate(legs[0].date)}` : ''}</span>
            </div>
            {ties.map((t) => {
              const tl = legs.filter((f) => f.seriesId === t.id);
              const agg = (id: string) => tl.reduce((s, f) => s + (f.result ? (f.homeId === id ? f.result.score[0] : f.result.score[1]) : 0), 0);
              const pens = tl.find((f) => f.leg === 2)?.result?.shootout;
              return (
                <div key={t.id} className={`tie${t.homeId === career.managedClubId || t.awayId === career.managedClubId ? ' mine' : ''}`}>
                  {[t.awayId, t.homeId].map((id) => (
                    <div key={id} className={`tie-row${t.winnerId === id ? ' winner' : t.winnerId ? ' loser' : ''}`}>
                      <Crest team={clubById(career, id) ?? { id, name: id }} size={16} /> <span className="tie-name">{name(career, id)}</span>
                      <b>{tl.some((f) => f.result) ? agg(id) : ''}</b>
                    </div>
                  ))}
                  {pens && t.winnerId && (
                    <div className="tie-games muted small">
                      {name(career, t.winnerId)} won {Math.max(...pens)}–{Math.min(...pens)} on penalties
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** One phase of a European competition: its draw, tables or ties. */
export function PhaseView({ career, phase }: { career: CareerState; phase: EuroPhase }) {
  const europe = career.europe!;
  if (phase.status === 'waiting') {
    const sources = phase.sources.map((s) => europe.phases.find((p) => p.id === s)!).filter((p) => p.status !== 'done');
    return (
      <p className="muted small">
        {phase.name}: draw {sources.length ? `after the ${sources.map((s) => `${europe.comps.find((c) => c.id === s.comp)!.name} ${s.name.toLowerCase()}`).join(' and ')}` : 'soon'} · from{' '}
        {formatDate(phase.dates[0])}
        {phase.entrants.length ? ` · ${phase.entrants.length} clubs in so far` : ''}
      </p>
    );
  }
  if (phase.status === 'done' && !phase.groups && !phase.ties?.length && !career.fixtures.some((f) => f.phaseId === phase.id)) {
    return <p className="muted small">{phase.name}: not played this season.</p>;
  }
  const through = phase.groups ? Math.ceil(phase.target / phase.groups.length) : 0;
  return (
    <div className="euro-phase">
      <h4>
        {phase.name} <span className="muted small">· {phase.kind === 'tournament' ? 'single-venue tournaments' : phase.kind === 'groups' ? 'home and away' : phase.kind === 'knockout' ? 'two legs, on aggregate' : 'one weekend'}</span>
      </h4>
      {phase.groups && (
        <div className="euro-groups">
          {phase.groups.map((g) => (
            <GroupTable key={g.id} career={career} phase={phase} group={g} through={through} />
          ))}
        </div>
      )}
      {phase.kind === 'knockout' && <Ties career={career} phase={phase} />}
      {phase.kind === 'finalFour' && (
        <div className="euro-games">
          {career.fixtures
            .filter((f) => f.phaseId === phase.id)
            .map((f) => (
              <GameLine key={f.id} career={career} f={f} />
            ))}
        </div>
      )}
    </div>
  );
}

/** The European competitions: the one the manager's club is in first, the others on demand. */
export function EuropePanel({ career }: { career: CareerState }) {
  const europe = career.europe;
  const mine = europe?.comps.filter((c) => c.phases.some((id) => europe.phases.find((p) => p.id === id)!.entrants.includes(career.managedClubId))).map((c) => c.id) ?? [];
  const [shown, setShown] = useState<EuroId>(mine[mine.length - 1] ?? 'cl');
  if (!europe) {
    return (
      <div className="card">
        <h3>Europe</h3>
        <p className="muted">European competitions start next season for this career. Places come from this season's final standings.</p>
      </div>
    );
  }
  const comp = europe.comps.find((c) => c.id === shown)!;
  const champion = comp.championId ? clubById(career, comp.championId) : undefined;
  return (
    <div className="card">
      <h3>
        Europe{' '}
        {champion && (
          <span className="bracket-champion">
            · {comp.name}: 🏆 <Crest team={champion} size={18} /> {champion.name}
          </span>
        )}
      </h3>
      <div className="tabs">
        {EURO_IDS.map((id) => (
          <button key={id} className={`${shown === id ? 'active' : ''}`} onClick={() => setShown(id)}>
            <span className={`comp-dot comp-${id}`} /> {europe.comps.find((c) => c.id === id)!.name}
            {mine.includes(id) ? ' ★' : ''}
          </button>
        ))}
      </div>
      {[...comp.phases].reverse().map((id) => (
        <PhaseView key={id} career={career} phase={europe.phases.find((p) => p.id === id)!} />
      ))}
    </div>
  );
}

/** On the overview before a European game: that phase only (the manager's group or tie). */
export function EuropeFocus({ career, fixture }: { career: CareerState; fixture: Fixture }) {
  const phase = career.europe?.phases.find((p) => p.id === fixture.phaseId);
  if (!phase) return null;
  const comp = career.europe!.comps.find((c) => c.id === phase.comp)!;
  const group = phase.groups?.find((g) => g.clubs.includes(career.managedClubId));
  return (
    <div className="card">
      <h3>
        <span className={`comp-tag comp-${phase.comp}`}>{comp.name}</span> {phase.name}
      </h3>
      {group ? <GroupTable career={career} phase={phase} group={group} through={Math.ceil(phase.target / (phase.groups?.length ?? 1))} /> : <PhaseView career={career} phase={phase} />}
      <p className="muted small">
        Opponent: <OpponentLink career={career} fixture={fixture} />
      </p>
    </div>
  );
}

function OpponentLink({ career, fixture }: { career: CareerState; fixture: Fixture }) {
  const opp = clubById(career, fixture.homeId === career.managedClubId ? fixture.awayId : fixture.homeId);
  if (!opp) return null;
  // Their top scorer this season (public knowledge, unlike their attributes).
  const goals = (id: string) => career.playerStats[id]?.goals ?? 0;
  const best = [...opp.players].filter((p) => goals(p.id) > 0).sort((a, b) => goals(b.id) - goals(a.id))[0];
  return (
    <>
      <b>{opp.name}</b>
      {best && (
        <>
          {' '}
          · top scorer <PlayerLink id={best.id}>{best.name}</PlayerLink> ({goals(best.id)} goals)
        </>
      )}
    </>
  );
}
