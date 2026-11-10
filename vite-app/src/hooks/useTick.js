import { useEffect, useState } from 'react';

/** Re-render every `ms` while `active`: for a clock or a countdown that is actually ticking. */
export default function useTick(active, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
