import React, { useEffect, useMemo, useState } from 'react';
import ThemeButton from './ThemeButton.jsx';
import GridOverlay from './GridOverlay.jsx';
import useThemeChoice from '../hooks/useThemeChoice.js';
import { API_URL } from '../utils/api.js';
import { campaignFrom, storeLink, webLink, liveFigures, captureLanding } from '../utils/live-page.js';
import './backer-page.css';
import './live-page.css';

/*
 * futurega.me/live: the live-only landing page the ads link to (launch plan, action 3; 2026-10-15).
 * The backer page's shell (its 37g column, top bar and theme button), so it sits on the app's grid.
 * Rules it keeps: no online room, no data source and no venue is named; 21+ and the helpline at the
 * foot; the App Store button carries the ad's campaign (?ct=), and a visitor on Android, whom
 * organic posts reach, is sent to the web app. Before the app is listed (no APP_STORE_ID on the
 * server) the page says when it arrives and offers the web app.
 */
const FEATURES = [
  ['Plan for bagging, plan for busting', 'Your if-bag and if-bust plans are ready before you sit down.'],
  ['Every flight side by side', 'Pick the day that fits the rest of your week.'],
  ['The clash, flagged first', 'Know two events overlap before you register for both.'],
  ['Bring the crew', 'See where your friends are playing. Send your week in one link.'],
  ['Every result, recorded', 'Your season, from the results you log.'],
];

export default function LivePage() {
  const theme = useThemeChoice({ followDevice: true });
  const ct = useMemo(() => campaignFrom(window.location.search), []);
  const android = useMemo(() => /Android/i.test(navigator.userAgent || ''), []);
  const [sum, setSum] = useState(null);
  useEffect(() => {
    captureLanding(window.location.search, document.referrer, '/live');
    let on = true;
    fetch(`${API_URL}/public/live-summary`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (on) setSum(d); }).catch(() => {});
    return () => { on = false; };
  }, [ct]);
  const store = !android && sum ? storeLink(sum.appStore, ct) : null;
  const fig = liveFigures(sum);
  // ?gridOverlay=1 shows the layout grid (the guards, and anyone checking alignment).
  const grid = useMemo(() => { try { return new URLSearchParams(window.location.search).get('gridOverlay') === '1'; } catch { return false; } }, []);
  return (
    <div className="app-shell bp-shell lp-shell">
      <header className="top-bar bp-top">
        <div className="top-bar-title">
          <h1>futurega.me</h1>
          <small>the poker calendar</small>
        </div>
        <div className="bp-top-actions">
          <ThemeButton theme={theme.theme} nextThemeLabel={theme.nextThemeLabel} onToggle={theme.toggleTheme} />
        </div>
      </header>
      <main className="content-area bp-content lp-content">
        <h2 className="an-cell lp-title">Your whole poker calendar.</h2>
        <p className="an-p lp-lede">
          Every live series near you, in each room's own time. It flags the clash before you register, keeps
          your backup for when you bust, and puts your results and your crew beside the plan.
        </p>

        <section className="lp-card" aria-label="The next 30 days">
          <div className="an-cell an-lbl an-lbl-3">The next 30 days</div>
          <div className="an-cell lp-figure">{fig.headline || ' '}</div>
          <div className="an-cell an-note an-clip">{fig.note || ' '}</div>
        </section>

        <ul className="lp-features">
          {FEATURES.map(([title, note]) => (
            <li key={title} className="lp-feature">
              <div className="an-cell lp-ft">{title}</div>
              <p className="an-p lp-fn">{note}</p>
            </li>
          ))}
        </ul>

        <div className="lp-ctas">
          {store && <a className="lp-cta ctl is-primary" href={store}>Download on the App Store</a>}
          <a className={'lp-cta ctl' + (store ? '' : ' is-primary')} href={webLink(ct)}>
            {android ? 'Open the web app' : 'Use it in your browser'}
          </a>
          {!store && !android && <p className="an-p lp-soon">On iPhone and iPad from 5 January.</p>}
        </div>

        <footer className="an-p lp-foot">
          {/* The launch plan's footer, word for word (section 11, "Lines that ship on every paid post"). */}
          futurega.me is a schedule, planner and record-keeping app. It takes no bets and offers no
          real-money play. Not affiliated with any casino or poker room. 21+. If gambling is a problem
          for you, call <span className="lp-nowrap">1-800-MY-RESET</span> (national)
          or <span className="lp-nowrap">1-800-GAMBLER</span> (New Jersey).
        </footer>
      </main>
      {grid && <GridOverlay showReadout={false} />}
    </div>
  );
}
