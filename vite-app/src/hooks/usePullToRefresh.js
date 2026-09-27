import { useState, useCallback, useRef } from 'react';

export default function usePullToRefresh(scrollRef, onRefresh) {
  const ptrStart = useRef(null);
  const ptrDy = useRef(0);
  const ptrIndicator = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const threshold = 60;

  const onPtrTouchStart = useCallback((e) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0 || refreshing) return;
    ptrStart.current = e.touches[0].clientY;
    ptrDy.current = 0;
  }, [refreshing, scrollRef]);

  const onPtrTouchMove = useCallback((e) => {
    if (ptrStart.current === null) return;
    const dy = e.touches[0].clientY - ptrStart.current;
    if (dy < 0) { ptrStart.current = null; return; }
    ptrDy.current = dy;
    if (ptrIndicator.current) {
      const progress = Math.min(dy / threshold, 1);
      const offset = Math.min(dy * 0.5, 50);
      ptrIndicator.current.style.transform = `translateX(-50%) translateY(${offset}px) rotate(${progress * 360}deg)`;
      ptrIndicator.current.classList.toggle('visible', dy > 10);
    }
  }, []);

  const onPtrTouchEnd = useCallback(async () => {
    const dy = ptrDy.current;
    ptrStart.current = null;
    if (dy >= threshold && !refreshing) {
      setRefreshing(true);
      if (ptrIndicator.current) {
        ptrIndicator.current.style.transform = 'translateX(-50%) translateY(calc(var(--subrow) * 5))';
        ptrIndicator.current.classList.add('visible');
      }
      try { await onRefresh(); } catch (e) { console.error('Refresh failed:', e); }
      setRefreshing(false);
    }
    if (ptrIndicator.current) {
      ptrIndicator.current.classList.remove('visible');
      ptrIndicator.current.style.transform = 'translateX(-50%)';
    }
  }, [onRefresh, refreshing]);

  const ptrProps = { onTouchStart: onPtrTouchStart, onTouchMove: onPtrTouchMove, onTouchEnd: onPtrTouchEnd };
  return { ptrProps, ptrIndicator, refreshing };
}
