import { Fragment, useState } from 'react';
import { overall } from '../../../engine';
import {
  contractDemand,
  expiringContracts,
  formatMoney,
  offerContract,
  playerValue,
  seasonLabel,
  seasonYear,
  wageBill,
  wageRoom,
  type CareerState,
} from '../../../game';

const MOOD = { keen: 'Keen to stay', open: 'Open to staying', reluctant: 'Not sure he wants to stay' };

/** Finances and contracts of the managed club. */
export function ClubTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const f = career.finances[club.id];
  const bill = wageBill(club, career.contracts);
  const year = seasonYear(career.season);
  const expiring = new Set(expiringContracts(career).map((p) => p.id));
  const income = f.ledger.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const wagesPaid = -f.ledger.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
  const [talking, setTalking] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ wage: number; years: number }>({ wage: 0, years: 2 });
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});

  const players = [...club.players].sort(
    (a, b) => Number(expiring.has(b.id)) - Number(expiring.has(a.id)) || (career.contracts[a.id]?.until ?? 0) - (career.contracts[b.id]?.until ?? 0) || overall(b) - overall(a),
  );

  const openTalks = (id: string) => {
    const demand = contractDemand(career, id);
    setOffer({ wage: demand.wage, years: demand.years });
    setTalking(talking === id ? null : id);
  };

  const makeOffer = (id: string) => {
    const out = offerContract(career, id, offer.wage, offer.years);
    setMessages({ ...messages, [id]: { text: out.message, ok: out.accepted } });
    if (out.accepted) setTalking(null);
    onChange(out.state);
  };

  return (
    <div className="club">
      <div className="career-grid">
        <div className="card">
          <h3>Finances</h3>
          <div className="money-grid">
            <div>
              <span className="muted small">Balance</span>
              <b className={f.balance < 0 ? 'down' : ''}>{formatMoney(f.balance)}</b>
            </div>
            <div>
              <span className="muted small">Income per season</span>
              <b>{formatMoney(f.revenue)}</b>
            </div>
            <div>
              <span className="muted small">Wage bill</span>
              <b>{formatMoney(bill)}</b>
            </div>
            <div>
              <span className="muted small">Wage budget</span>
              <b>{formatMoney(f.wageBudget)}</b>
            </div>
          </div>
          <div className="budget-bar" title={`${Math.round((bill / f.wageBudget) * 100)}% of the wage budget`}>
            <span style={{ width: `${Math.min(100, (bill / f.wageBudget) * 100)}%`, background: bill > f.wageBudget ? '#c0392b' : bill > f.wageBudget * 0.95 ? '#ffb703' : '#2a9d5c' }} />
          </div>
          <p className="muted small">
            Room for wages: <b>{formatMoney(f.wageBudget - bill)}</b> per season. This season so far: {formatMoney(income)} in, {formatMoney(wagesPaid)} wages out. Prize money is
            paid when the season ends: higher finishes earn more, and the board raises or cuts next season's budget depending on how you did.
          </p>
          {f.lastSeason && (
            <p className="small">
              Last season ({f.lastSeason.season}): {formatMoney(f.lastSeason.income)} income, {formatMoney(f.lastSeason.wages)} wages, {formatMoney(f.lastSeason.prizeMoney)} prize money ·{' '}
              <b className={f.lastSeason.balanceChange < 0 ? 'down' : 'up'}>{formatMoney(f.lastSeason.balanceChange)}</b>
            </p>
          )}
        </div>
        <div className="card">
          <h3>Contracts ending</h3>
          {expiring.size === 0 ? (
            <p className="muted">No contracts end this season.</p>
          ) : (
            <p>
              <b>{expiring.size}</b> contract{expiring.size > 1 ? 's end' : ' ends'} after {career.season}. Players you don't renew leave in the summer as free agents.
            </p>
          )}
          <p className="muted small">Players ask for a wage and length. Meet it and they sign; offer less and they may refuse, and a lowball offer can end the talks. Three offers per player per season.</p>
        </div>
      </div>

      <div className="card">
        <h3>Contracts</h3>
        <div className="table-scroll">
          <table className="squad-table contracts-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Pos</th>
                <th>Age</th>
                <th>Ovr</th>
                <th>Value</th>
                <th>Wage</th>
                <th>Until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const contract = career.contracts[p.id];
                const ending = expiring.has(p.id);
                const talks = career.negotiations[p.id];
                const signed = talks?.closed && contract && contract.until > year;
                const demand = talking === p.id ? contractDemand(career, p.id) : undefined;
                const msg = messages[p.id];
                return (
                  <Fragment key={p.id}>
                    <tr className={ending ? 'ending' : ''}>
                      <td>{p.cap}</td>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td>{p.age}</td>
                      <td>{overall(p).toFixed(1)}</td>
                      <td>{formatMoney(playerValue(p, career.potential[p.id]))}</td>
                      <td>{contract ? formatMoney(contract.wage) : '–'}</td>
                      <td>{contract ? (ending ? <b className="down">ends {seasonLabel(contract.until)}</b> : seasonLabel(contract.until)) : '–'}</td>
                      <td>
                        {(ending || (contract && contract.until <= year + 1)) && !signed && !talks?.closed && (
                          <button onClick={() => openTalks(p.id)}>{talking === p.id ? 'Close' : 'Renew'}</button>
                        )}
                        {talks?.closed && !signed && <span className="muted small">Talks over</span>}
                      </td>
                    </tr>
                    {(demand || msg) && (
                      <tr className="talks-row">
                        <td colSpan={9}>
                          {demand && (
                            <div className="talks">
                              <span>
                                <b>{p.name}</b> wants <b>{formatMoney(demand.wage)}</b> a season for <b>{demand.years}</b> season{demand.years > 1 ? 's' : ''} · <span className={demand.mood === 'reluctant' ? 'down' : 'muted'}>{MOOD[demand.mood]}</span>
                              </span>
                              <label>
                                Wage{' '}
                                <input
                                  type="range"
                                  min={Math.round(demand.wage * 0.6)}
                                  max={Math.round(demand.wage * 1.3)}
                                  step={1000}
                                  value={offer.wage}
                                  onChange={(e) => setOffer({ ...offer, wage: Number(e.target.value) })}
                                />{' '}
                                <b>{formatMoney(offer.wage)}</b> <span className="muted small">({Math.round((offer.wage / demand.wage) * 100)}% of his ask)</span>
                              </label>
                              <label>
                                Seasons{' '}
                                <select value={offer.years} onChange={(e) => setOffer({ ...offer, years: Number(e.target.value) })}>
                                  {[1, 2, 3, 4, 5].map((y) => (
                                    <option key={y}>{y}</option>
                                  ))}
                                </select>
                              </label>
                              <span className="muted small">Room in budget: {formatMoney(wageRoom(career, p.id))}</span>
                              <button className="primary" onClick={() => makeOffer(p.id)}>
                                Offer contract
                              </button>
                            </div>
                          )}
                          {msg && <p className={`manager-message${msg.ok ? '' : ' warn-text'}`}>{msg.text}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
