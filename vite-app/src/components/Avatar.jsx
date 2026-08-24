import React from 'react';

// Eight hues chosen to sit off the venue palette and the status ramps.
const AVATAR_HUES = [18, 48, 92, 168, 200, 232, 288, 328];

export default function Avatar({ src, username, size = 28, style }) {
  if (src) {
    return (
      <img
        src={src}
        alt={username}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0, ...style
        }}
      />
    );
  }
  const initial = (username || '?').charAt(0).toUpperCase();
  // A free 360-degree hue collides with the 121 venue colours AND with the
  // status greens and reds - in the connections row an avatar sits 8px from a
  // green playing dot, so a username hashing near hue 140 got a green avatar
  // wearing a green status dot. Eight curated hues, chosen to sit off the
  // venue palette, keep the field bounded.
  const hash = [...(username || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--radius-circle)', flexShrink: 0,
      background: `hsl(${hue}, 42%, 42%)`, color: '#fff',
      // Without an edge a dark-hued avatar dissolves into --surface.
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size >= 28 ? 'var(--fs-sm)' : 'var(--fs-2xs)',
      fontWeight: 'var(--fw-bold)', lineHeight: 1,
      ...style
    }}>
      {initial}
    </div>
  );
}
