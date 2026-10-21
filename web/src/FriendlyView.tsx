import { useState } from 'react';
import { overall, teamRating, type Tactics, type Team } from '../../engine';
import type { League } from './api';
import { Crest } from './Crest';
import { MatchPlayer } from './match/MatchPlayer';
import { TacticsFields } from './TacticsFields';

/** A one-off match between any two clubs. */
export function FriendlyView({ league }: { league: League }) {
  const teams = league.teams;
  const [homeId, setHomeId] = useState(teams[0].id);
  const [awayId, setAwayId] = useState(teams[1].id);
  const [tactics, setTactics] = useState<Record<string, Tactics>>(() => Object.fromEntries(teams.map((t) => [t.id, t.tactics])));
  const [shootout, setShootout] = useState(true);
  const [seed, setSeed] = useState('');
  const [manage, setManage] = useState<'none' | 'home' | 'away'>('none');
  const [match, setMatch] = useState<{ key: number; home: Team; away: Team; seed?: number; shootout: boolean; manage: 0 | 1 | null } | null>(null);

  const withTactics = (id: string): Team => ({ ...teams.find((t) => t.id === id)!, tactics: tactics[id] });
  const play = () =>
    setMatch({
      key: Date.now(),
      home: withTactics(homeId),
      away: withTactics(awayId),
      seed: seed ? Number(seed) : undefined,
      shootout,
      manage: manage === 'home' ? 0 : manage === 'away' ? 1 : null,
    });

  return (
    <>
      <section className="setup">
        {[
          { id: homeId, set: setHomeId, label: 'Home' },
          { id: awayId, set: setAwayId, label: 'Away' },
        ].map(({ id, set, label }) => (
          <TeamPanel
            key={label}
            league={league}
            label={label}
            teamId={id}
            onTeam={set}
            tactics={tactics[id]}
            onTactics={(t) => setTactics((all) => ({ ...all, [id]: t }))}
          />
        ))}
      </section>
      <section className="controls">
        <label>
          <input type="checkbox" checked={shootout} onChange={(e) => setShootout(e.target.checked)} /> Penalty shootout on a draw
        </label>
        <label>
          Seed <input className="seed" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label>
          You manage{' '}
          <select value={manage} onChange={(e) => setManage(e.target.value as typeof manage)}>
            <option value="none">Nobody (watch)</option>
            <option value="home">Home team</option>
            <option value="away">Away team</option>
          </select>
        </label>
        <button className="primary" onClick={play} disabled={homeId === awayId}>
          ▶ Play match
        </button>
      </section>
      {match && (
        <MatchPlayer key={match.key} home={match.home} away={match.away} seed={match.seed} shootoutOnDraw={match.shootout} manage={match.manage} initialSpeed="Fast" />
      )}
    </>
  );
}

function TeamPanel(props: { league: League; label: string; teamId: string; onTeam: (id: string) => void; tactics: Tactics; onTactics: (t: Tactics) => void }) {
  const { tactics: t, onTactics, league } = props;
  const team = league.teams.find((x) => x.id === props.teamId)!;
  return (
    <div className="card">
      <div className="muted small team-label">
        <Crest team={team} size={26} /> {props.label}
      </div>
      <select className="team-select" value={props.teamId} onChange={(e) => props.onTeam(e.target.value)}>
        {league.groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.teamIds.map((id) => {
              const x = league.teams.find((tm) => tm.id === id)!;
              return (
                <option key={x.id} value={x.id}>
                  {x.name} ({teamRating(x.players).toFixed(1)})
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>
      <TacticsFields tactics={t} onChange={onTactics} />
      <details>
        <summary>Squad</summary>
        <table className="squad">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Hand</th>
              <th>Age</th>
              <th>Ovr</th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((p) => (
              <tr key={p.id}>
                <td>{p.cap}</td>
                <td>{p.name}</td>
                <td>{p.position}</td>
                <td>{p.hand}</td>
                <td>{p.age}</td>
                <td>{overall(p).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

