import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boxScore,
  describeEvent,
  formatClock,
  LiveMatch,
  playerLookup,
  type MatchEvent,
  type MatchResult,
  type Team,
} from '../../../engine';
import { Crest } from '../Crest';
import { ManagerPanel } from '../ManagerPanel';
import { PoolView } from '../pool/PoolView';
import { crowd, horn, unlockAudio, whistle } from '../sound';

/** Playback pacing: real milliseconds per second of game time, with a minimum and maximum time per event. */
export const SPEEDS = {
  Normal: { perGameSecond: 70, min: 900, max: 2200 },
  Fast: { perGameSecond: 20, min: 300, max: 700 },
  /** Only the big moments, each shown long enough to enjoy. */
  Highlights: { perGameSecond: 0, min: 2600, max: 2600 },
  Instant: null,
} as const;
export type Speed = keyof typeof SPEEDS;

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

export interface MatchPlayerProps {
  home: Team;
  away: Team;
  seed?: number;
  shootoutOnDraw: boolean;
  /** the team the user manages live (0 = home, 1 = away), or null to just watch */
  manage: 0 | 1 | null;
  initialSpeed?: Speed;
  /** called once when the final whistle has been shown */
  onFinished?: (result: MatchResult) => void;
}

/**
 * Plays a match: starts on mount, steps the live engine as the viewer needs it,
 * and shows the scoreboard, pool view, manager controls, commentary and box score.
 */
export function MatchPlayer({ home, away, seed, shootoutOnDraw, manage, initialSpeed = 'Normal', onFinished }: MatchPlayerProps) {
  const [speed, setSpeed] = useState<Speed>(initialSpeed);
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [shown, setShown] = useState(0);
  const liveRef = useRef<LiveMatch | null>(null);
  const reported = useRef(false);
  const [, refresh] = useState(0);

  // Kick off on mount.
  useEffect(() => {
    const live = new LiveMatch([home, away], { seed, shootoutOnDraw, managed: [manage === 0, manage === 1] });
    liveRef.current = live;
    reported.current = false;
    if (SPEEDS[initialSpeed] === null) while (!live.finished) live.step();
    else live.step();
    setResult(live.result());
    setShown(SPEEDS[initialSpeed] === null ? Infinity : 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (finished && result && !reported.current) {
      reported.current = true;
      onFinished?.(result);
    }
  }, [finished, result, onFinished]);

  const visible = lines.slice(0, shown);
  const current = visible.at(-1)?.e;

  // Sounds for the newly shown event.
  useEffect(() => {
    if (sound && current && SPEEDS[speed] !== null) playSound(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null;
  return (
    <>
      <section className="controls">
        <label>
          Speed{' '}
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            {Object.keys(SPEEDS).map((s) => (
              <option key={s}>{s}</option>
            ))}
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
        {!finished && <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>}
        {!finished && <button onClick={skipToEnd}>Skip to end</button>}
      </section>
      <Scoreboard result={result} score={current?.score ?? [0, 0]} quarter={current?.quarter ?? 1} clock={current?.clock ?? 480} finished={finished} />
      <div style={{ ['--move-ms' as string]: `${speed === 'Normal' ? 700 : 250}ms` }}>
        <PoolView result={result} eventIndex={current ? result.events.indexOf(current) : 0} stepMs={finished || paused ? 0 : stepMs} />
      </div>
      {live && !live.finished && manage !== null && (
        <ManagerPanel
          live={live}
          team={manage}
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

export function BoxScore({ result }: { result: MatchResult }) {
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
