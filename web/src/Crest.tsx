import { useState } from 'react';

const PREFIXES = new Set(['VK', 'CN', 'AN', 'CC', 'SC', 'NK', 'PK', 'VPK', 'HAVK', 'PVK', 'AC', 'CS', 'ASD', 'ASC', 'GS', 'SPD', 'OSC', 'CSM', 'PRO']);

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Up to two initials, skipping club-type prefixes like "VK" or "CN". */
export function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => w && !PREFIXES.has(w.toUpperCase()));
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2)).toUpperCase();
}

/** Clubs whose logo file doesn't exist, so it isn't requested again. */
const MISSING = new Set<string>();

/** Club logo from /logos/<club id>.png (real clubs), or a generated shield crest. */
export function Crest({ team, size = 28 }: { team: { id: string; name: string }; size?: number }) {
  // Remember failures per club id: the same component can show another club after a re-render.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = !team.id.startsWith('EA-') || failedId === team.id || MISSING.has(team.id);
  if (!failed) {
    return (
      <img
        key={team.id}
        className="crest"
        src={`/logos/${team.id}.png`}
        alt=""
        width={size}
        height={size}
        onError={() => {
          MISSING.add(team.id);
          setFailedId(team.id);
        }}
      />
    );
  }
  const h = hash(team.name);
  const hue = h % 360;
  const stripe = (hue + 160 + (h % 60)) % 360;
  return (
    <svg className="crest" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 1.5 L29 6 V15 C29 23 23 28.5 16 30.5 C9 28.5 3 23 3 15 V6 Z" fill={`hsl(${hue} 60% 38%)`} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <path d="M3 15 C9 13 23 17 29 15 V17 C23 19 9 15 3 17 Z" fill={`hsl(${stripe} 70% 60%)`} opacity="0.85" />
      <text x="16" y="13.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        {initials(team.name)}
      </text>
    </svg>
  );
}
