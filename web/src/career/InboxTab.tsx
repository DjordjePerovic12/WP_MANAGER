import { useState } from 'react';
import { answerMessage, markRead, type CareerState, type InboxItem } from '../../../game';
import { PlayerLink } from './PlayerProfile';

const formatDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const ICON: Record<InboxItem['kind'], string> = { 'playing-time': '⏱', contract: '✍️', interest: '👀', 'transfer-request': '🚪', board: '🏛', offer: '💶', promise: '🤝' };

/** Messages that still need the manager's answer. */
export const waiting = (career: CareerState) => (career.inbox ?? []).filter((m) => m.options && !m.answer);

/** The inbox: messages on the left, the open one on the right with its answers. */
export function InboxTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const items = [...(career.inbox ?? [])].reverse();
  const [openId, setOpenId] = useState<string | null>(waiting(career).at(-1)?.id ?? items[0]?.id ?? null);
  const open = items.find((m) => m.id === openId);
  const select = (m: InboxItem) => {
    setOpenId(m.id);
    if (!m.read) onChange(markRead(career, m.id));
  };
  return (
    <div className="inbox card">
      <div className="inbox-list">
        {items.length === 0 && <p className="muted">No messages yet.</p>}
        {items.map((m) => (
          <button key={m.id} className={`inbox-row${m.id === openId ? ' active' : ''}${!m.read ? ' unread' : ''}${m.options && !m.answer ? ' needs-answer' : ''}`} onClick={() => select(m)}>
            <span className="inbox-icon">{ICON[m.kind]}</span>
            <span className="inbox-row-main">
              <b>{m.subject}</b>
              <span className="muted small">
                {m.from} · {formatDate(m.date)}
              </span>
            </span>
            {m.options && !m.answer && <span className="inbox-badge">Reply</span>}
          </button>
        ))}
      </div>
      <div className="inbox-detail">
        {open ? (
          <>
            <h3>
              {ICON[open.kind]} {open.subject}
            </h3>
            <p className="muted small">
              From {open.playerId ? <PlayerLink id={open.playerId}>{open.from}</PlayerLink> : open.from} · {formatDate(open.date)}
              {open.expires && !open.answer && <> · reply by {formatDate(open.expires)}</>}
            </p>
            <p className="inbox-body">{open.body}</p>
            {open.options && !open.answer && (
              <div className="inbox-options">
                {open.options.map((o) => (
                  <button key={o.id} className="inbox-option" onClick={() => onChange(answerMessage(career, open.id, o.id).state)}>
                    <b>{o.label}</b>
                    {o.hint && <span className="muted small">{o.hint}</span>}
                  </button>
                ))}
              </div>
            )}
            {open.answer && (
              <p className={`inbox-reply${open.answer === 'ignored' ? ' warn-text' : ''}`}>
                {open.answer === 'ignored' ? '' : `You: ${open.options?.find((o) => o.id === open.answer)?.label}. `}
                {open.reply}
              </p>
            )}
          </>
        ) : (
          <p className="muted">Select a message.</p>
        )}
      </div>
    </div>
  );
}
