// ── Tax report exports (BETA): CSV session log + printable PDF summary ──────
// Delivered the way every other export is: shareOrDownloadBlob() (export.js) — the Web Share sheet
// where the platform can share files (iOS WKWebView under Capacitor, where an <a download> does
// nothing), else a download link. "Printable" means a PDF: window.print() is a no-op in the iOS
// WKWebView, while a shared PDF can be printed from the share sheet. jsPDF + autotable are the
// same lazy chunks the schedule PDF uses.
import { shareOrDownloadBlob } from './export.js';
import { sessionsToCsv } from './tax-report.js';
import { TAX_DISCLAIMER, TAX_SOURCES, MONTH_SHORT, usd, signedUsd, filingRows, w2gRuleText, lossRuleText } from './tax-report-text.js';

export async function exportTaxCsv(report) {
  const blob = new Blob([sessionsToCsv(report)], { type: 'text/csv;charset=utf-8' });
  await shareOrDownloadBlob(blob, `futuregame-results-${report.year}.csv`, 'text/csv');
}

export async function exportTaxPdf(report, { basis = 'gross', playerName = '' } = {}) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pw = doc.internal.pageSize.width;
  const M = 40;
  let y = M;

  const text = (s, { size = 10, bold = false, color = [0, 0, 0], gap = 4 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(s, pw - M * 2);
    doc.text(lines, M, y + size);
    y += lines.length * size * 1.25 + gap;
  };
  const table = (head, body, opts = {}) => {
    autoTable(doc, {
      startY: y, head: [head], body, margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [40, 40, 40], textColor: 255 },
      theme: 'grid', ...opts,
    });
    y = doc.lastAutoTable.finalY + 14;
  };

  text(`Poker results — tax year ${report.year}`, { size: 16, bold: true, gap: 2 });
  text(`${playerName ? playerName + ' · ' : ''}futurega.me · generated ${new Date().toLocaleDateString('en-US')} · BETA`, { size: 9, color: [90, 90, 90], gap: 10 });
  text(TAX_DISCLAIMER, { size: 9, bold: true, gap: 12 });

  const t = report.totals;
  text('Totals', { size: 12, bold: true });
  table(['', 'Amount'], [
    ['Gross winnings (sum of cashes)', usd(t.grossWinnings)],
    ['Total buy-ins (wagers)', usd(t.totalBuyins)],
    ['Net', signedUsd(t.net)],
    ['Sessions / cashes', `${t.sessions} / ${t.cashes}`],
    ['Winning sessions, net (per-event basis)', usd(t.sessionWinnings)],
    ['Losing sessions, net (per-event basis)', usd(t.sessionLosses)],
  ], { columnStyles: { 1: { halign: 'right' } } });

  const months = report.months.filter((m) => m.sessions);
  if (months.length) {
    text('By month', { size: 12, bold: true });
    table(['Month', 'Sessions', 'Cashes', 'Winnings', 'Buy-ins', 'Net'],
      months.map((m) => [MONTH_SHORT[m.month - 1], m.sessions, m.cashes, usd(m.winnings), usd(m.buyins), signedUsd(m.net)]),
      { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  }

  text('Possible W-2G events (likely, not certain)', { size: 12, bold: true });
  text(w2gRuleText(report), { size: 8, color: [60, 60, 60] });
  if (report.w2g.length) {
    table(['Date', 'Room', 'Event', 'Buy-in', 'Cash', 'Cash - buy-in'],
      report.w2g.map((s) => [s.date, s.room || s.venue, s.event, usd(s.buyin), usd(s.cash), usd(s.w2gNet)]),
      { columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  } else {
    text('None of this year\'s cashes reach the threshold.', { size: 9, gap: 12 });
  }

  const f = report.filing[basis];
  text(`Recreational vs professional (${basis === 'session' ? 'per-event' : 'gross'} basis)`, { size: 12, bold: true });
  text(lossRuleText(report, f), { size: 8, color: [60, 60, 60] });
  table(['', 'Recreational', 'Professional'], filingRows(f).map((r) => [r.label, r.rec, r.pro]),
    { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });

  text('Session log', { size: 12, bold: true });
  table(['Date', 'Room / site', 'City/State', 'Event', 'Buy-in × n', 'Cash', 'Net', ''],
    report.sessions.map((s) => [
      s.date,
      s.online ? `Online · ${s.site}` : (s.room || s.venue),
      s.location,
      s.event,
      `${s.currency === 'USD' ? usd(s.buyin) : s.buyin + ' ' + s.currency} × ${s.entries}`,
      s.cash ? (s.currency === 'USD' ? usd(s.cash) : s.cash + ' ' + s.currency) : '',
      s.currency === 'USD' ? signedUsd(s.net) : `${s.net} ${s.currency}`,
      s.likelyW2G ? 'W-2G?' : '',
    ]),
    { styles: { font: 'helvetica', fontSize: 7, cellPadding: 2 }, columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } });

  text('Sources', { size: 10, bold: true });
  for (const s of TAX_SOURCES) text(`${s.label} — ${s.url}`, { size: 7, color: [60, 60, 60], gap: 1 });

  const blob = doc.output('blob');
  await shareOrDownloadBlob(blob, `futuregame-tax-summary-${report.year}.pdf`, 'application/pdf');
}
