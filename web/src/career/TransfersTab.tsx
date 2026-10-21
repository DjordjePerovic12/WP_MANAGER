import { Fragment, useMemo, useState } from 'react';
import { overall, type Position } from '../../../engine';
import {
  answerOffer,
  bidForPlayer,
  currentBids,
  currentOffers,
  formatMoney,
  marketPlayers,
  playerTerms,
  potentialStars,
  releaseCost,
  releasePlayer,
  seasonLabel,
  setTransferListed,
  signPlayer,
  transferWindow,
  wageBill,
  type CareerState,
  type MarketEntry,
} from '../../../game';
import { Crest } from '../Crest';
import { Stars } from './SeasonReview';

type View = 'market' | 'selling' | 'history';
const POSITIONS: (Position | 'ALL')[] = ['ALL', 'GK', 'CENTER', 'CDEF', 'DRIVER', 'WING', 'POINT'];

export function TransfersTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const window = transferWindow(career);
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const f = career.finances[club.id];
  const room = f.wageBudget - wageBill(club, career.contracts);
  const offers = currentOffers(career);
  const [view, setView] = useState<View>('market');

  return (
    <div className="transfers">
      <div className={`card window-banner${window ? ' open' : ''}`}>
        <div>
          <b>{window === 'summer' ? 'Summer transfer window: open' : window === 'winter' ? 'January transfer window: open' : 'Transfer window: closed'}</b>
          <div className="muted small">
            {window === 'summer'
              ? 'It closes when you play the first league round.'
              : window === 'winter'
                ? 'It closes when the January rounds are over.'
                : 'The next window opens in January (or in the summer). You can still release players.'}
          </div>
        </div>
        <div className="money-inline">
          <span>
            Balance <b>{formatMoney(f.balance)}</b>
          </span>
          <span>
            Wage room <b className={room < 0 ? 'down' : ''}>{formatMoney(room)}</b>/season
          </span>
          <span>
            Squad <b>{club.players.length}</b>
          </span>
        </div>
      </div>
      <nav className="tabs sub-tabs">
        <button className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
          Market
        </button>
        <button className={view === 'selling' ? 'active' : ''} onClick={() => setView('selling')}>
          Your players{offers.length ? ` (${offers.length} offer${offers.length > 1 ? 's' : ''})` : ''}
        </button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
          History
        </button>
      </nav>
      {view === 'market' && <Market career={career} onChange={onChange} />}
      {view === 'selling' && <Selling career={career} onChange={onChange} />}
      {view === 'history' && <History career={career} />}
    </div>
  );
}

function Market({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const open = !!transferWindow(career);
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [maxAge, setMaxAge] = useState(40);
  const [maxPrice, setMaxPrice] = useState(0);
  const [freeOnly, setFreeOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'ovr' | 'pot' | 'price' | 'age'>('ovr');
  const [active, setActive] = useState<string | null>(null);
  const [fee, setFee] = useState(0);
  const [terms, setTerms] = useState({ wage: 0, years: 2 });
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
  const all = useMemo(() => marketPlayers(career), [career]);
  const bids = currentBids(career);

  const rows = all
    .filter((m) => position === 'ALL' || m.player.position === position)
    .filter((m) => m.player.age <= maxAge)
    .filter((m) => !maxPrice || m.askingPrice <= maxPrice)
    .filter((m) => !freeOnly || m.clubId === null)
    .filter((m) => !search || m.player.name.toLowerCase().includes(search.toLowerCase()) || m.clubName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === 'ovr' ? overall(b.player) - overall(a.player) : sort === 'pot' ? b.potential - a.potential : sort === 'price' ? a.askingPrice - b.askingPrice : a.player.age - b.player.age,
    )
    .slice(0, 80);

  const say = (id: string, text: string, ok: boolean) => setMessages((m) => ({ ...m, [id]: { text, ok } }));

  const openRow = (m: MarketEntry) => {
    if (active === m.player.id) return setActive(null);
    setActive(m.player.id);
    const counter = bids[m.player.id]?.counter;
    setFee(counter ?? m.askingPrice);
    const t = playerTerms(career, m.player.id);
    setTerms({ wage: t.wage, years: t.years });
  };

  return (
    <div className="card">
      <div className="market-filters">
        <input placeholder="Search name or club" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>
          Position{' '}
          <select value={position} onChange={(e) => setPosition(e.target.value as Position | 'ALL')}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p === 'ALL' ? 'All' : p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max age{' '}
          <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
            {[40, 30, 26, 23, 20].map((a) => (
              <option key={a} value={a}>
                {a === 40 ? 'Any' : a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max price{' '}
          <select value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}>
            {[0, 25_000, 50_000, 100_000, 250_000, 500_000].map((p) => (
              <option key={p} value={p}>
                {p ? formatMoney(p) : 'Any'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free agents only
        </label>
        <label>
          Sort{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="ovr">Best now</option>
            <option value="pot">Potential</option>
            <option value="price">Cheapest</option>
            <option value="age">Youngest</option>
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table className="squad-table market-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Club</th>
              <th>Pos</th>
              <th>Age</th>
              <th>Ovr</th>
              <th>Pot</th>
              <th>Asking price</th>
              <th>Wants</th>
              <th>Contract</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const id = m.player.id;
              const bid = bids[id];
              const agreed = bid?.agreedFee !== undefined;
              const team = m.clubId ? career.teams.find((t) => t.id === m.clubId)! : undefined;
              const t = active === id ? playerTerms(career, id) : undefined;
              const msg = messages[id];
              return (
                <Fragment key={id}>
                  <tr className={agreed ? 'agreed' : ''}>
                    <td>{m.player.name}</td>
                    <td className="club-cell">
                      {team && <Crest team={team} size={16} />} {m.clubName}
                    </td>
                    <td>{m.player.position}</td>
                    <td>{m.player.age}</td>
                    <td>{overall(m.player).toFixed(1)}</td>
                    <td>
                      <Stars value={potentialStars(m.potential)} />
                    </td>
                    <td>{m.clubId ? formatMoney(m.askingPrice) : <span className="up">Free</span>}</td>
                    <td>{formatMoney(m.askingWage)}</td>
                    <td>{m.contract ? seasonLabel(m.contract.until) : '–'}</td>
                    <td>
                      <button disabled={!open} onClick={() => openRow(m)}>
                        {active === id ? 'Close' : agreed || !m.clubId ? 'Terms' : 'Bid'}
                      </button>
                    </td>
                  </tr>
                  {active === id && (
                    <tr className="talks-row">
                      <td colSpan={10}>
                        {m.clubId && !agreed && (
                          <div className="talks">
                            <span>
                              {m.clubName} want <b>{formatMoney(m.askingPrice)}</b>
                              {bid?.counter ? (
                                <>
                                  {' '}
                                  · their counter: <b>{formatMoney(bid.counter)}</b>
                                </>
                              ) : null}
                              {bid ? <span className="muted small"> · bids used {bid.attempts}/3</span> : null}
                            </span>
                            <label>
                              Your bid{' '}
                              <input type="range" min={Math.round(m.askingPrice * 0.3)} max={Math.round(m.askingPrice * 1.3)} step={1000} value={fee} onChange={(e) => setFee(Number(e.target.value))} />{' '}
                              <b>{formatMoney(fee)}</b>
                            </label>
                            <button
                              className="primary"
                              onClick={() => {
                                const out = bidForPlayer(career, id, fee);
                                say(id, out.message, out.response === 'accepted');
                                if (out.response === 'countered' && out.state.bids[id]?.counter) setFee(out.state.bids[id].counter!);
                                onChange(out.state);
                              }}
                            >
                              Make bid
                            </button>
                          </div>
                        )}
                        {(agreed || !m.clubId) && t && (
                          <div className="talks">
                            {!t.willing ? (
                              <span className="warn-text">{t.reason}</span>
                            ) : (
                              <>
                                <span>
                                  {agreed && <>Fee agreed: <b>{formatMoney(bid!.agreedFee!)}</b> · </>}
                                  <b>{m.player.name}</b> wants <b>{formatMoney(t.wage)}</b> a season for {t.years} season{t.years > 1 ? 's' : ''} ·{' '}
                                  <span className="muted">{t.mood === 'keen' ? 'Keen to join' : t.mood === 'open' ? 'Open to it' : 'Needs convincing'}</span>
                                </span>
                                <label>
                                  Wage{' '}
                                  <input type="range" min={Math.round(t.wage * 0.6)} max={Math.round(t.wage * 1.3)} step={1000} value={terms.wage} onChange={(e) => setTerms({ ...terms, wage: Number(e.target.value) })} />{' '}
                                  <b>{formatMoney(terms.wage)}</b>
                                </label>
                                <label>
                                  Seasons{' '}
                                  <select value={terms.years} onChange={(e) => setTerms({ ...terms, years: Number(e.target.value) })}>
                                    {[1, 2, 3, 4, 5].map((y) => (
                                      <option key={y}>{y}</option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  className="primary"
                                  onClick={() => {
                                    const out = signPlayer(career, id, terms.wage, terms.years);
                                    say(id, out.message, out.signed);
                                    if (out.signed) setActive(null);
                                    onChange(out.state);
                                  }}
                                >
                                  Sign
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {msg && <p className={`manager-message${msg.ok ? '' : ' warn-text'}`}>{msg.text}</p>}
                      </td>
                    </tr>
                  )}
                  {active !== id && msg && msg.ok && (
                    <tr className="talks-row">
                      <td colSpan={10}>
                        <p className="manager-message">{msg.text}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 80 && <p className="muted small">Showing the first 80: use the filters to narrow down.</p>}
    </div>
  );
}

function Selling({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const offers = currentOffers(career);
  const open = !!transferWindow(career);
  const [message, setMessage] = useState('');
  const name = (id: string) => club.players.find((p) => p.id === id)?.name ?? '';
  return (
    <div className="career-grid">
      <div className="card">
        <h3>Offers for your players</h3>
        {offers.length === 0 && <p className="muted">{open ? 'No offers right now. Put players on the transfer list to attract bids.' : 'The window is closed.'}</p>}
        {offers.map((o) => {
          const buyer = career.teams.find((t) => t.id === o.clubId)!;
          return (
            <div key={o.id} className="offer-row">
              <Crest team={buyer} size={22} />
              <span>
                <b>{buyer.name}</b> offer <b>{formatMoney(o.fee)}</b> for <b>{name(o.playerId)}</b>
              </span>
              <button
                className="primary"
                onClick={() => {
                  const out = answerOffer(career, o.id, true);
                  setMessage(out.message);
                  onChange(out.state);
                }}
              >
                Accept
              </button>
              <button
                onClick={() => {
                  const out = answerOffer(career, o.id, false);
                  setMessage(out.message);
                  onChange(out.state);
                }}
              >
                Reject
              </button>
            </div>
          );
        })}
        {message && <p className="manager-message">{message}</p>}
      </div>
      <div className="card">
        <h3>Your squad</h3>
        <p className="muted small">List players to invite offers, or release them by paying off half their remaining contract.</p>
        {[...club.players]
          .sort((a, b) => overall(b) - overall(a))
          .map((p) => {
            const listed = career.transferList.includes(p.id);
            return (
              <div key={p.id} className="offer-row">
                <span className="squad-cap">{p.cap}</span>
                <span>
                  {p.name} <span className="muted small">{p.position} · {p.age} · {overall(p).toFixed(1)}</span>
                </span>
                <button disabled={!open && !listed} onClick={() => onChange(setTransferListed(career, p.id, !listed))}>
                  {listed ? 'Unlist' : 'List'}
                </button>
                <button
                  className="link-danger"
                  onClick={() => {
                    if (!confirm(`Release ${p.name}? It costs ${formatMoney(releaseCost(career, p.id))}.`)) return;
                    const out = releasePlayer(career, p.id);
                    setMessage(out.message);
                    onChange(out.state);
                  }}
                >
                  Release ({formatMoney(releaseCost(career, p.id))})
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function History({ career }: { career: CareerState }) {
  const list = [...career.transfers].reverse().slice(0, 60);
  return (
    <div className="card">
      <h3>Transfers</h3>
      {list.length === 0 && <p className="muted">No transfers yet.</p>}
      <table className="league-table">
        <tbody>
          {list.map((t, i) => (
            <tr key={`${t.playerId}-${i}`} className={t.toClubId === career.managedClubId || t.fromClubId === career.managedClubId ? 'mine' : ''}>
              <td className="muted small">{t.season}</td>
              <td style={{ textAlign: 'left' }}>{t.playerName}</td>
              <td style={{ textAlign: 'left' }} className="muted">
                {t.fromClubName} → {t.toClubName}
              </td>
              <td>{t.fee ? formatMoney(t.fee) : 'Free'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
