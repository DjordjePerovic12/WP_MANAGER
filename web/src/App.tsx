import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boxScore,
  describeEvent,
  formatClock,
  LiveMatch,
  overall,
  playerLookup,
  teamRating,
  type MatchEvent,
  type MatchResult,
  type Tactics,
  type Team,
} from '../../engine';
import { useLeague, type League } from './api';
import { Crest } from './Crest';
import { ManagerPanel } from './ManagerPanel';
import { PoolView } from './pool/PoolView';
import { crowd, horn, unlockAudio, whistle } from './sound';

/** Playback pacing: real milliseconds per second of game time, with a minimum and maximum time per event. */
const SPEEDS = {
  Normal: { perGameSecond: 70, min: 900, max: 2200 },
  Fast: { perGameSecond: 20, min: 300, max: 700 },
  /** Only the big moments, each shown long enough to enjoy. */
  Highlights: { perGameSecond: 0, min: 2600, max: 2600 },
  Instant: null,
} as const;
type Speed = keyof typeof SPEEDS;

function isHighlight(e: MatchEvent) {
  if (e.situation === 'shootout' || e.situation === 'penalty') return true;
  return ['goal', 'exclusion', 'penalty_awarded', 'brutality', 'fouled_out', 'timeout', 'quarter_start', 'quarter_end', 'full_time'].includes(e.type);
}

type Line = { e: MatchEvent; text: string };

function toLines(result: MatchResult): Line[] {
  const players = playerLookup(result);
  return result.events.flatMap((e) => {
    const text = describeEvent(e, result, players);
    return text ? [{ e, text }] : [];
  });
}

/** The number of lines to show next: one more, or (in Highlights mode) up to the next big moment. */
function nextCount(lines: Line[], shown: number, speed: Speed) {
  if (speed !== 'Highlights') return shown + 1;
  let i = shown;
  while (i < lines.length && !isHighlight(lines[i].e)) i++;
  return i + 1;
}

/** Sounds for a match event. */
function playSound(e: MatchEvent) {
  if (e.type === 'goal') crowd(e.situation === 'shootout' ? 0.6 : 1);
  else if (e.type === 'brutality') {
    whistle(1.1);
    crowd(0.5);
  } else if (e.type === 'exclusion' || e.type === 'penalty_awarded' || e.type === 'offensive_foul' || e.type === 'timeout') whistle(e.type === 'penalty_awarded' ? 0.8 : 0.45);
  else if (e.type === 'quarter_start') whistle(0.6);
  else if (e.type === 'quarter_end' || e.type === 'full_time') horn();
}

/** How long to show an event before the next one, based on the game time between them. */
function holdTime(speed: Speed, from: MatchEvent | undefined, to: MatchEvent | undefined) {
  const pace = SPEEDS[speed];
  if (!pace) return 0;
  const gameSeconds = from && to && from.quarter === to.quarter ? Math.max(0, from.clock - to.clock) : 4;
  return Math.max(pace.min, Math.min(pace.max, gameSeconds * pace.perGameSecond));
}

export function App() {
  const league = useLeague();
  if (!league) return <main><p className="muted">Loading clubs…</p></main>;
  return <Game league={league} />;
}

function Game({ league }: { league: League }) {
  const teams = league.teams;
  const [homeId, setHomeId] = useState(teams[0].id);
  const [awayId, setAwayId] = useState(teams[1].id);
  const [tactics, setTactics] = useState<Record<string, Tactics>>(() => Object.fromEntries(teams.map((t) => [t.id, t.tactics])));
  const [shootout, setShootout] = useState(true);
  const [speed, setSpeed] = useState<Speed>('Fast');
  const [seed, setSeed] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(false);
  const [manage, setManage] = useState<'none' | 'home' | 'away'>('none');
  /** The match being played: stepped one possession at a time, so the manager can intervene. */
  const liveRef = useRef<LiveMatch | null>(null);
  const [, refresh] = useState(0);

  const withTactics = (id: string): Team => {
    const team = teams.find((t) => t.id === id)!;
    return { ...team, tactics: tactics[id] };
  };

  const play = () => {
    const live = new LiveMatch([withTactics(homeId), withTactics(awayId)], {
      seed: seed ? Number(seed) : undefined,
      shootoutOnDraw: shootout,
      managed: [manage === 'home', manage === 'away'],
    });
    liveRef.current = live;
    if (SPEEDS[speed] === null) while (!live.finished) live.step();
    else live.step();
    if (sound) unlockAudio();
    setResult(live.result());
    setPaused(false);
    setShown(SPEEDS[speed] === null ? Infinity : 0);
  };

  const skipToEnd = () => {
    const live = liveRef.current;
    if (!live) return;
    while (!live.finished) live.step();
    setResult(live.result());
    setShown(Infinity);
  };

  const lines = useMemo(() => (result ? toLines(result) : []), [result]);
  const live = liveRef.current;
  const finished = !!result && (!live || live.finished) && shown >= lines.length;
  const stepMs = holdTime(speed, lines[shown - 1]?.e, lines[nextCount(lines, shown, speed) - 1]?.e);

  useEffect(() => {
    if (!result || finished || paused) return;
    const timer = setTimeout(() => {
      // Play more of the match only when the viewer needs it, so manager decisions take effect right away.
      const match = liveRef.current;
      let available = lines;
      let target = nextCount(available, shown, speed);
      let stepped = false;
      while (match && !match.finished && target > available.length) {
        match.step();
        stepped = true;
        available = toLines(match.result());
        target = nextCount(available, shown, speed);
      }
      if (stepped && match) setResult(match.result());
      setShown(Math.min(target, available.length));
    }, stepMs);
    return () => clearTimeout(timer);
  }, [result, shown, finished, speed, lines, paused, stepMs]);

  const visible = lines.slice(0, shown);
  const current = visible.at(-1)?.e;

  // Sounds for the newly shown event.
  useEffect(() => {
    if (sound && current && SPEEDS[speed] !== null) playSound(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main>
      <header>
        <h1>Water Polo Manager</h1>
        <p className="muted">
          Match engine prototype ·{' '}
          {league.source === 'real' ? 'real clubs, 2026-27 European cups' : 'fictional clubs (start the API with npm run server for real ones)'}
        </p>
      </header>

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
          Speed{' '}
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            {Object.keys(SPEEDS).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
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
        <label>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              if (e.target.checked) unlockAudio();
            }}
          />{' '}
          Sound
        </label>
        <button className="primary" onClick={play} disabled={homeId === awayId}>
          ▶ Play match
        </button>
        {result && !finished && <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>}
        {result && !finished && <button onClick={skipToEnd}>Skip to end</button>}
      </section>

      {result && (
        <>
          <Scoreboard result={result} score={current?.score ?? [0, 0]} quarter={current?.quarter ?? 1} clock={current?.clock ?? 480} finished={finished} />
          <div style={{ ['--move-ms' as string]: `${speed === 'Normal' ? 700 : 250}ms` }}>
            <PoolView result={result} eventIndex={current ? result.events.indexOf(current) : 0} stepMs={finished || paused ? 0 : stepMs} />
          </div>
          {live && !live.finished && manage !== 'none' && (
            <ManagerPanel
              live={live}
              team={manage === 'home' ? 0 : 1}
              result={result}
              onChange={() => {
                setResult(live.result());
                refresh((n) => n + 1);
              }}
            />
          )}
          <section className="match">
            <ol className="commentary">
              {[...visible].reverse().map(({ e, text }, i) => (
                <li key={visible.length - i} className={`ev-${e.type}${e.type === 'goal' && e.situation !== 'shootout' ? ` team-${e.team}` : ''}`}>
                  {e.type.startsWith('quarter') || e.type === 'full_time' ? null : (
                    <span className="clock">
                      {e.quarter > 4 ? 'SO' : `Q${e.quarter}`} {formatClock(e.clock)}
                    </span>
                  )}
                  {text}
                </li>
              ))}
            </ol>
            {finished && <BoxScore result={result} />}
          </section>
        </>
      )}
    </main>
  );
}

function TeamPanel(props: { league: League; label: string; teamId: string; onTeam: (id: string) => void; tactics: Tactics; onTactics: (t: Tactics) => void }) {
  const { tactics: t, onTactics, league } = props;
  const team = league.teams.find((x) => x.id === props.teamId)!;
  const set = <K extends keyof Tactics>(key: K, value: Tactics[K]) => onTactics({ ...t, [key]: value });
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
      <div className="tactics">
        <label>
          Defense
          <select value={t.defense} onChange={(e) => set('defense', e.target.value as Tactics['defense'])}>
            <option value="press">Press (man-to-man)</option>
            <option value="zone">Zone</option>
            <option value="mdrop">M-drop</option>
          </select>
        </label>
        <label>
          6 on 5 setup
          <select value={t.powerPlay} onChange={(e) => set('powerPlay', e.target.value as Tactics['powerPlay'])}>
            <option value="4-2">4-2 (shooters)</option>
            <option value="3-3">3-3 (passing and posts)</option>
          </select>
        </label>
        <label>
          Counterattack: {t.counterAggression}
          <input type="range" min={1} max={5} value={t.counterAggression} onChange={(e) => set('counterAggression', Number(e.target.value))} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={t.frontCenter} onChange={(e) => set('frontCenter', e.target.checked)} /> Front the center
        </label>
      </div>
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

function Scoreboard(props: { result: MatchResult; score: [number, number]; quarter: number; clock: number; finished: boolean }) {
  const { result, score } = props;
  const status = props.finished ? 'Full time' : props.quarter > 4 ? 'Shootout' : `Q${props.quarter} · ${formatClock(props.clock)}`;
  return (
    <section className="scoreboard">
      <div className="side">
        <Crest team={result.teams[0]} size={40} /> {result.teams[0].name}
      </div>
      <div className="score">
        <span key={`h${score[0]}`} className={score[0] ? 'score-flip' : ''}>{score[0]}</span> –{' '}
        <span key={`a${score[1]}`} className={score[1] ? 'score-flip' : ''}>{score[1]}</span>
        <div className="status">{status}</div>
        {props.finished && result.shootout && (
          <div className="status">
            Penalties {result.shootout[0]}–{result.shootout[1]}
          </div>
        )}
      </div>
      <div className="side right">
        {result.teams[1].name} <Crest team={result.teams[1]} size={40} />
      </div>
      {props.finished && (
        <div className="quarters">
          {result.quarterScores.map(([a, b], i) => (
            <span key={i}>
              Q{i + 1} {a}–{b}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function BoxScore({ result }: { result: MatchResult }) {
  const box = boxScore(result);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  return (
    <div className="box">
      {result.teams.map((team, i) => {
        const t = box.teams[i];
        return (
          <div key={team.id} className="card">
            <h3 className="box-title">
              <Crest team={team} size={24} /> {team.name}
            </h3>
            <div className="team-stats">
              <span>
                Shots <b>{t.goals}/{t.shots}</b>
              </span>
              <span>
                6 on 5{' '}
                <b>
                  {t.powerPlayGoals}/{t.exclusionsDrawn} ({pct(t.powerPlayGoals, t.exclusionsDrawn)})
                </b>
              </span>
              <span>
                Penalties <b>{t.penaltyGoals}/{t.penaltiesAwarded}</b>
              </span>
              <span>
                Counter goals <b>{t.counterGoals}</b>
              </span>
              <span>
                Turnovers <b>{t.turnovers}</b>
              </span>
              <span>
                Saves <b>{t.saves}</b>
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Pos</th>
                  <th title="Minutes">Min</th>
                  <th title="Goals">G</th>
                  <th title="Shots">Sh</th>
                  <th title="Assists">A</th>
                  <th title="Exclusions drawn">ExD</th>
                  <th title="Personal fouls">PF</th>
                  <th title="Steals">St</th>
                  <th title="Saves">Sv</th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((p) => {
                  const s = box.players[p.id];
                  return (
                    <tr key={p.id} className={s.personalFouls >= 3 ? 'fouled-out' : ''}>
                      <td>{p.cap}</td>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td>{formatClock(Math.round(s.seconds))}</td>
                      <td>{s.goals || ''}</td>
                      <td>{s.shots || ''}</td>
                      <td>{s.assists || ''}</td>
                      <td>{s.exclusionsDrawn || ''}</td>
                      <td>{s.personalFouls || ''}</td>
                      <td>{s.steals || ''}</td>
                      <td>{s.saves || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
