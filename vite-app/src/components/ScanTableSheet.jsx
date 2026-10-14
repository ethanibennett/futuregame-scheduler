import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import TableScanner from './TableScanner.jsx';

// The Playing card's Scan table action (the home's Table Scanner section until 2026-10-12): the
// card's button opens the photo picker, and this sheet runs the scan on the screenshot chosen —
// progress, then the seats, with the scanner's own Rescan and export. The names it finds are kept
// for the hand replayer's seats, as before (TableScanner: localStorage tableScanPlayers).
// Frame: the bankroll sheet's (.bk-scrim / .bk-sheet, styles.css), portalled to the body.
export default function ScanTableSheet({ file, onClose }) {
  const doneRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    doneRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="bk-scrim" onClick={onClose}>
      <div className="bk-sheet scan-sheet" role="dialog" aria-modal="true" aria-label="Scan table" onClick={(e) => e.stopPropagation()}>
        <div className="bk-sheet-head">
          <h2 className="bk-sheet-title">Scan table</h2>
          <button ref={doneRef} type="button" className="bk-btn bk-btn--ghost bk-w6" onClick={onClose}><span>Done</span></button>
        </div>
        <TableScanner initialFile={file} />
      </div>
    </div>,
    document.body
  );
}
