import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, lazy, Suspense, startTransition } from 'react';
import useBackToClose from './hooks/useBackToClose.js';
import { tabHash, viewFromHash } from './utils/tab-address.js';
import AppLockVeil from './components/AppLockVeil.jsx';
import { applyMoneyMask, installRevealOnHold } from './utils/hide-money.js';
import './components/features.css';
// Hide money (Features 44): the mask is this device's, set before the first paint of any figure.
applyMoneyMask();
installRevealOnHold();
import TabErrorBoundary from './components/TabErrorBoundary.jsx';
import useWordmarkFit from './hooks/useWordmarkFit.js';
import { balancesFromSummary } from './utils/bankrolls.js';
import AlternatingSubtitle from './components/AlternatingSubtitle.jsx';
import { createPortal } from 'react-dom';

import { API_URL } from './utils/api.js';
import { parseDeepLink } from './utils/deep-links.js';
import { resetPath } from './utils/reset-results.js';
import { initialName } from './utils/names.js';
import { haptic, SERIF_FONTS, SERIF_ORDER, VENUE_BRAND_VAR, formatSeasonLabel, registerRowTimezones, registerRowCurrencies, registerVenueCoords, getDebugNow, setDebugNow, normaliseDate, parseTournamentTime } from './utils/utils.js';
import { DNP_TYPE, withoutDnpMarkers } from './utils/didnt-play.js';
import { decodeHand } from './utils/hand-shorthand.js';
import { detectMilestones } from './utils/milestones.js';
import { moveDetailBlock, settleDetailBlock, detailBlockMoving, resizeDetailBlock } from './utils/detail-motion.js';
import usePullToRefresh from './hooks/usePullToRefresh.js';
import { APP_ADMIN_USERNAMES, tokenUsername, tokenUserId } from './utils/session-claims.js';
import { unitR } from './utils/grid-snap.js';

import { useToast } from './contexts/ToastContext.jsx';
import { DisplayNameProvider } from './contexts/DisplayNameContext.jsx';

import Icon from './components/Icon.jsx';
import ThemeButton from './components/ThemeButton.jsx';
import Avatar from './components/Avatar.jsx';
import FitName from './components/FitName.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import ForgotPasswordForm from './components/ForgotPasswordForm.jsx';
import ResetPasswordForm from './components/ResetPasswordForm.jsx';
import BottomNav from './components/BottomNav.jsx';
// Loaded on demand (2026-10-15): pages and panels most sessions never open, kept out of the main bundle.
const GridOverlay = lazy(() => import('./components/GridOverlay.jsx'));      // admins, with the grid on
const LivePage = lazy(() => import('./components/LivePage.jsx'));            // /live has its own entry; this is the fallback
const BackerPage = lazy(() => import('./components/BackerPage.jsx'));        // /b/<token> only
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard.jsx'));   // first run, or a re-run from Settings
import { noteReviewMoment } from './utils/review-prompt.js';
import { captureLanding } from './utils/live-page.js';
import DesktopRail from './components/DesktopRail.jsx';
import DesktopEventDetail from './components/DesktopEventDetail.jsx';
import useDesktopLayout from './hooks/useDesktopLayout.js';
import useBankrolls from './hooks/useBankrolls.js';
import useHomeLayout from './hooks/useHomeLayout.js';
import useThemeChoice from './hooks/useThemeChoice.js';
import DashboardView from './components/DashboardView.jsx';
import HandsScanner from './components/HandsScanner.jsx';
import TournamentsView from './components/TournamentsView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import CalendarView from './components/CalendarView.jsx';
import TrackingView from './components/TrackingView.jsx';
import SettingsView from './components/SettingsView.jsx';
import SocialView from './components/SocialView.jsx';
import LiveUpdatePanel from './components/LiveUpdatePanel.jsx';
import { LiveCashBar } from './components/CashLive.jsx';
import BankrollFab from './components/BankrollFab.jsx';
import SharedScheduleView from './components/SharedScheduleView.jsx';
import { backerTokenFromPath } from './utils/backer-page.js';
import SkeletonDashboard from './components/SkeletonDashboard.jsx';
import SkeletonSchedule from './components/SkeletonSchedule.jsx';
import RealNamePrompt from './components/RealNamePrompt.jsx';
import { hasOnboarded, markOnboarded, clearOnboarded, readLocalLocation, readLocalFilters, migrateLiveOnlyDefaults, pushServerLocation } from './utils/location-prefs.js';
import { fetchServerOnboarding, adoptServerOnboarding, pushServerOnboarding, wizardSubset } from './utils/onboarding.js';
import NotificationsPanel from './components/NotificationsPanel.jsx';
import SwapModal from './components/SwapModal.jsx';
import MilestoneCelebration from './components/MilestoneCelebration.jsx';

// Code-split the heaviest views (the replayer alone is over 10k lines) so the main
// bundle drops by several hundred KB. Each loads on first navigation to
// its tab; subsequent visits are cached by the browser.
const HandReplayerView = lazy(() => import('./components/HandReplayerView.jsx'));
const StudyHub = lazy(() => import('./components/StudyHub.jsx'));
const StakingView = lazy(() => import('./components/StakingView.jsx'));
const AdminView = lazy(() => import('./components/AdminView.jsx'));
// The Features catalogue's sheets (2026-11-11): loaded when first opened.
const ReportProblemSheet = lazy(() => import('./components/ReportProblemSheet.jsx'));
const AtTableSheet = lazy(() => import('./components/AtTableSheet.jsx'));
const SearchEverything = lazy(() => import('./components/SearchEverything.jsx'));
const TaxReportViewLazy = lazy(() => import('./components/TaxReportView.jsx'));
const PackagePageLazy = lazy(() => import('./components/Packages.jsx').then((m) => ({ default: m.PackagePage })));
const AdminBatchesView = lazy(() => import('./components/AdminBatchesView.jsx'));
const CashView = lazy(() => import('./components/CashView.jsx'));
// Edit home: the sheet that chooses and orders the Dashboard's sections, loaded when first opened.
const HomeEditSheet = lazy(() => import('./components/HomeEditSheet.jsx'));

const LazyFallback = () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'calc(var(--gu) * 1.252)'}}>Loading…</div>;

// A backer's private page: /b/<token> (the server's BACKER_TOKEN_RE). Rendered by Root below,
// before App: a backer has no account, so none of App's session, onboarding, nav or rail applies.
const BACKER_TOKEN = backerTokenFromPath(window.location.pathname);

// Detect shared schedule URL: /shared/:token
const SHARED_MATCH = window.location.pathname.match(/^\/shared\/([a-f0-9]+)$/);
const SHARED_TOKEN = SHARED_MATCH ? SHARED_MATCH[1] : null;

// Detect password reset URL: /#reset?token=<hex>
const RESET_MATCH = window.location.hash.match(/^#reset\?token=([a-f0-9]{64})$/);
const RESET_TOKEN = RESET_MATCH ? RESET_MATCH[1] : null;

// Detect shared hand URL: /#h/ENCODED_STRING
const HAND_MATCH = window.location.hash.match(/^#h\/(.+)$/);
// A deep link (docs/bankroll-merge.md §11.5): #bankroll/<tab>, #results/…, #staking/standing, #tax.
// Read at load; acted on once an admin is signed in (utils/deep-links.js), then cleared.
const DEEP_LINK_AT_LOAD = parseDeepLink(window.location.hash);
const HAND_SHORTHAND = HAND_MATCH ? decodeURIComponent(HAND_MATCH[1]) : null;

// Server-backed short link: /h/<id>. Unlike the self-contained #h/ fragment, this
// needs a fetch to resolve, handled in an effect below.
const PATH_HAND_MATCH = window.location.pathname.match(/^\/h\/([A-Za-z0-9]{1,16})$/);
const PATH_HAND_ID = PATH_HAND_MATCH ? PATH_HAND_MATCH[1] : null;

// An invite link, /i/<token> (Features 37): kept for this tab until it is used, so a sign-in or a
// sign-up started from it still carries it.
const TAX_LINK_MATCH = window.location.pathname.match(/^\/t\/([A-Za-z0-9_-]{10,40})$/);
const TAX_LINK_TOKEN = TAX_LINK_MATCH ? TAX_LINK_MATCH[1] : null;
const PACKAGE_MATCH = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{10,40})$/);
const PACKAGE_TOKEN = PACKAGE_MATCH ? PACKAGE_MATCH[1] : null;
const INVITE_PATH_MATCH = window.location.pathname.match(/^\/i\/([A-Za-z0-9_-]{6,40})$/);
if (INVITE_PATH_MATCH) { try { sessionStorage.setItem('pendingInvite', INVITE_PATH_MATCH[1]); } catch { /* storage off */ } }
const pendingInvite = () => { try { return sessionStorage.getItem('pendingInvite'); } catch { return null; } };
const clearInvite = () => { try { sessionStorage.removeItem('pendingInvite'); } catch { /* storage off */ } };
// Which device a sign-in is from, for Settings' list of devices (Features 42). The web is told by its browser.
const DEVICE_HINT = (() => {
  const C = window.Capacitor;
  if (!(C && C.isNativePlatform && C.isNativePlatform())) return undefined;
  const ua = navigator.userAgent || '';
  if (/Macintosh/.test(ua)) return 'Mac app';
  if (/iPad/.test(ua)) return 'iPad app';
  if (/Android/.test(ua)) return 'Android app';
  return 'iPhone app';
})();

// Detect notification deep link: /?find=<query> — a new-series push tap lands on the calendar
// with this query applied (web push opens the URL; the native tap listener parses the same form).
const FIND_MATCH = window.location.search.match(/[?&]find=([^&]*)/);
const FIND_PARAM = FIND_MATCH ? decodeURIComponent(FIND_MATCH[1].replace(/\+/g, ' ')) : null;
// /?view=calendar — a notification that concerns many events (feed sync) opens the calendar
// without a search. Only 'calendar' is honored; anything else falls through to the default view.
const VIEW_MATCH = window.location.search.match(/[?&]view=([a-z]+)/);
const VIEW_PARAM = VIEW_MATCH ? VIEW_MATCH[1] : null;
// /?batch=<id> — an admin alert's own list of what it added (server: admin_batches). Admin-only:
// for anyone else the param is dropped without effect (the API refuses them anyway).
const batchIdFrom = (s) => { const m = String(s || '').match(/[?&]batch=(\d{1,9})(?:&|$)/); return m ? Number(m[1]) : null; };
const BATCH_PARAM = batchIdFrom(window.location.search);

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Schedule pressed again (the bottom nav, or the rail on desktop): the list back on today, landed
// exactly where its own first landing puts it (TournamentsView scrollDateGroupToTop, the same
// formula): today's group top on the sticky filters' bottom, so its date break sits flush under
// them. The smooth scroll passes rows leaving their 13r content-visibility placeholders, which can
// move today while it runs, so once the scroll has come to rest the list lands again on the same
// formula, at once. (The follow-up used to put the first card 2px below the sticky stack instead,
// which left the list about 0.3r short of the stop.) Anything the user does meanwhile (a wheel, a
// touch, a click, a key) is theirs: the landing is dropped.
function landListOnToday() {
  const c = document.querySelector('.content-area');
  const panel = c && c.querySelector('.tab-panel[data-tab="tournaments"]');
  if (!panel || !panel.querySelector('[data-today-scroll]')) return;
  const target = () => {
    const group = panel.querySelector('[data-today-scroll]');
    if (!group) return null;
    const filters = panel.querySelector('.sticky-filters');
    const filtersH = filters ? filters.getBoundingClientRect().height : 0;
    const groupAbsTop = group.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
    return Math.max(0, groupAbsTop - filtersH);
  };
  c.scrollTo({ top: target(), behavior: 'smooth' });
  const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  let dropped = false;
  const drop = () => { dropped = true; };
  inputs.forEach(ev => c.addEventListener(ev, drop, { passive: true }));
  // At rest: three frames without movement, once it has moved (or a dozen frames if it never
  // needed to); at most three seconds.
  let last = c.scrollTop, still = 0, moved = false, frames = 0;
  const tick = () => {
    const now = c.scrollTop;
    if (now !== last) { moved = true; still = 0; } else still++;
    last = now; frames++;
    if (!dropped && frames < 180 && (still < 3 || (!moved && frames < 12))) { requestAnimationFrame(tick); return; }
    inputs.forEach(ev => c.removeEventListener(ev, drop));
    const top = dropped ? null : target();
    if (top != null) c.scrollTop = top;
  };
  requestAnimationFrame(tick);
}

// My Schedule on its next event (or at its top when nothing is coming up), in ITS OWN scroller:
// the phone's My Schedule tab in .content-area, or the desktop's right pane (.dk-mine-block, a
// .dk-scroll), where the Schedule list's scroller is a different element and is never touched.
// The header counts by where its bottom sits once STUCK (its sticky top + its height), not where
// it sits in flow right now: that over-counted and landed the next event 26px low (ScheduleView).
function landMySchedule() {
  const panel = document.querySelector('.dk-mine-block')
    || document.querySelector('.content-area .tab-panel[data-tab="schedule"]');
  const c = panel && panel.closest('.content-area, .dk-scroll');
  if (!c) return;
  const todayEl = panel.querySelector('[data-today-scroll]');
  if (!todayEl) { c.scrollTop = 0; return; }
  const sticky = panel.querySelector('.schedule-sticky-header');
  const stickyH = sticky ? Math.max(0, (parseFloat(getComputedStyle(sticky).top) || 0) + sticky.getBoundingClientRect().height) : 0;
  const groupAbsTop = todayEl.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
  c.scrollTop = Math.max(0, groupAbsTop - stickyH);
}

// Before any view reads the saved filters: a browser that used the app before keeps its online
// choices when the live-only defaults arrive (utils/location-prefs.js).
migrateLiveOnlyDefaults();
// How this browser first arrived, from any page with a campaign tag or another site's link (growth).
captureLanding(window.location.search, document.referrer, window.location.pathname);

/* Where a sign-up came from (launch plan, growth measurement): the first touch this browser kept
   (the landing page's ?ct=, utils/live-page.js), the web app's ?src=, the platform and the form's
   "How did you hear about us?". The server keeps only fields it recognises (lib/growth.js). */
function signupSource(heard) {
  let first = {};
  try { first = JSON.parse(localStorage.getItem('acqSource') || '{}') || {}; } catch { first = {}; }
  let src = null;
  try { src = new URLSearchParams(window.location.search).get('src'); } catch { src = null; }
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const platform = native ? (window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'ios') : 'web';
  return {
    ct: first.ct || undefined, landing: first.landing || undefined, ref: first.ref || undefined, src: src || first.src || undefined,
    utm_source: first.utm_source, utm_medium: first.utm_medium, utm_campaign: first.utm_campaign, utm_content: first.utm_content,
    heard: heard || undefined, platform,
  };
}

const EVENT_EDITOR_USERNAMES = ['ham', 'ham5'];          // mirrors the server's write allowlist

// debugNow (utils.js) is the admin-only simulated clock. It lives in localStorage and getNow()
// honours it for whoever is signed in, so a value an admin left behind (or anyone typed in)
// shifted every date in the app for a normal user. Drop it before the first render unless the
// stored session is an admin's; the effect in App covers sign-in/out without a reload.
try {
  const bootToken = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (getDebugNow() && !APP_ADMIN_USERNAMES.includes(tokenUsername(bootToken))) setDebugNow('');
} catch { /* storage unavailable — nothing persisted to clear */ }

const GUEST_PICKS_KEY = 'guestPicks';
const GUEST_PLAN_NOTE = 'Create an account to keep plans like this. Your saved events stay on this device.';
function readGuestPicks() {
  try {
    const v = JSON.parse(localStorage.getItem(GUEST_PICKS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(Number.isFinite) : [];
  } catch { return []; }
}
/* A guest who finished ('1') or skipped ('skipped') setup on this device (OnboardingWizard writes
   it); the answers themselves are this device's (location-prefs). */
function guestSetupState() {
  try { return localStorage.getItem('guestSetup'); } catch { return null; }
}
// Setup's code, fetched while Create Account is filled in, so it opens the moment the account exists.
const prefetchSetup = () => { import('./components/OnboardingWizard.jsx').catch(() => {}); };

function writeGuestPicks(ids) {
  try { localStorage.setItem(GUEST_PICKS_KEY, JSON.stringify(ids)); } catch { /* storage off: this visit only */ }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || sessionStorage.getItem('token'));
  // The signed token's own username claim (utils/session-claims.js), read once per token.
  const authUsername = useMemo(() => tokenUsername(token), [token]);
  const [username, setUsername] = useState(localStorage.getItem('username') || sessionStorage.getItem('username'));
  const [isGuest, setIsGuest] = useState(localStorage.getItem('isGuest') === 'true');
  const [authView, setAuthView] = useState(() => (INVITE_PATH_MATCH ? 'register' : 'login'));
  const [authBusy, setAuthBusy] = useState(false);       // Sign In / Create Account answered at once (UX pick 8)
  const [forgotEmail, setForgotEmail] = useState('');    // Sign In's address, carried to Forgot (UX pick 14)
  // A tab's address opens it (App improvements 453): a reload, or a Home Screen relaunch, keeps the tab.
  const [currentView, _setCurrentView] = useState(() => viewFromHash(window.location.hash) || 'dashboard');
  // The tab tapped, lit before its view renders (UX pick 46); cleared once the view is there.
  const [navPending, setNavPending] = useState(null);
  useEffect(() => { setNavPending(null); }, [currentView]);
  // Set when the dashboard's Up Next card is tapped; ScheduleView consumes it
  // to expand and scroll to that row, then clears it so a later visit to the
  // schedule does not re-focus the same event.
  const [scheduleFocusId, setScheduleFocusId] = useState(null);
  const clearScheduleFocus = useCallback(() => setScheduleFocusId(null), []);
  // Set by a notification deep link (/?find=…); CalendarView consumes it to apply the search
  // and jump to the first matching day, then clears it — same idiom as scheduleFocusId.
  const [calendarFind, setCalendarFind] = useState(null);
  const clearCalendarFind = useCallback(() => setCalendarFind(null), []);
  // The admin batch on show in the 'batches' view (null = the newest).
  const [batchId, setBatchId] = useState(null);
  const tapListenerArmed = useRef(false); // the push effect re-runs on token changes; arm once
  const [viewKey, setViewKey] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['dashboard', viewFromHash(window.location.hash) || 'dashboard']));
  const scrollPositions = useRef({});
  // Desktop only (docs/desktop-layout.md): there My Schedule is not a view but the right pane of
  // the Schedule tab. Set by the desktop block below to what showing it takes; null on the phone.
  const dkShowMine = useRef(null);
  const toast = useToast();

  const setCurrentView = useCallback((v) => {
    // Going to My Schedule on desktop is going to the Schedule tab, whose right pane holds it. The
    // list then takes the phone's own tab-change path below (it keeps its place, or gets back the
    // place it was left at, else today), as the phone's list does on its way back from My
    // Schedule, instead of being scrolled for a My Schedule panel it does not show.
    if (v === 'schedule' && dkShowMine.current) { dkShowMine.current(); v = 'tournaments'; }
    _setCurrentView(prev => {
      if (v !== prev) {
        const container = document.querySelector('.content-area');
        if (container) scrollPositions.current[prev] = container.scrollTop;
        setVisitedTabs(s => { const n = new Set(s); n.add(v); return n; });
        // The scroll comes back once the new tab is COMMITTED (the layout effect on currentView
        // below), not on the next frame: a tab press is a transition (UX pick 46), and a slow one
        // committed after that frame, so the place was set on the old tab and clamped to its height.
        pendingScroll.current = v;
      }
      return v;
    });
  }, []);
  const pendingScroll = useRef(null);
  const restoreTabScroll = useCallback((v) => {
        {
          const c = document.querySelector('.content-area');
          if (c && v === 'schedule') {
            landMySchedule();
          } else if (c && scrollPositions.current[v] != null) {
            c.scrollTop = scrollPositions.current[v];
          } else if (v === 'tournaments' && c) {
            const todayEl = c.querySelector('[data-today-scroll]');
            if (todayEl) {
              const filters = c.querySelector('.sticky-filters');
              const filtersH = filters ? filters.getBoundingClientRect().bottom - c.getBoundingClientRect().top : 0;
              const groupAbsTop = todayEl.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
              c.scrollTop = Math.max(0, groupAbsTop - filtersH);
            }
          } else if (c) {
            // A tab opened for the first time starts at its top (App improvements 471: Bankroll opened at its foot,
            // in the scroll the Schedule left).
            c.scrollTop = 0;
          }
          const panel = c && c.querySelector('.tab-panel.tab-active');
          if (panel) {
            panel.style.animation = 'none';
            panel.offsetHeight;
            panel.style.animation = '';
          }
        }
  }, []);
  useLayoutEffect(() => {
    const v = pendingScroll.current;
    if (!v || v !== currentView) return;
    pendingScroll.current = null;
    restoreTabScroll(v);
  }, [currentView, restoreTabScroll]);

  const [tournaments, setTournaments] = useState([]);
  // Header subtitle — the months the loaded feed actually spans, so it tracks
  // the window instead of naming a season that goes stale.
  const seasonLabel = useMemo(() => formatSeasonLabel(tournaments), [tournaments]);
  const [mySchedule, setMySchedule] = useState([]);
  // A guest's saved events stay on this device (owner, 2026-11-10): every guest token is the same
  // id 0, so a list on the server would be every guest's at once. Ids only; the rows come from the
  // schedule itself.
  const [guestPicks, setGuestPicks] = useState(readGuestPicks);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [debugTimeKey, setDebugTimeKey] = useState(0);

  // Avatar
  const [avatar, setAvatar] = useState(localStorage.getItem('avatar') || null);

  // Hand replayer access
  const [handReplayerAccess, setHandReplayerAccess] = useState(localStorage.getItem('handReplayerAccess') === 'true');

  // Hands tab tool: hand replayer or CFR solver trainer
  const [handsTool, setHandsTool] = useState('replayer');
  // Hands > Study: which tool is open (null is its list), and a request to open the drill on the replayer.
  const [studyTool, setStudyTool] = useState(null);
  const [drillAsk, setDrillAsk] = useState(false);
  // Play a hand opened from Study: Study stays lit and the drill's Back returns there (App improvements 304).
  const [drillFromStudy, setDrillFromStudy] = useState(false);
  // Set by the replayer's "Study this draw" button and consumed by
  // DrawStudyView on mount, mirroring pendingSolverSpot.
  const [pendingDrawSpot, setPendingDrawSpot] = useState(null);

  // "Solve this spot" handoff: a frozen replayer spot, mapped to
  // SolverView's inputs. Set by the replayer's Solve-this-spot button
  // (which also opens Study's Solve a spot); consumed + cleared by
  // SolverView on mount/update.
  const [pendingSolverSpot, setPendingSolverSpot] = useState(null);

  // Cash tab's Live / Heatmaps mode, for the top bar's subtitle. CashView owns and persists
  // it ('cashMode'); this reads the same key so the first paint is already right.
  const [cashMode, setCashMode] = useState(() => { try { return localStorage.getItem('cashMode') || 'live'; } catch { return 'live'; } });
  // The top bar's wordmark, fitted to exactly 8g in every theme and face (hooks/useWordmarkFit.js).
  const wordmarkRef = useRef(null);
  useWordmarkFit(wordmarkRef);

  // Shared hand from URL hash
  const [sharedHandData, setSharedHandData] = useState(() => {
    if (HAND_SHORTHAND) {
      try {
        const decoded = decodeHand(HAND_SHORTHAND);
        if (decoded) {
          if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname + window.location.search);
          return decoded;
        }
      } catch (e) { console.error('Failed to decode shared hand:', e); }
    }
    return null;
  });

  // Real name / display name
  const [realName, setRealName] = useState(localStorage.getItem('realName') || null);
  const [showRealNamePrompt, setShowRealNamePrompt] = useState(false);
  // Settings' "Edit name": the same prompt, opened on the current name.
  const [editingName, setEditingName] = useState(false);
  /* First-run setup (OnboardingWizard, docs/onboarding.md). Opens once per ACCOUNT: the server's
     users.onboarding says whether this account has finished or skipped it, and
     localStorage.onboarded is only this browser's cache of that answer. A sign-in hands its record
     over in onboardingRec (undefined: the server said nothing — an older server — so the old
     per-browser rule decides). Re-openable from the location menu ('reopen-onboarding'), which
     bypasses all of it and pre-fills from the current filters. */
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingFirstRun, setOnboardingFirstRun] = useState(true);
  const onboardingRec = useRef(undefined);
  useEffect(() => {
    if (!token || hasOnboarded()) return undefined;
    const open = () => { setOnboardingFirstRun(true); setShowOnboarding(true); };
    const nothingSaved = () => !readLocalLocation() && !readLocalFilters();
    // A guest's answers stay on this device: the old rule, now for guests too.
    if (isGuest) { if (nothingSaved()) open(); return undefined; }
    let cancelled = false;
    const handed = onboardingRec.current;
    onboardingRec.current = undefined;
    (handed !== undefined ? Promise.resolve(handed) : fetchServerOnboarding(token)).then(rec => {
      if (cancelled || hasOnboarded()) return;
      if (rec) { adoptServerOnboarding(rec); markOnboarded(); return; }
      if (rec === null || nothingSaved()) open();
    });
    return () => { cancelled = true; };
  }, [token, isGuest]);
  useEffect(() => {
    const reopen = () => { setOnboardingFirstRun(false); setShowOnboarding(true); };
    window.addEventListener('reopen-onboarding', reopen);
    return () => window.removeEventListener('reopen-onboarding', reopen);
  }, []);
  const [nameMode, setNameMode] = useState(localStorage.getItem('displayNameMode') || 'real');
  const displayName = useCallback((user) => {
    if (nameMode === 'username') return user.username;
    return user.real_name || user.username;
  }, [nameMode]);

  // Sharing state
  const [shareToken, setShareToken] = useState(null);
  const [shareBuddies, setShareBuddies] = useState([]);
  const [pendingIncoming, setPendingIncoming] = useState([]);
  const [pendingOutgoing, setPendingOutgoing] = useState([]);
  const [buddyEvents, setBuddyEvents] = useState({});
  const [swapModalData, setSwapModalData] = useState(null);
  const onBuddySwap = useCallback((buddy, tournament) => setSwapModalData({ buddy, tournament }), []);

  // Tracking
  const [trackingData, setTrackingData] = useState([]);
  // Whether the results have answered (Bankroll design 46, 97): the list never says "log your first
  // result" before it knows, and a failed load says so.
  const [trackingState, setTrackingState] = useState('loading');
  // A form or entry in Results that the home asked for (its Log menu, To log's Cashed, the Last
  // result card): { kind, ... } — TrackingView opens it once and clears it (onIntentDone).
  const [resultsIntent, setResultsIntent] = useState(null);
  const clearResultsIntent = useCallback(() => setResultsIntent(null), []);
  // Show Results with a form open (the home's Log menu and To log, the bankroll tab's floating +
  // and the bankroll dashboard sheet's): the intent is set first, TrackingView opens it once.
  const logIntoResults = useCallback((intent) => {
    setResultsIntent({ ...intent, at: Date.now() });
    setCurrentView('tracking');
  }, [setCurrentView]);

  // Live Updates
  const [myActiveUpdates, setMyActiveUpdates] = useState([]);
  const [buddyLiveUpdates, setBuddyLiveUpdates] = useState({});

  // Groups
  const [myGroups, setMyGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  // The open group, for the live listeners (App improvements 351, 352): an event for another group must not land
  // in the open one's feed.
  const activeGroupRef = useRef(null);
  activeGroupRef.current = activeGroupId;
  const [groupFeed, setGroupFeed] = useState([]);
  const [groupSchedule, setGroupSchedule] = useState([]);

  // Notifications
  const [notifications, setNotifications] = useState({ groupInvites: [], buddyRequests: [], acceptedBuddies: [] });
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Features 36, 37, 38, 48 (2026-11-11).
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const hiddenRef = useRef(hiddenIds);
  hiddenRef.current = hiddenIds;
  const [socialFocus, setSocialFocus] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [showAtTable, setShowAtTable] = useState(false);
  // Desktop: one search box for everything (Features 49), ⌘K / Ctrl+K, or / outside a field.
  const [showSearch, setShowSearch] = useState(false);
  // Back closes these first (App improvements 454).
  useBackToClose(showNotifications, () => setShowNotifications(false));
  useBackToClose(showUserMenu, () => setShowUserMenu(false));

  // Milestones
  const [activeMilestone, setActiveMilestone] = useState(null);

  // Theme
  // The Swiss themes are admin-only (utils/theme.js); the signed token's name says who is one.
  const { theme, toggleTheme, setTheme: pickTheme, nextThemeLabel } = useThemeChoice({ admin: APP_ADMIN_USERNAMES.includes(authUsername) });
  const [contrast, setContrast] = useState(localStorage.getItem('contrast') || 'normal');
  const [cardSplay] = useState(localStorage.getItem('cardSplay') !== 'off');
  // Admin-only layout-grid overlay for checking alignment (GridOverlay.jsx).
  const [gridOverlay, setGridOverlay] = useState(() => {
    // ?gridOverlay=1 forces it on so it can be activated in the native WKWebView
    // without a JS console (the sim can't drive Safari's inspector). The admin
    // '#' toggle still works and persists to localStorage.
    try {
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('gridOverlay') === '1') return true;
    } catch { /* URLSearchParams unavailable — fall through to storage */ }
    return localStorage.getItem('gridOverlay') === 'on';
  });
  // Admin-only demo-states toggle: injects representative playing / busted /
  // expanded-stats cards and demo friends into the Dashboard so the grid overlay
  // can measure conditional UI that Ethan's real (all-future, empty) data never
  // renders. Tap-activated (the native WKWebView can't set a URL param or
  // localStorage), never persisted — off on every load.
  const [demoStates, setDemoStates] = useState(false);
  // The grid overlay's live numeric readout (the cyan box) can be switched off on
  // its own, leaving the grid lines. Persists; on by default, as it always was.
  const [gridReadout, setGridReadout] = useState(() => localStorage.getItem('gridReadout') !== 'off');
  // 'bahnschrift' was retired as a display-font option; anyone still holding it
  // in localStorage lands back on the default rather than an unstyled data-serif.
  const [serifFont, setSerifFont] = useState(() => {
    const stored = localStorage.getItem('serifFont');
    return SERIF_FONTS.includes(stored) ? stored : 'baskerville';
  });

  // The theme (and the data-theme, theme-color and status bar it drives) is hooks/useThemeChoice.js,
  // shared with the backer page's top bar.

  useEffect(() => {
    document.documentElement.dataset.contrast = contrast;
    localStorage.setItem('contrast', contrast);
  }, [contrast]);

  useEffect(() => {
    document.documentElement.dataset.serif = serifFont === 'baskerville' ? '' : serifFont;
    localStorage.setItem('serifFont', serifFont);
  }, [serifFont]);

  // Mirror the header subtitle into localStorage so the pre-boot splash in
  // index.html can show the same span. The splash paints before React mounts
  // and before any fetch, so it cannot compute this itself — it shows the
  // previous run's label, which is right except on a first-ever load (falls
  // back to the static wording) and on the day the window rolls to a new
  // month, where it is one visit stale. Skip '' so a load that fetched
  // nothing doesn't wipe a good label.
  useEffect(() => {
    if (!seasonLabel) return;
    localStorage.setItem('seasonLabel', seasonLabel);
    // Retitle here as well as in the bootstrap: on a first-ever load there was
    // no stored label to title with, and the tab would otherwise sit on the
    // static wording for the whole session.
    document.title = `futurega.me | ${seasonLabel}`;
  }, [seasonLabel]);

  // Measure the bottom nav's actual top edge and expose it as
  // --measured-nav-top (px from viewport bottom). CSS env() and var()
  // expressions for the same formula resolved to different numbers in
  // some WebView contexts (notably iOS Capacitor with contentInset:
  // 'never') — measuring the real DOM rectangle removes that ambiguity
  // so the replayer bar can sit flush with the nav guaranteed.
  useEffect(() => {
    const update = () => {
      const nav = document.querySelector('.bottom-nav');
      if (!nav) return;
      const r = nav.getBoundingClientRect();
      const fromBottom = Math.max(0, window.innerHeight - r.top);
      document.documentElement.style.setProperty('--measured-nav-top', fromBottom + 'px');
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  /* The replayer is admin-only, and a shared #h/ link is the one way anybody
     else gets to see a hand. But the replayer CONSUMES initialHand and calls
     onClearInitialHand, which set sharedHandData back to null — and the tab is
     gated on `isAdmin || sharedHandData`, so the table rendered, cleared
     itself, and the visitor was left looking at "Coming Soon". Every share
     link this feature has ever produced has been broken for its audience.

     The gate needs to remember that a hand ARRIVED, which is not the same
     question as whether it is still waiting to be handed over. */
  const [sharedHandArrived, setSharedHandArrived] = useState(!!HAND_SHORTHAND || !!PATH_HAND_ID);

  // If a shared hand was decoded, switch to hands tab on mount
  useEffect(() => {
    if (sharedHandData) setCurrentView('hands');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sharedPathShown = useRef(false);
  // Resolve a /h/<id> short link: fetch the stored hand, decode, and open it.
  // (The #h/ fragment above is decoded synchronously; this one needs the server.)
  // A link that does not open says so (App improvements 155): it read "Loading…" for ever.
  const [sharedHandError, setSharedHandError] = useState(false);
  // A question link (Features 27): the hand to the hero's decision until this viewer answers.
  const [sharedQuestion, setSharedQuestion] = useState(null);
  const linkHeaders = () => {
    const h = {};
    try { const d = localStorage.getItem('deviceId'); if (d) h['X-Device-Id'] = d; } catch { /* storage off */ }
    const t = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (t && localStorage.getItem('isGuest') !== 'true') h.Authorization = 'Bearer ' + t;
    return h;
  };
  const onSharedQuestionAnswered = useCallback(() => {
    if (!PATH_HAND_ID) return;
    fetch(`${API_URL}/hand-links/${PATH_HAND_ID}`, { headers: linkHeaders() }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !d.shorthand) return;
      const full = decodeHand(d.shorthand);
      if (full) setSharedHandData(full);
      setSharedQuestion(d.question ? { linkId: PATH_HAND_ID, answered: !!d.answered, tally: d.tally || null } : null);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!PATH_HAND_ID) return;
    const failed = () => {
      setSharedHandError(true);
      if (token) toast.error("This hand link doesn't open. It may have been copied wrong, or the hand is no longer shared.");
    };
    fetch(`${API_URL}/hand-links/${PATH_HAND_ID}`, { headers: linkHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.shorthand) { failed(); return; }
        const decoded = decodeHand(d.shorthand);
        if (!decoded) { failed(); return; }
        if (d.question) setSharedQuestion({ linkId: PATH_HAND_ID, answered: !!d.answered, tally: d.tally || null });
        setSharedHandData(decoded);
        setSharedHandArrived(true);
        setCurrentView('hands');
        // The /h/<id> address stays while the hand is open (it used to be replaced with '/'
        // right here), so sharing the page from the browser, or reloading it, keeps the hand and
        // its preview title instead of the bare site with the season title. It goes back to '/'
        // when the shared hand is closed — the effect below.
        sharedPathShown.current = true;
      })
      .catch(failed);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sharedHandData || !sharedPathShown.current) return;
    if (/^\/h\//.test(window.location.pathname) && window.history.replaceState) window.history.replaceState(null, '', '/');
    sharedPathShown.current = false;
  }, [sharedHandData]);

  // The tab's address follows the tab (App improvements 453): a tab pressed pushes a step, any other change replaces
  // the address; Back and Forward move between tabs. Not while a reset or hand link is being read.
  const navPushRef = useRef(false);
  useEffect(() => {
    const push = navPushRef.current;
    navPushRef.current = false;
    if (!token || RESET_MATCH || HAND_MATCH || PATH_HAND_ID) return;
    const want = tabHash(currentView);
    if (!want || window.location.hash === want) return;
    try {
      if (push) window.history.pushState({ tab: currentView }, '', want);
      else window.history.replaceState({ tab: currentView }, '', want);
    } catch (_) { /* a sandboxed frame */ }
  }, [currentView, token]);
  useEffect(() => {
    const onPop = () => {
      const v = viewFromHash(window.location.hash);
      if (v) { setVisitedTabs(prev => (prev.has(v) ? prev : new Set([...prev, v]))); _setCurrentView(v); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Deep links (§11.5): the pending one waits for an admin sign-in, then opens its view once.
  const [deepLink, setDeepLink] = useState(DEEP_LINK_AT_LOAD);

  // Listen for hashchange to handle #h/ hand links without full reload
  useEffect(() => {
    const onHashChange = () => {
      const dl = parseDeepLink(window.location.hash);
      if (dl) { setDeepLink({ ...dl, at: Date.now() }); return; }
      const m = window.location.hash.match(/^#h\/(.+)$/);
      if (m) {
        try {
          const shorthand = decodeURIComponent(m[1]);
          const decoded = decodeHand(shorthand);
          if (decoded) {
            setSharedHandData(decoded);
            setSharedHandArrived(true);   // the gate has to open for this one too
            setCurrentView('hands');
            if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        } catch (e) { console.error('Failed to decode shared hand from hashchange:', e); }
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setCurrentView]);

  const toggleContrast = () => setContrast(c => c === 'normal' ? 'high' : 'normal');

  // ── Auto-logout on 401/403 ──
  const guardedFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    if (res.status === 401 || res.status === 403) {
      // The whole session goes, as Sign out does (App improvements 401: a guest's flag survived and the next real
      // sign-in opened in guest mode).
      ['token', 'username', 'avatar', 'isGuest', 'realName', 'sessionOnly'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
      setIsGuest(false);
      setToken(null);
      setUsername('');
      return null;
    }
    return res;
  };

  // ── Venue colors ──
  const applyVenueColors = (colors) => {
    for (const [abbr, color] of Object.entries(colors)) {
      let cssVar = VENUE_BRAND_VAR[abbr];
      if (!cssVar) {
        cssVar = `--venue-${abbr.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
        VENUE_BRAND_VAR[abbr] = cssVar;
      }
      document.documentElement.style.setProperty(cssVar, color);
    }
  };

  const fetchVenueColors = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/venue-colors`);
      if (!res) return;
      const colors = await res.json();
      applyVenueColors(colors);
    } catch (e) { /* ignore */ }
  };

  // ── Data fetching ──
  /* The list's load (App improvements 5, 6): 'ok' or 'failed', with when it last loaded, so the Schedule tells
     a failed request from an empty schedule and from filters, and a failed refresh keeps the list on screen. */
  const [listLoad, setListLoad] = useState({ status: 'ok', at: null });
  const fetchTournaments = async () => {
    try {
      // Venue coordinates ride alongside: the location filters run the moment the list lands,
      // so they must be registered first. Plain fetch — the route is public, and a failure
      // here costs only the server-placed venues, never the list (or the session).
      const coordsP = fetch(`${API_URL}/venue-coords`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const res = await guardedFetch(`${API_URL}/tournaments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('not a list');
      registerVenueCoords(await coordsP);
      // Before render: every start time and zone label reads the zone the row declares, and every
      // amount the currency it declares.
      registerRowTimezones(Array.isArray(data) ? data : []);
      registerRowCurrencies(Array.isArray(data) ? data : []);
      setTournaments(data);
      setListLoad({ status: 'ok', at: Date.now() });
    } catch (e) {
      console.error('Fetch tournaments:', e);
      // Whatever is on screen stays; one toast says what happened.
      setListLoad((l) => {
        const at = l.at ? new Date(l.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
        toast.error(at ? `Couldn't refresh. Showing the schedule from ${at}.` : "Couldn't load the schedule. Check the connection and try again.");
        return { status: 'failed', at: l.at };
      });
    }
  };

  // The schedule every screen but Results shows: the no-venue Didn't play markers stay off the
  // Schedule, the Calendar, the home, staking and the exports (utils/didnt-play.js).
  const scheduleShown = useMemo(() => withoutDnpMarkers(mySchedule), [mySchedule]);
  // The view switch's "My schedule · N" (UX picks 20, 95): events, not travel days or restarts.
  const mineCount = useMemo(() => scheduleShown.filter(t => t.venue !== 'Personal' && !t.is_restart).length, [scheduleShown]);
  const switchScheduleView = useCallback((v) => {
    setCurrentView(v);
    if (v === 'schedule') requestAnimationFrame(() => landMySchedule());
  }, []);
  const fetchMySchedule = async () => {
    if (isGuest) return;
    try {
      const res = await guardedFetch(`${API_URL}/my-schedule`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
      // The saved rows carry their own zone and currency: registered here too, so a plan keeps its times when
      // the event list fails to load (App improvements 51).
      if (Array.isArray(data)) { registerRowTimezones(data); registerRowCurrencies(data); }
      setMySchedule(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch schedule:', e); setMySchedule([]); }
  };

  useEffect(() => {
    if (!isGuest) return;
    const ids = new Set(guestPicks);
    setMySchedule(tournaments.filter(t => ids.has(t.id)));
  }, [isGuest, guestPicks, tournaments]);

  const fetchTracking = async () => {
    try {
      const res = await fetch(`${API_URL}/tracking`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setTrackingData(Array.isArray(data) ? data : []);
      setTrackingState('ready');
    } catch (e) { console.error('Fetch tracking:', e); setTrackingState('failed'); }
  };

  // Results > Delete results (components/ResetResults.jsx): one bankroll's results (or, asked for
  // in so many words, every bankroll's), held to the count the typed confirmation showed — the
  // server answers 409 and deletes nothing when that count is stale. Resolves true when deleted.
  const resetResults = useCallback(async (scope, expect) => {
    try {
      const res = await fetch(`${API_URL}${resetPath(scope, expect)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete results');
        fetchTracking();
        return false;
      }
      const n = data.count || 0;
      toast.success(`Deleted ${n.toLocaleString('en-US')} result${n === 1 ? '' : 's'}${scope.name && scope.key !== 'all' ? ` from ${scope.name}` : ''}`);
      fetchTracking();
      return true;
    } catch (e) {
      console.error('Delete results:', e);
      toast.error('Failed to delete results');
      return false;
    }
  }, [token]);

  // A failed read is kept as "unknown" (App improvements 111): with it the home offers no Start Event, which
  // would post a fresh starting stack over the real one and tell buddies and backers of a new entry.
  const [updatesFailed, setUpdatesFailed] = useState(false);
  const fetchMyLiveUpdate = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/live-updates/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('not a list');
      setMyActiveUpdates(data);
      setUpdatesFailed(false);
    } catch (e) { console.error('Fetch live updates:', e); setUpdatesFailed(true); }
  };

  const postLiveUpdate = useCallback(async (data) => {
    haptic();
    try {
      const res = await fetch(`${API_URL}/live-update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) fetchMyLiveUpdate();
      // The panel waits on the answer and stays open on a failure (App improvements 101).
      return { ok: res.ok, status: res.status };
    } catch (e) { console.error('Post live update:', e); return { ok: false, status: 0 }; }
  }, [token]);

  // { all: true } is Undo start: every update of that event goes, not only the latest (App improvements 112).
  const deleteLiveUpdate = useCallback(async (updateId, { all = false } = {}) => {
    try {
      const res = await fetch(`${API_URL}/live-update/${updateId}${all ? '?all=1' : ''}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) fetchMyLiveUpdate();
    } catch {}
  }, [token]);

  const saveFieldSize = useCallback(async (tournamentId, totalFieldSize) => {
    if (!totalFieldSize || !tournamentId) return;
    try {
      await fetch(`${API_URL}/tournaments/${tournamentId}/total-entries`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalEntries: totalFieldSize })
      });
      fetchTournaments();
    } catch {}
  }, [token]);

  // Resolves { ok, status } so a caller can tell a logged result from a refusal. data.ifAbsent
  // (the home's To log) makes it log-only: a result already there is a 409 that changes nothing,
  // and the list is refetched so the row that was stale goes away.
  const addTracking = useCallback(async (data) => {
    try {
      // The event: the 3-day feed list, else the schedule (an older event the home's To log logs).
      const matchedTournament = tournaments.find(tr => tr.id === data.tournamentId)
        || mySchedule.find(tr => tr.id === data.tournamentId);
      const entryForMilestone = {
        ...data,
        buyin: matchedTournament ? matchedTournament.buyin : 0,
        event_name: matchedTournament ? matchedTournament.event_name : '',
        game_variant: matchedTournament ? matchedTournament.game_variant : 'NLH'
      };
      const milestones = detectMilestones(trackingData, entryForMilestone);

      const { totalFieldSize, ...trackingPayload } = data;
      const res = await fetch(`${API_URL}/tracking`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(trackingPayload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // ifAbsent and a result is already there: nothing changed. The caller says so (To log's
        // toast; the Cashed form keeps what was typed and asks before replacing it).
        if (res.status === 409 && data.ifAbsent) { fetchTracking(); return { ok: false, status: 409, entryId: err.entryId }; }
        // Said where the player is, and the form keeps what was typed (App improvements 202).
        toast.error(`Result not saved${err.error ? `: ${err.error}` : ''}.`);
        return { ok: false, status: res.status, error: err.error || null };
      }
      const made = await res.json().catch(() => ({}));
      if (totalFieldSize) await saveFieldSize(data.tournamentId, totalFieldSize);
      fetchTracking();

      if (milestones.length > 0) {
        setActiveMilestone(milestones[0]);
      }
      return { ok: true, status: res.status, id: made && made.id };
    } catch { toast.error('Result not saved: the server did not answer.'); return { ok: false, status: 0 }; }
  }, [token, tournaments, mySchedule, trackingData]);

  // The home's To log "Didn't play" (true) and its Undo (false): user_schedules.not_played, so it
  // syncs across devices. Resolves true when stored.
  const setNotPlayed = useCallback(async (tournamentId, notPlayed, note) => {
    try {
      const res = await fetch(`${API_URL}/schedule/${tournamentId}/played`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notPlayed: !!notPlayed, ...(typeof note === 'string' ? { note } : {}) })
      });
      if (!res.ok) return false;
      setMySchedule(prev => prev.map(t => (t.id === tournamentId ? {
        ...t, not_played: notPlayed ? 1 : 0,
        not_played_note: !notPlayed ? null : typeof note === 'string' ? (note.trim() || null) : t.not_played_note,
      } : t)));
      return true;
    } catch { return false; }
  }, [token]);

  const updateTracking = useCallback(async (entryId, data) => {
    try {
      const { totalFieldSize, tournamentId, ...trackingPayload } = data;
      const res = await fetch(`${API_URL}/tracking/${entryId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(trackingPayload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(`Changes not saved${err.error ? `: ${err.error}` : ''}.`);
        return { ok: false, status: res.status, error: err.error || null };
      }
      if (totalFieldSize && tournamentId) await saveFieldSize(tournamentId, totalFieldSize);
      fetchTracking();
      return { ok: true, status: res.status };
    } catch { toast.error('Changes not saved: the server did not answer.'); return { ok: false, status: 0 }; }
  }, [token]);

  // Resolves true when deleted (the home's To log Undo checks it).
  const deleteTracking = useCallback(async (entryId) => {
    try {
      const res = await fetch(`${API_URL}/tracking/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchTracking();
      if (!res.ok) toast.error('Not deleted. Try again.');
      return res.ok;
    } catch { toast.error('Not deleted: the server did not answer. Try again.'); return false; }
  }, [token]);

  // ── Sharing functions ──
  const fetchShareToken = async () => {
    try {
      const res = await fetch(`${API_URL}/share-token`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setShareToken(data.token);
    } catch {}
  };

  const fetchShareBuddies = async () => {
    try {
      const res = await fetch(`${API_URL}/share-buddies`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setShareBuddies(data.buddies || []);
      setPendingIncoming(data.pendingIncoming || []);
      setPendingOutgoing(data.pendingOutgoing || []);
      // The server sends each buddy's avatar once, in `buddies`, not on every event they are
      // registered for (that copy made this response 17 MB). Put it back on the event entries.
      const avatarOf = new Map((data.buddies || []).map(b => [b.id, b.avatar || null]));
      const events = {};
      for (const [tid, list] of Object.entries(data.buddyEvents || {})) {
        events[tid] = (list || []).map(e => (e.avatar ? e : { ...e, avatar: avatarOf.get(e.id) || null }));
      }
      setBuddyEvents(events);
      setBuddyLiveUpdates(data.buddyLiveUpdates || {});
    } catch {}
  };

  // ── Groups ──
  const fetchMyGroups = async () => {
    try {
      const res = await fetch(`${API_URL}/groups`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMyGroups(Array.isArray(data) ? data : []);
      }
    } catch {}
  };

  const fetchGroupFeed = async (groupId) => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/feed`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setGroupFeed(Array.isArray(data) ? data : []);
      }
    } catch {}
  };

  const fetchGroupSchedule = async (groupId) => {
    try {
      const res = await fetch(`${API_URL}/groups/${groupId}/schedule`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        // In start order, each in its room's zone (App improvements 358).
        setGroupSchedule(Array.isArray(data) ? withoutDnpMarkers(data).slice().sort((a, b) => (parseTournamentTime(a) || 0) - (parseTournamentTime(b) || 0)) : []);
      }
    } catch {}
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch(API_URL + '/notifications', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setNotifications({
          groupInvites: data.groupInvites || [],
          buddyRequests: data.buddyRequests || [],
          acceptedBuddies: data.acceptedBuddies || [],
          swapSuggestions: data.swapSuggestions || []
        });
      }
    } catch {}
  };

  const markNotificationsSeen = async () => {
    try {
      await fetch(API_URL + '/seen-notifications', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {}
  };

  // Swap offers count too (App improvements 361: one arriving alone showed no badge).
  const notifCount = notifications.groupInvites.length + notifications.buddyRequests.length + notifications.acceptedBuddies.length + (notifications.swapSuggestions || []).length + (notifications.notices || []).length;

  const handleGenerateShareToken = async () => {
    try {
      const res = await fetch(`${API_URL}/share-token`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setShareToken(data.token);
    } catch {}
  };

  const handleRevokeShareToken = async () => {
    try {
      await fetch(`${API_URL}/share-token`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      setShareToken(null);
    } catch {}
  };

  const handleAcceptRequest = async (id) => {
    try {
      await fetch(`${API_URL}/share-request/${id}/accept`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      fetchShareBuddies();
    } catch {}
  };

  const handleRejectRequest = async (id) => {
    try {
      await fetch(`${API_URL}/share-request/${id}/reject`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      fetchShareBuddies();
    } catch {}
  };

  const handleCancelRequest = async (id) => {
    try {
      await fetch(`${API_URL}/share-request/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      fetchShareBuddies();
    } catch {}
  };

  const handleRemoveBuddy = async (userId) => {
    try {
      await fetch(`${API_URL}/share-buddy/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      fetchShareBuddies();
    } catch {}
  };

  // ── Auth handlers ──
  const handleLogin = async (e, isRegister = false, keepSignedIn = true) => {
    e.preventDefault();
    setError(''); setSuccess('');
    const fd = new FormData(e.target);
    const email = fd.get('email');
    const password = fd.get('password');
    const realNameInput = fd.get('realName');

    setAuthBusy(true);
    try {
      const endpoint = isRegister ? '/register' : '/login';
      const body = isRegister
        ? { email, password, realName: realNameInput, source: signupSource(fd.get('heard')), invite: pendingInvite() || undefined, device: DEVICE_HINT }
        : { email, password, device: DEVICE_HINT };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Authentication failed'); return; }

      if (isRegister) {
        // Create Account signs you in. An older server answers with no session: say so.
        if (data.token) {
          completeSignIn(data, true); carryGuestOver(data.token);
          // Signed up from an invite: connected already, and the app opens on the inviter's week.
          if (data.invitedBy) { clearInvite(); setSocialFocus(data.invitedBy); setCurrentView('social'); }
        }
        else setSuccess('Account created. Sign in to continue.');
      } else {
        completeSignIn(data, keepSignedIn);
      }
    } catch { setError('Network error. Please try again.'); }
    finally { setAuthBusy(false); }
  };

  /* A guest who creates an account keeps what they did as a guest (UX pick 3): the events saved on
     this device go into the new account, and setup answered as a guest is not asked again. */
  const carryGuestOver = (newToken) => {
    const picks = readGuestPicks();
    if (picks.length) {
      Promise.all(picks.map((id) => fetch(`${API_URL}/schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${newToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: id }),
      }).then((r) => r.ok, () => false))).then((oks) => {
        const kept = oks.filter(Boolean).length;
        writeGuestPicks([]);
        setGuestPicks([]);
        if (kept) toast.success(`Your ${kept} saved event${kept === 1 ? ' is' : 's are'} in your new account`);
      });
    }
    const setup = guestSetupState();
    if (setup) {
      markOnboarded();
      onboardingRec.current = undefined;
      const loc = readLocalLocation();
      if (loc) pushServerLocation(newToken, loc);
      pushServerOnboarding(newToken, { skipped: setup === 'skipped', filters: wizardSubset(readLocalFilters() || {}) });
      try { localStorage.removeItem('guestSetup'); } catch { /* storage off */ }
    }
  };

  // A session from /api/login or /api/register.
  const completeSignIn = (data, keepSignedIn) => {
    // A real sign-in is never a guest's (App improvements 401).
    localStorage.removeItem('isGuest');
    setIsGuest(false);
    const store = keepSignedIn ? localStorage : sessionStorage;
    store.setItem('token', data.token);
    store.setItem('username', data.username);
    if (data.avatar) store.setItem('avatar', data.avatar);
    else store.removeItem('avatar');
    if (data.realName) store.setItem('realName', data.realName);
    else store.removeItem('realName');
    store.setItem('handReplayerAccess', data.handReplayerAccess ? 'true' : 'false');
    if (!keepSignedIn) localStorage.setItem('sessionOnly', 'true');
    /* Setup is the account's: an account that has never finished it clears this browser's flag
       (a shared browser must not hand the last user's "done" to this one); one that has, adopts
       its answers and sets it. undefined (an older server) leaves the browser's own rule. */
    if (data.onboarding === null) clearOnboarded();
    else if (data.onboarding) { adoptServerOnboarding(data.onboarding); markOnboarded(); }
    onboardingRec.current = data.onboarding;
    setToken(data.token);
    setUsername(data.username);
    setAvatar(data.avatar || null);
    setRealName(data.realName || null);
    setHandReplayerAccess(!!data.handReplayerAccess);
    if (!data.realName) setShowRealNamePrompt(true);
  };

  // Sign in with Apple (Features 41): the native app's AppleSignIn plugin, then POST /api/auth/apple.
  const appleAvailable = (() => {
    const C = window.Capacitor;
    return !!(C && C.isNativePlatform && C.isNativePlatform() && C.registerPlugin && (!C.isPluginAvailable || C.isPluginAvailable('AppleSignIn')));
  })();
  const handleAppleSignIn = async () => {
    setError(''); setSuccess('');
    setAuthBusy(true);
    try {
      const AS = window.Capacitor.registerPlugin('AppleSignIn');
      const r = await AS.authorize();
      const res = await fetch(`${API_URL}/auth/apple`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityToken: r.identityToken, givenName: r.givenName, familyName: r.familyName, device: DEVICE_HINT, source: signupSource(null), invite: pendingInvite() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Sign in with Apple failed. Please try again.'); return; }
      completeSignIn(data, true);
      if (data.created) carryGuestOver(data.token);
      if (data.invitedBy) { clearInvite(); setSocialFocus(data.invitedBy); setCurrentView('social'); }
    } catch (e) {
      if (!/cancel/i.test(String((e && e.message) || e))) setError('Sign in with Apple did not finish. Please try again.');
    } finally { setAuthBusy(false); }
  };

  const handleGuestLogin = async () => {
    setError(''); setSuccess('');
    try {
      const res = await fetch(`${API_URL}/guest-login`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Guest login failed'); return; }
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('isGuest', 'true');
      localStorage.removeItem('avatar');
      setToken(data.token);
      setUsername(data.username);
      setIsGuest(true);
      setAvatar(null);
    } catch { setError('Network error. Please try again.'); }
  };

  const handleLogout = () => {
    fetch(`${API_URL}/logout`, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {} }).catch(() => {});
    ['token','username','avatar','isGuest','realName','sessionOnly'].forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    setToken(null);
    setUsername(null);
    setIsGuest(false);
    setAvatar(null);
    setRealName(null);
    setShowRealNamePrompt(false);
    setEditingName(false);
    setShowOnboarding(false);
    setCurrentView('dashboard');
    setTournaments([]);
    setMySchedule([]);
    setShareToken(null);
    setShareBuddies([]);
    setPendingIncoming([]);
    setPendingOutgoing([]);
    setNotifications({ groupInvites: [], buddyRequests: [], acceptedBuddies: [] });
    setShowNotifications(false);
    setTrackingData([]);
    setBuddyEvents({});
  };

  // Any photo fits (App improvements 422): shrunk in the browser to a 256 x 256 JPEG (about 20 KB) before it is
  // sent, under the server's 200 KB limit every phone camera photo went over; a refusal says why.
  const shrinkPhoto = async (file) => {
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
      return blob || file;
    } catch { return file; }
  };
  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', await shrinkPhoto(file), 'avatar.jpg');
    try {
      const res = await fetch(`${API_URL}/avatar`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAvatar(data.avatar);
        localStorage.setItem('avatar', data.avatar);
        toast.success('Photo updated');
      } else {
        toast.error(data.error || "That photo didn't upload. Try another.");
      }
    } catch { toast.error("That photo didn't upload: no connection."); }
    e.target.value = '';
  };

  const handleAvatarRemove = async () => {
    try {
      await fetch(`${API_URL}/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setAvatar(null);
      localStorage.removeItem('avatar');
    } catch {}
  };

  // Plain fetch, not guardedFetch: that one signs the user out on 401 OR 403, and a 403 here just
  // means this account is not on the server's admin list.
  const adminEditTournament = useCallback(async (tournamentId, fields) => {
    const res = await fetch(`${API_URL}/tournaments/${tournamentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      // Carry the server's per-field detail through. Throwing only `.message` is what forced the
      // editor into a single alert() — the 400/409 bodies name the offending fields.
      const err = new Error(e.error || 'Failed to save');
      err.status = res.status;
      err.fields = Array.isArray(e.fields) ? e.fields : [];
      err.fieldErrors = e.fieldErrors && typeof e.fieldErrors === 'object' ? e.fieldErrors : {};
      throw err;
    }
    const updated = await res.json();
    // overridden_fields is set EXPLICITLY rather than left to the spread: a spread never deletes a
    // key, so once a row had the marker the badge could never clear again.
    const merge = t => (t.id === tournamentId
      ? { ...t, ...updated, overridden_fields: updated.overridden_fields }
      : t);
    setTournaments(prev => prev.map(merge));
    setMySchedule(prev => prev.map(merge));
    toast.success('Event updated');
  }, [token, toast]);

  // Drop every override on an event so the feed's own values take over at the next sync.
  const clearTournamentOverrides = useCallback(async (tournamentId) => {
    const res = await fetch(`${API_URL}/tournaments/${tournamentId}/overrides`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'Failed to clear overrides');
    }
    const { cleared } = await res.json();
    const drop = t => (t.id === tournamentId ? { ...t, overridden_fields: undefined } : t);
    setTournaments(prev => prev.map(drop));
    setMySchedule(prev => prev.map(drop));
    // cleared === 0 means the badge was stale, not that anything was undone — say so rather than
    // reporting a success that did nothing.
    if (cleared === 0) toast.info('No overrides to clear');
    else toast.success(`Cleared ${cleared} override${cleared === 1 ? '' : 's'}`);
  }, [token, toast]);

  /* The first event saved is the moment the app is for (UX pick 5): it is confirmed, with a way to
     the list it went to. */
  const confirmFirstSave = useCallback(() => {
    toast.success('Added to My Schedule · 1 event', {
      duration: 6000,
      action: { label: 'View', onClick: () => { setCurrentView('schedule'); requestAnimationFrame(() => landMySchedule()); } },
    });
  }, [toast]);

  /* Undo after a remove (UX pick 22): the event goes back with its plan (conditions, priority, planned
     entries), or a travel day is made again on its date. */
  const restoreRemoved = useCallback(async (t) => {
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      if (t.venue === 'Personal') {
        const r = await fetch(`${API_URL}/personal-event`, { method: 'POST', headers: auth, body: JSON.stringify({ date: normaliseDate(t.date), type: t.event_name, notes: t.notes || '' }) });
        if (!r.ok) throw new Error(String(r.status));
      } else {
        const r = await fetch(`${API_URL}/schedule`, { method: 'POST', headers: auth, body: JSON.stringify({ tournamentId: t.id }) });
        if (!r.ok) throw new Error(String(r.status));
        const rest = [];
        let conds = null;
        try { conds = t.conditions_json ? JSON.parse(t.conditions_json) : null; } catch { conds = null; }
        if (Array.isArray(conds) && conds.length) rest.push(fetch(`${API_URL}/schedule/${t.id}/condition`, { method: 'PUT', headers: auth, body: JSON.stringify({ conditions: conds, isPublic: t.condition_is_public !== 0 }) }));
        if (t.is_anchor) rest.push(fetch(`${API_URL}/schedule/${t.id}/anchor`, { method: 'PUT', headers: auth, body: JSON.stringify({ isAnchor: true }) }));
        if (Number(t.planned_entries) > 1) rest.push(fetch(`${API_URL}/schedule/${t.id}/entries`, { method: 'PUT', headers: auth, body: JSON.stringify({ plannedEntries: Number(t.planned_entries) }) }));
        await Promise.all(rest);
      }
      fetchMySchedule();
    } catch {
      toast.error('Could not put it back. Add it again from the Schedule.');
      fetchMySchedule();
    }
  }, [token, toast]);

  const toggleTournament = useCallback(async (tournamentId) => {
    haptic();
    if (isGuest) {
      const first = !guestPicks.length;
      setGuestPicks(prev => {
        const next = prev.includes(tournamentId) ? prev.filter(id => id !== tournamentId) : [...prev, tournamentId];
        writeGuestPicks(next);
        return next;
      });
      if (first) confirmFirstSave();
      return;
    }
    const existing = mySchedule.find(t => t.id === tournamentId);
    const isIn = !!existing;
    // Optimistic: the card shows the change at once; a refusal puts it back and says so.
    const before = mySchedule;
    const firstSave = !isIn && !before.some(t => t.venue !== 'Personal');
    if (isIn) setMySchedule(prev => prev.filter(t => t.id !== tournamentId));
    else {
      const t = tournaments.find(x => x.id === tournamentId);
      if (t) setMySchedule(prev => [...prev, { ...t }]);
    }
    try {
      let res;
      if (isIn) {
        const path = existing.venue === 'Personal' ? 'personal-event' : 'schedule';
        res = await fetch(`${API_URL}/${path}/${tournamentId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        res = await fetch(`${API_URL}/schedule`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId })
        });
        // The third saved event is a moment to ask for a rating (utils/review-prompt.js).
        if (res.ok) noteReviewMoment('saved');
      }
      if (!res.ok) throw new Error(String(res.status));
      if (firstSave) confirmFirstSave();
      if (isIn) toast.success(`Removed ${existing.event_name}`, { duration: 5000, action: { label: 'Undo', onClick: () => restoreRemoved(existing) } });
      fetchMySchedule();
    } catch {
      // Put the card back and say which event and that nothing was saved, with Retry (App improvements 4).
      setMySchedule(before);
      const name = (existing && existing.event_name) || ((tournaments.find(x => x.id === tournamentId) || {}).event_name) || 'it';
      toast.error(isIn ? `Couldn't remove ${name} from My Schedule. Nothing changed.` : `Couldn't add ${name} to My Schedule. Nothing was saved.`,
        { duration: 6000, action: { label: 'Retry', onClick: () => toggleRef.current && toggleRef.current(tournamentId) } });
    }
  }, [token, mySchedule, isGuest, guestPicks, tournaments, toast, confirmFirstSave, restoreRemoved]);
  const toggleRef = useRef(null);
  toggleRef.current = toggleTournament;

  const addPersonalEvent = useCallback(async (date, type, notes) => {
    try {
      const res = await fetch(`${API_URL}/personal-event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, type, notes: notes || '' })
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create personal event');
        return false;
      }
      fetchMySchedule();
      return true;
    } catch { setError('Failed to create personal event'); return false; }
  }, [token]);

  const updatePersonalEvent = useCallback(async (tournamentId, notes) => {
    try {
      await fetch(`${API_URL}/personal-event/${tournamentId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      fetchMySchedule();
    } catch { setError('Failed to update personal event'); }
  }, [token]);

  const setCondition = useCallback(async (tournamentId, conditions, isPublic) => {
    if (isGuest) { toast.info(GUEST_PLAN_NOTE); return; }
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/condition`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions, isPublic })
      });
      fetchMySchedule();
    } catch { setError('Failed to set condition'); }
  }, [token, isGuest, toast]);

  const removeCondition = useCallback(async (tournamentId) => {
    if (isGuest) { toast.info(GUEST_PLAN_NOTE); return; }
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/condition`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchMySchedule();
    } catch { setError('Failed to remove condition'); }
  }, [token, isGuest, toast]);

  const toggleAnchor = useCallback(async (tournamentId, isAnchor) => {
    if (isGuest) { toast.info(GUEST_PLAN_NOTE); return; }
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/anchor`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAnchor })
      });
      fetchMySchedule();
    } catch { setError('Failed to update anchor status'); }
  }, [token, isGuest, toast]);

  const setPlannedEntries = useCallback(async (tournamentId, plannedEntries) => {
    if (isGuest) { toast.info(GUEST_PLAN_NOTE); return; }
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/entries`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedEntries })
      });
      fetchMySchedule();
    } catch { setError('Failed to update planned entries'); }
  }, [token, isGuest, toast]);

  // ── Pull-to-refresh ──
  const contentAreaRef = useRef(null);
  const refreshAll = useCallback(async () => {
    if (!token) return;
    await Promise.all([
      fetchTournaments(), fetchMySchedule(), fetchTracking(),
      fetchMyLiveUpdate(), fetchShareBuddies(), fetchNotifications()
    ]);
  }, [token]);
  const { ptrProps, ptrIndicator, refreshing } = usePullToRefresh(contentAreaRef, refreshAll);

  // ── Initial data load ──
  useEffect(() => {
    if (token) {
      Promise.all([
        fetchTournaments(), fetchMySchedule(), fetchShareToken(), fetchShareBuddies(),
        fetchMyGroups(), fetchNotifications(), fetchTracking(), fetchMyLiveUpdate(),
        fetchVenueColors()
      ]).finally(() => setDataLoaded(true));
    }
  }, [token]);

  // ── SSE: real-time buddy updates ──
  // The stream is opened with a short-lived, single-use ticket, never the JWT: the
  // URL lands in request logs and EventSource cannot send an Authorization header.
  // Because the ticket is spent on first use, EventSource's own auto-reconnect (which
  // replays the same URL) can never succeed — so on any error we close the stream and
  // reopen it ourselves with a fresh ticket, backing off 2 s → 30 s, and reopen at once
  // when the app returns to the foreground or the network comes back.
  useEffect(() => {
    if (!token) return;
    const MIN_BACKOFF = 2000, MAX_BACKOFF = 30000;
    let es = null;
    let disposed = false;
    let connecting = false;
    let retryTimer = null;
    let backoff = MIN_BACKOFF;

    const wireListeners = (es) => {
      es.addEventListener('buddy-live-update', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.cleared) {
            setBuddyLiveUpdates(prev => {
              const next = { ...prev };
              delete next[d.buddyId];
              return next;
            });
          } else {
            setBuddyLiveUpdates(prev => ({ ...prev, [d.buddyId]: {
              tournamentId: d.tournamentId, eventName: d.eventName, venue: d.venue,
              stack: d.stack, sb: d.sb, bb: d.bb, bbAnte: d.bbAnte,
              isItm: d.isItm, isRegClosed: d.isRegClosed, bubble: d.bubble,
              lockedAmount: d.lockedAmount, isFinalTable: d.isFinalTable,
              placesLeft: d.placesLeft, firstPlacePrize: d.firstPlacePrize,
              isDeal: d.isDeal, dealPlace: d.dealPlace, dealPayout: d.dealPayout,
              isBusted: d.isBusted, totalEntries: d.totalEntries,
              isBagged: d.isBagged, bagDay: d.bagDay,
              playStartedAt: d.playStartedAt, updatedAt: d.updatedAt
            }}));
          }
        } catch (err) { console.error('SSE buddy-live-update error:', err); }
      });

      es.addEventListener('buddy-schedule-change', () => fetchShareBuddies());
      es.addEventListener('buddy-request', () => { fetchShareBuddies(); fetchNotifications(); });
      es.addEventListener('buddy-tracking', () => {});

      es.addEventListener('group-message', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.groupId != null && String(d.groupId) !== String(activeGroupRef.current)) { fetchMyGroups(); return; }
          if (hiddenRef.current.has(Number(d.userId))) return;
          setGroupFeed(prev => [...prev, {
            id: d.id || Date.now(), type: 'message',
            user_id: d.userId, username: d.username, real_name: d.realName || null, avatar: d.avatar,
            content: d.message, created_at: d.createdAt
          }]);
          fetchMyGroups();
        } catch (err) { console.error('SSE group-message error:', err); }
      });
      es.addEventListener('group-updated', () => fetchMyGroups());
      // A reported message the owner removed (Features 38).
      es.addEventListener('group-message-removed', (e) => {
        try { const d = JSON.parse(e.data); setGroupFeed(prev => prev.filter(m => m.id !== d.id)); } catch { /* malformed */ }
      });
      es.addEventListener('group-deleted', (e) => {
        try {
          const d = JSON.parse(e.data);
          fetchMyGroups();
          setActiveGroupId(prev => prev === d.groupId ? null : prev);
        } catch (err) { console.error('SSE group-removed:', err); }
      });
      es.addEventListener('group-live-update', (e) => {
        try {
          const d = JSON.parse(e.data);
          // Only the open group's, once per player and moment: the server sends one per group the two share.
          if (d.groupId != null && String(d.groupId) !== String(activeGroupRef.current)) return;
          if (!d.cleared) {
            setGroupFeed(prev => (prev.some(x => x.type === 'live-update' && x.user_id === d.userId && x.created_at === d.updatedAt) ? prev : [...prev, {
              id: Date.now(), type: 'live-update',
              user_id: d.userId, username: d.username,
              content: null, liveData: d, created_at: d.updatedAt
            }]));
          }
        } catch (err) { console.error('SSE group-live-update error:', err); }
      });
      es.addEventListener('group-invite', () => fetchNotifications());
      es.addEventListener('swap-offer', () => fetchNotifications());
      es.addEventListener('group-invite-response', () => { fetchNotifications(); fetchMyGroups(); });

      // Tournament data live-sync: optimistically merge single-row edits
      es.addEventListener('tournament-changed', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (!d || !d.id || !d.fields) return;
          setTournaments(prev => prev.map(t => t.id === d.id ? { ...t, ...d.fields } : t));
          setMySchedule(prev => prev.map(t => t.id === d.id ? { ...t, ...d.fields } : t));
        } catch (err) { console.error('SSE tournament-changed error:', err); }
      });

      // Bulk imports / structure parses / sync — full refetch
      es.addEventListener('schedule-refetch', () => {
        fetchTournaments();
      });

      // Venue color updates — apply directly to CSS vars (no React state)
      es.addEventListener('venue-colors-changed', (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d && typeof d === 'object') applyVenueColors(d);
        } catch (err) { console.error('SSE venue-colors-changed error:', err); }
      });
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      const delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    };

    const connect = async () => {
      if (disposed || connecting || es) return;
      connecting = true;
      try {
        const res = await fetch(`${API_URL}/events/ticket`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (disposed) return;
        if (res.status === 401 || res.status === 403) {
          // The session itself is bad; retrying won't help. A foreground/online retries once.
          console.warn(`SSE ticket refused (${res.status})`);
          return;
        }
        if (!res.ok) throw new Error(`ticket request failed (${res.status})`);
        const { ticket } = await res.json();
        if (disposed) return;
        const src = new EventSource(`${API_URL}/events?ticket=${encodeURIComponent(ticket)}`);
        es = src;
        wireListeners(src);
        src.onopen = () => { backoff = MIN_BACKOFF; };
        src.onerror = () => {
          if (es !== src) return;
          // Don't let the browser retry: it would replay the spent ticket.
          src.close();
          es = null;
          console.warn('SSE connection lost; reconnecting with a fresh ticket');
          scheduleReconnect();
        };
      } catch (err) {
        console.warn('SSE connect failed:', err && err.message);
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    };

    // Back in the foreground (or back online) with no live stream: reconnect now,
    // rather than waiting out whatever backoff was pending.
    const onResume = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') return;
      if (es && es.readyState !== EventSource.CLOSED) return;
      if (es) { es.close(); es = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      backoff = MIN_BACKOFF;
      connect();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onResume);

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('online', onResume);
      if (es) es.close();
      es = null;
    };
  }, [token]);

  // ── Refetch tournaments when tab regains focus / network comes back online ──
  useEffect(() => {
    if (!token) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchTournaments();
    };
    const onOnline = () => fetchTournaments();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [token]);

  // ── Self-heal: if we have a token but the tournaments list is empty
  //    (a fetch failed during a server restart / network blip), retry
  //    silently on a short backoff. Stops once we have data.
  useEffect(() => {
    if (!token) return;
    if (tournaments.length > 0) return;
    if (!dataLoaded) return; // initial load hasn't finished yet
    const id = setTimeout(() => { fetchTournaments(); fetchMySchedule(); }, 1500);
    return () => clearTimeout(id);
  }, [token, tournaments.length, dataLoaded]);

  // ── Push notifications (admin only) ──
  // Permission is requested from a TAP (the bell panel's enable button), never from page load:
  // iOS silently drops a load-time Notification.requestPermission(), which left every iPhone
  // unsubscribed while desktops worked. On load we only renew an existing/granted subscription.
  //
  // Two transports behind one flow: web push (browser / installed PWA) and APNs device tokens
  // (the Capacitor TestFlight build, whose WKWebView has no PushManager). The server fans admin
  // alerts to both.
  const nativePush = !!(window.Capacitor && window.Capacitor.isNativePlatform());
  const pushSupported = nativePush ||
    ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  // Every signed-in player can have pushes since Features 39 (their kinds switched in Settings); the
  // admins' own alerts ride the same registration.
  const isPushAdmin = !!token && !isGuest;
  const [pushPerm, setPushPerm] = useState(() =>
    nativePush ? 'default' : (pushSupported ? Notification.permission : 'denied'));

  // Web deep link: the SW opened /?find=… — apply it once a session exists, then strip the
  // param so a reload doesn't re-apply it.
  const applyFindLink = useCallback((q) => {
    setCalendarFind(q);
    setCurrentView('calendar');
  }, [setCurrentView]);

  useEffect(() => {
    if (!token) return;
    if (FIND_PARAM != null) applyFindLink(FIND_PARAM);
    else if (VIEW_PARAM === 'calendar') setCurrentView('calendar');
    else return;
    if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
  }, [token, applyFindLink, setCurrentView]);

  const openBatch = useCallback((id) => {
    setBatchId(id);
    setCurrentView('batches');
    const c = document.querySelector('.content-area');
    if (c) requestAnimationFrame(() => { c.scrollTop = 0; });
  }, [setCurrentView]);
  // Where a push tap or a bell item points (Features 39): a tab address ("/#/social"), a /?find= event, an
  // admin batch, or a shared hand.
  const openAppUrl = useCallback((url) => {
    if (typeof url !== 'string' || !url) return;
    const b = batchIdFrom(url);
    if (b != null) { openBatch(b); return; }
    const m = url.match(/[?&]find=([^&#]*)/);
    if (m) { applyFindLink(decodeURIComponent(m[1].replace(/\+/g, ' '))); return; }
    const hi = url.indexOf('#');
    const v = hi >= 0 ? viewFromHash(url.slice(hi).split('?')[0]) : null;
    if (v) { setCurrentView(v); return; }
    const vm = url.match(/[?&]view=([a-z]+)/);
    if (vm) { setCurrentView(vm[1]); return; }
    if (/^\/(h|i|shared)\//.test(url)) window.location.assign(url);
  }, [openBatch, applyFindLink, setCurrentView]);

  // A new token for this device (Features 42: a password change, Sign out others), kept where the old one was.
  const replaceToken = useCallback((t) => {
    if (!t) return;
    try {
      if (localStorage.getItem('token')) localStorage.setItem('token', t);
      else sessionStorage.setItem('token', t);
    } catch { /* storage off */ }
    setToken(t);
  }, []);

  // The people blocked either way (Features 38): their live messages are not shown.
  const refreshBlocks = useCallback(() => {
    if (!token || isGuest) return;
    fetch(`${API_URL}/blocks`, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setHiddenIds(new Set((d.hidden || []).map(Number))); }).catch(() => {});
  }, [token, isGuest]);
  useEffect(() => { refreshBlocks(); }, [refreshBlocks]);

  useEffect(() => {
    if (!token || isGuest) return undefined;
    const onKey = (e) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      // Hands keeps ⌘K and / for its game palette.
      if (document.querySelector('.tab-panel.tab-active[data-tab="hands"]')) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowSearch(true); }
      else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [token, isGuest]);

  // An invite opened while signed in (Features 37): a connection request to the inviter.
  useEffect(() => {
    const inv = pendingInvite();
    if (!token || isGuest || !inv) return;
    clearInvite();
    fetch(`${API_URL}/invite/${encodeURIComponent(inv)}/connect`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d }))).then(({ ok, d }) => {
        if (!ok) { toast.error(d.error || 'That invite has expired'); return; }
        toast.success(d.status === 'connected' ? `You and ${d.username} are connected` : d.status === 'pending' ? `A request to ${d.username} is waiting` : `Request sent to ${d.username}`);
        setCurrentView('social');
      }).catch(() => {});
    if (INVITE_PATH_MATCH && window.history.replaceState) window.history.replaceState(null, '', '/');
  }, [token, isGuest]);

  // futurega.me links open in the app (Features 47): the native DeepLinks plugin hands over the URL, and
  // the app reloads at that path, where a hand, a schedule or an invite opens as it does on the web.
  useEffect(() => {
    const C = window.Capacitor;
    if (!(C && C.isNativePlatform && C.isNativePlatform() && C.registerPlugin)) return undefined;
    if (C.isPluginAvailable && !C.isPluginAvailable('DeepLinks')) return undefined;
    const DL = C.registerPlugin('DeepLinks');
    const go = (u) => {
      try {
        const url = new URL(u);
        if (!/(^|\.)futurega\.me$/.test(url.hostname)) return;
        if (/^\/(h|shared|i)\//.test(url.pathname) && window.location.pathname !== url.pathname) window.location.assign(url.pathname + url.search);
      } catch { /* not a URL */ }
    };
    DL.getLaunchUrl().then((r) => { if (r && r.url) go(r.url); }).catch(() => {});
    const h = DL.addListener('appUrlOpen', (e) => go(e && e.url));
    return () => { Promise.resolve(h).then((x) => x && x.remove && x.remove()).catch(() => {}); };
  }, []);

  // /?batch=<id>: an admin push tap. Waits for a session, then opens the batch only for an app
  // admin; anyone else just loses the param.
  const batchLinkHandled = useRef(false);
  useEffect(() => {
    if (!token || BATCH_PARAM == null || batchLinkHandled.current) return;
    batchLinkHandled.current = true;
    if (!isGuest && APP_ADMIN_USERNAMES.includes(authUsername)) openBatch(BATCH_PARAM);
    if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
  }, [token, isGuest, openBatch]);

  const nativePermState = (p) =>
    p.receive === 'granted' ? 'granted' : (p.receive === 'denied' ? 'denied' : 'default');

  const subscribeToPush = useCallback(async () => {
    if (!pushSupported) return;
    try {
      if (nativePush) {
        // TestFlight and App Store builds run against PRODUCTION APNs, which is what the server
        // defaults to; only an Xcode dev build would need 'sandbox', and those aren't subscribed.
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.requestPermissions();
        const state = nativePermState(perm);
        setPushPerm(state);
        if (state !== 'granted') return;
        const handles = [];
        await new Promise((resolve) => {
          const done = () => {
            for (const h of handles) { try { h.remove(); } catch { /* already gone */ } }
            resolve();
          };
          PushNotifications.addListener('registration', async (t) => {
            try {
              await fetch(`${API_URL}/apns-subscribe`, {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t.value, env: 'production' })
              });
            } catch { /* registered next launch */ }
            done();
          }).then(h => handles.push(h));
          PushNotifications.addListener('registrationError', () => done()).then(h => handles.push(h));
          PushNotifications.register();
        });
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const permission = await Notification.requestPermission();
        setPushPerm(permission);
        if (permission !== 'granted') return;
        const keyRes = await fetch(`${API_URL}/push/vapid-key`);
        const { key } = await keyRes.json();
        if (!key) return;
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        });
      }
      setPushPerm(Notification.permission);
      await fetch(`${API_URL}/push-subscribe`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub })
      });
    } catch (err) { /* Push setup failed silently */ }
  }, [pushSupported, nativePush, token]);

  useEffect(() => {
    if (!isPushAdmin || !pushSupported) return;
    (async () => {
      if (nativePush) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          // Tapping a delivered notification carries the push payload's url; a /?find=… link
          // navigates the same way a web tap does. Registered before anything else so a tap
          // that cold-starts the app is not missed.
          if (!tapListenerArmed.current) {
            tapListenerArmed.current = true;
            PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
              const url = a && a.notification && a.notification.data && a.notification.data.url;
              openAppUrl(url);
            });
          }
          const state = nativePermState(await PushNotifications.checkPermissions());
          setPushPerm(state);
          if (state === 'granted') void subscribeToPush(); // silent re-register: tokens rotate
        } catch {
          setPushPerm('denied'); // binary predates the plugin — hide the enable button, it can't work
        }
        return;
      }
      if (Notification.permission === 'granted') void subscribeToPush();
    })();
  }, [isPushAdmin, pushSupported, nativePush, subscribeToPush, openAppUrl]);

  // isAdmin is a STAGED-ROLLOUT flag, not an authorisation one. It gates the Hands tab, the
  // solver/replayer panel and StakingView — none of whose endpoints are admin-gated server side —
  // so narrowing it to match the server's write allowlist would revoke working features from
  // 'claude' rather than fix anything.
  // Read from the signed token's claim (authUsername), not the editable 'username' storage key.
  const isAdmin = !isGuest && APP_ADMIN_USERNAMES.includes(authUsername);
  // A deep link opens its view once an admin is signed in, then the hash is cleared (§11.5).
  useEffect(() => {
    if (!deepLink || !isAdmin) return;
    setCurrentView(deepLink.view);
    if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [deepLink, isAdmin]);
  // The write capability is separate and DOES have to match the server, which gates every admin
  // route on ['ham','ham5'] in 8 places. Passing the callbacks conditionally is enough: the row
  // renders its Edit button on `isAdmin && onAdminEdit`, so an account without the capability
  // keeps the rollout features and simply never sees an editor it cannot save from.
  const canEditEvents = !isGuest && EVENT_EDITOR_USERNAMES.includes(authUsername);

  // Bankrolls (beta, app admins): ONE summary for the home (its bankroll line and period block)
  // and the Results tab (its switcher, the dashboard, Cash and Expenses), lifted here from
  // TrackingView so the two never disagree. The balances are the server's combined ledger, so they
  // are refetched whenever the results change (version). For everyone else it fetches nothing.
  const bk = useBankrolls({ enabled: isAdmin, token, version: trackingData });
  // ── Desktop layout (docs/desktop-layout.md) ──
  // Wide landscape windows get a side rail + panes; everything else is the
  // phone layout, unchanged. dk.desktop is false on every phone.
  const dk = useDesktopLayout();
  const isDesktop = dk.desktop;
  /* The parser eval's progress on the Admin row while it runs (UX pick 111): the Admin screen says when
     a run is going (an 'fg:eval' event); from then the app asks every 15 s until it ends. */
  const [evalPct, setEvalPct] = useState(null);
  useEffect(() => {
    const on = (e) => setEvalPct(e.detail && e.detail.running ? e.detail.pct : null);
    window.addEventListener('fg:eval', on);
    return () => window.removeEventListener('fg:eval', on);
  }, []);
  useEffect(() => {
    if (evalPct == null || !token) return undefined;
    const id = setInterval(() => {
      fetch(`${API_URL}/admin/quick-add-eval`, { headers: { Authorization: 'Bearer ' + token } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!d || !d.running) setEvalPct(null); else if (d.progress && d.progress.total) setEvalPct(Math.round((d.progress.done / d.progress.total) * 100)); })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [evalPct != null, token]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Sheets portalled to <body> are centred 46g dialogs on the desktop (UX pick 71): the root carries
     the shell's width in g and the dialog's whole-g offset in it, so a dialog lands on the shell's
     g lines as the game palette does. */
  useEffect(() => {
    const root = document.documentElement;
    if (!isDesktop) { root.classList.remove('dk-on'); return; }
    root.classList.add('dk-on');
    root.style.setProperty('--dk-shell-n', String(dk.shellG));
    root.style.setProperty('--dk-sheet-x', String(Math.max(0, Math.round((dk.shellG - 46) / 2))));
    // A classic scrollbar's width in g, so a dialog that scrolls keeps its 44g of content (styles.css).
    root.style.setProperty('--dk-sb-g', String(dk.sbG));
  }, [isDesktop, dk.shellG, dk.sbG]);
  // (Declared above the running head, which reads isDesktop.)
  // The Swiss theme's running head: the section, then its scope (catalogue item 7).
  const swissRunningHead = useMemo(() => {
    if (currentView === 'tracking') {
      if (!bk.enabled) return 'Bankroll';
      const cur = bk.selected === 'all' ? null : (bk.visible || []).find((b) => b.id === bk.selected);
      const bal = balancesFromSummary(bk.summary).get(bk.selected);
      let amt = '';
      try { if (bal) amt = new Intl.NumberFormat('en-US', { style: 'currency', currency: bal.currency || 'USD', maximumFractionDigits: 0 }).format(bal.balance || 0); } catch { /* an unknown code */ }
      return ['Bankroll', cur ? cur.name : 'All bankrolls', amt].filter(Boolean).join(' \u00b7 ');
    }
    if (currentView === 'cash') return 'Cash \u00b7 ' + (cashMode === 'heatmap' ? 'history' : 'live games');
    if (currentView === 'hands') return 'Hands \u00b7 archive';
    if (currentView === 'dashboard') return 'Dashboard';
    // The season as the catalogue sets a range (item 15): capital months, an en dash ("Oct 2026\u2013Mar 2027").
    const season = String(seasonLabel || '')
      .replace(/\b([a-z])([a-z]{2})\b/g, (m, a, b) => a.toUpperCase() + b)
      .replace(/\s*-\s*/g, '\u2013');
    // On a phone the years ran the line under the bell (owner's screenshot, 2026-10-20): months only.
    return ['Schedule', isDesktop ? season : season.replace(/\s+\d{4}\b/g, '')].filter(Boolean).join(' \u00b7 ');
  }, [currentView, bk.enabled, bk.selected, bk.visible, bk.summary, cashMode, seasonLabel, isDesktop]);

  // Edit home (utils/home-layout.js): which Dashboard sections show and in what order, per account
  // (cached locally, saved to the server). homeEdit: the sheet is open; homeEditOpener: the control
  // that opened it, so focus goes back to it on close. Guests get the default home and no sheet.
  const homeUserId = useMemo(() => (isGuest ? null : tokenUserId(token)), [token, isGuest]);
  const homeLayout = useHomeLayout({ token, isGuest, userId: homeUserId });
  const [homeEdit, setHomeEdit] = useState(false);
  const homeEditOpener = useRef(null);
  const homeCtx = useMemo(() => ({ admin: !!(isAdmin && bk.enabled), registered: !isGuest }), [isAdmin, bk.enabled, isGuest]);
  const openHomeEdit = useCallback((el) => { homeEditOpener.current = el || null; setHomeEdit(true); }, []);
  const flushHomeLayout = homeLayout.flush;
  const closeHomeEdit = useCallback(() => {
    flushHomeLayout();
    setHomeEdit(false);
    const el = homeEditOpener.current;
    homeEditOpener.current = null;
    if (el && el.isConnected) requestAnimationFrame(() => { try { el.focus({ preventScroll: true }); } catch { /* gone */ } });
  }, [flushHomeLayout]);
  // Signed out, or now a guest: nothing to edit.
  useEffect(() => { if (isGuest || !token) setHomeEdit(false); }, [isGuest, token]);

  // A non-admin session never runs on the simulated clock (see the boot-time clear above): this
  // catches an admin signing out and someone else signing in without a reload.
  useEffect(() => {
    if (isAdmin || !getDebugNow()) return;
    setDebugNow('');
    setDebugTimeKey(k => k + 1);
  }, [isAdmin]);

  const [dkSelectedId, setDkSelectedId] = useState(null);
  // The header's right group ends on the rightmost pane's edge (styles.css --dk-head-inset): the whole
  // g between that pane and the shell's right edge, measured after every layout and on resize.
  useLayoutEffect(() => {
    if (!isDesktop) return undefined;
    const shell = document.querySelector('.app-shell.is-desktop');
    const body = shell && shell.querySelector('.dk-body');
    if (!shell || !body) return undefined;
    const measure = () => {
      const sr = shell.getBoundingClientRect();
      const g = sr.width / (dk.shellG || 1);
      const rights = [...body.querySelectorAll('.dk-pane')]
        .filter(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
        .map(el => el.getBoundingClientRect().right);
      if (!rights.length || !g) return;
      const n = Math.max(0, Math.round((sr.right - Math.max(...rights)) / g));
      shell.style.setProperty('--dk-head-inset', n ? `calc(var(--gu) * ${n})` : '0');
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) { ro.observe(body); [...body.children].forEach(c => ro.observe(c)); }
    const mo = new MutationObserver(() => { measure(); if (ro) [...body.children].forEach(c => ro.observe(c)); });
    mo.observe(body, { childList: true });
    return () => { if (ro) ro.disconnect(); mo.disconnect(); };
  }, [isDesktop, currentView, dk.shellG]);
  // Where My Schedule's block starts in the right pane (styles.css --dk-band-at), so the pane's side
  // hairlines break across the band between it and the selected event, as the band's lines break at the
  // pane's edges (owner, 2026-10-22). Re-measured as the event's block resizes, its open/close included.
  useLayoutEffect(() => {
    if (!isDesktop || currentView !== 'tournaments') return undefined;
    const pane = document.querySelector('.dk-pane-detail');
    if (!pane) return undefined;
    const measure = () => {
      const mine = pane.querySelector(':scope > .dk-mine-block');
      if (mine) pane.style.setProperty('--dk-band-at', mine.offsetTop + 'px');
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const watch = () => { if (ro) { ro.disconnect(); [...pane.children].forEach(c => ro.observe(c)); } measure(); };
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(pane, { childList: true });
    return () => { if (ro) ro.disconnect(); mo.disconnect(); };
  }, [isDesktop, currentView]);
  // The home's second pane (its NUMBERS column), set by a callback ref once the pane mounts.
  const [dkHomeRight, setDkHomeRight] = useState(null);
  /* The second pane of Hands and Cash on desktop (UX picks 68, 107): one host per tab, each view portals
     into its own, so a tab kept mounted in the background never shows in another's pane. Hands says
     whether its split is showing (the entry, quick add and the drill take the main pane alone). */
  const [dkSideHands, setDkSideHands] = useState(null);
  const [dkSideCash, setDkSideCash] = useState(null);
  const [handsSplit, setHandsSplit] = useState(true);
  /* Bankroll's second pane (Bankroll design 83-85): Overview's tables, a result or session beside the list,
     Import's commit and check. The section asks for it (hooks/useBankrollSide.js); off, the tab is one pane. */
  const [dkSideBankroll, setDkSideBankroll] = useState(null);
  const [bankrollSplit, setBankrollSplit] = useState(false);
  // Closing an event animates like opening one, in reverse (owner, 2026-10-11): the details keep
  // rendering, marked closing, until their collapse ends, so My Schedule rises into their place
  // instead of jumping. Worked out during render (React's "previous value in state" pattern) so
  // the block is never unmounted between the two. Only while the block is on screen (the ref):
  // a selection cleared while the pane was away (the user menu's My Schedule from another tab)
  // has nothing to collapse.
  const dkDetailRef = useRef(null);
  const [dkClosing, setDkClosing] = useState(null); // { id } while the details collapse
  const [dkPrevSelected, setDkPrevSelected] = useState(null);
  // The Calendar keeps the desktop's two panes too (UX pick 29): it is the Schedule tab's other view.
  const dkPaneShown = isDesktop && (currentView === 'tournaments' || currentView === 'calendar');
  if (dkSelectedId !== dkPrevSelected) {
    setDkPrevSelected(dkSelectedId);
    if (dkSelectedId == null && dkPrevSelected != null && dkDetailRef.current && dkPaneShown && !prefersReducedMotion()) {
      setDkClosing({ id: dkPrevSelected });
    } else if (dkClosing) {
      setDkClosing(null);
    }
  }
  // The right pane unmounts on a tab change (or a drop to the phone layout), and a collapse it was
  // running ends with it: left set, coming back mounted the old event again and replayed its close.
  if (dkClosing && !dkPaneShown) setDkClosing(null);
  const dkPhase = dkSelectedId != null ? 'open' : (dkClosing ? 'closing' : null);
  const dkShownId = dkSelectedId ?? (dkClosing && dkClosing.id);
  // The move itself (utils/detail-motion.js): the block's height between 0 and its own natural
  // height, and its opacity, from wherever it is when the move starts (a close mid-open, a new
  // event mid-close). Run before paint, so the block never shows a frame at its natural height
  // first. Only a change of phase or of event starts one: an event swapped for another while the
  // block is settled open glides between the two heights (resizeDetailBlock), and a block mounted again with the pane (back from another
  // tab, the selection kept) shows as it was left, without growing open again.
  const dkPrevPhase = useRef(null);
  // The block's height as last laid out, kept current by a ResizeObserver: when another event is
  // chosen while the block is settled open, the new details are already in the DOM by the time the
  // effect below runs, so this is the only record of how tall the old ones were.
  const dkLastH = useRef(0);
  useEffect(() => {
    const el = dkDetailRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { dkLastH.current = el.getBoundingClientRect().height; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [dkPhase != null]);
  useLayoutEffect(() => {
    const was = dkPrevPhase.current;
    dkPrevPhase.current = dkPhase;
    const el = dkDetailRef.current;
    if (!el || !dkPhase) return;
    if (prefersReducedMotion()) {
      settleDetailBlock(el);
      if (dkPhase === 'closing') setDkClosing(null);
      return;
    }
    // Open to open: another event's details, of another height, glide from the old height to theirs.
    if (was === 'open' && dkPhase === 'open' && !detailBlockMoving(el) && dkLastH.current > 0) {
      resizeDetailBlock(el, dkLastH.current, unitR() || 1);
      return;
    }
    // was == null: the block mounted in this commit, so it opens from nothing.
    const over = moveDetailBlock(el, dkPhase === 'open' ? 'open' : 'close', unitR() || 1, was == null);
    if (over && dkPhase === 'closing') setDkClosing(null);
  }, [dkPhase, dkShownId]);
  // A move has arrived: an open settles to the stylesheet's height, a close unmounts the block.
  // Only the block's own transitions count (a hover inside it bubbles up here too), and only once
  // none of them is still running (height and opacity end on the same frame). A cancelled one
  // counts too, so a close can never be left mounted; one cancelled by the next move is ignored
  // here, since that move is still running (or, if it was instant, already done). Native
  // listeners, attached as the block mounts: React 18 has no onTransitionCancel.
  const onDkDetailMoveEnd = useCallback((e) => {
    const el = e.currentTarget;
    if (e.target !== el || detailBlockMoving(el)) return;
    if (el.dataset.dkMove === 'close') setDkClosing(null);
    else if (el.dataset.dkMove === 'open') settleDetailBlock(el);
  }, []);
  const dkDetailNode = useCallback((node) => {
    const prev = dkDetailRef.current;
    if (prev) ['transitionend', 'transitioncancel'].forEach(ev => prev.removeEventListener(ev, onDkDetailMoveEnd));
    dkDetailRef.current = node;
    if (node) ['transitionend', 'transitioncancel'].forEach(ev => node.addEventListener(ev, onDkDetailMoveEnd));
  }, [onDkDetailMoveEnd]);
  const selectEvent = useCallback((id) => {
    setDkSelectedId(id);
    // The details are the top block of the right pane: bring them into view.
    if (id != null) requestAnimationFrame(() => {
      const sc = document.querySelector('.dk-pane-detail .dk-detail-block');
      if (sc) sc.scrollTop = 0;
    });
  }, []);
  // Portalled panels (the filter panel) live outside the shell, so the layout
  // is also published on <html> for CSS to key on.
  useEffect(() => {
    const el = document.documentElement;
    if (isDesktop) el.dataset.layout = 'desktop'; else delete el.dataset.layout;
  }, [isDesktop]);
  // My Schedule is a pane of the Schedule tab on desktop, not a view of its
  // own. setCurrentView routes every request for it there (dkShowMine); showing
  // it means clearing the selection, since it sits under the event details.
  useEffect(() => {
    dkShowMine.current = isDesktop ? () => setDkSelectedId(null) : null;
  }, [isDesktop]);
  // The one arrival setCurrentView cannot route: the window widening into the
  // desktop layout while My Schedule is the phone's tab. Same path as any tab
  // change, so the list gets back its own saved place rather than inheriting
  // My Schedule's scrollTop on the shared scroller. And a "focus this event"
  // request (the dashboard's Up Next card) becomes a selection.
  useEffect(() => {
    if (!isDesktop) return;
    if (currentView === 'schedule') {
      setCurrentView('tournaments');
      if (!scheduleFocusId) setDkSelectedId(null);
    }
    if (scheduleFocusId) { selectEvent(scheduleFocusId); setScheduleFocusId(null); }
  }, [isDesktop, currentView, scheduleFocusId, dk.tier, selectEvent, setCurrentView]);

  // ── Render: shared schedule page ──
  // A package's page (Features 20), before any sign-in.
  if (PACKAGE_TOKEN) return <Suspense fallback={<LazyFallback />}><PackagePageLazy token={PACKAGE_TOKEN} /></Suspense>;
  // A preparer's read-only tax report (Features 19), before any sign-in.
  if (TAX_LINK_TOKEN) {
    return (
      <div className="app-shell taxlink-shell">
        <main className="content-area"><Suspense fallback={<LazyFallback />}><TaxReportViewLazy preparer={{ token: TAX_LINK_TOKEN }} token={null} /></Suspense></main>
      </div>
    );
  }
  if (SHARED_TOKEN) {
    return <SharedScheduleView shareToken={SHARED_TOKEN} />;
  }

  // ── Render: password reset page ──
  if (RESET_TOKEN) {
    return <ResetPasswordForm resetToken={RESET_TOKEN} theme={theme} toggleTheme={toggleTheme} />;
  }

  // ── Render: a shared hand replay, viewable without an account ──
  // A /h/<id> or #h/ link opens straight into the replayer for anyone. Without
  // this, the login gate below stopped every shared hand at a sign-in wall —
  // the opposite of what a shareable link is for. PATH_HAND_ID means a hand is
  // still being fetched, so show the replayer (with a loading state) rather
  // than the login screen while it resolves.
  if (!token && (PATH_HAND_ID || HAND_SHORTHAND || sharedHandData)) {
    if (sharedHandError && !sharedHandData) {
      return (
        <div className="app-shell hand-link-dead" style={{ height: '100%' }}>
          <div className="hand-link-dead-box">
            <div className="hand-link-dead-mark">futurega.me</div>
            <h1 className="hand-link-dead-title">This hand link doesn&rsquo;t open</h1>
            <p className="hand-link-dead-body">It may have been copied wrong, or the hand is no longer shared.</p>
            <a className="btn btn-primary hand-link-dead-btn" href="/">Open futurega.me</a>
          </div>
        </div>
      );
    }
    return (
      <div className="app-shell" style={{ height: '100%' }}>
        {sharedHandData
          ? <Suspense fallback={<LazyFallback />}>
              <HandReplayerView token={null} heroName="Hero" cardSplay={cardSplay}
                initialHand={sharedHandData} onClearInitialHand={() => {}} linkedReplay
                sharedQuestion={sharedQuestion} onSharedQuestionAnswered={onSharedQuestionAnswered} />
            </Suspense>
          : <LazyFallback />}
      </div>
    );
  }

  // ── Render: auth screens ──
  if (!token) {
    if (authView === 'forgot') {
      return <ForgotPasswordForm
        initialEmail={forgotEmail}
        onBack={() => setAuthView('login')}
        theme={theme}
        toggleTheme={toggleTheme}
      />;
    }
    return <AuthScreen
      onSubmit={handleLogin}
      // Each form opens clean (App improvements 404: Sign In's error followed onto Create Account).
      onModeChange={() => { setError(''); setSuccess(''); }}
      error={error}
      success={success}
      theme={theme}
      toggleTheme={toggleTheme}
      onForgotPassword={(typed) => { setError(''); setSuccess(''); setForgotEmail(typed || ''); setAuthView('forgot'); }}
      onGuestLogin={handleGuestLogin}
      initialRegister={authView === 'register'}
      busy={authBusy}
      onRegisterShown={prefetchSetup}
      invite={pendingInvite()}
      onAppleSignIn={appleAvailable ? handleAppleSignIn : null}
    />;
  }

  // ── Render: main app ──
  // The content area and the two footer rows that sit above the bottom nav.
  // The phone renders this fragment exactly where it always was; the desktop
  // renders it inside the main pane (docs/desktop-layout.md).
  const primaryColumn = (
    <>
          <main className="content-area ptr-container" ref={contentAreaRef} {...ptrProps}>
            <div className={'ptr-indicator' + (refreshing ? ' visible' : '')} ref={ptrIndicator}>
              <div className={'ptr-spinner' + (refreshing ? ' spinning' : '')} />
            </div>

            {/* Tab panels: visited tabs stay mounted, only active is visible */}
            <div className={'tab-panel' + (currentView === 'dashboard' ? ' tab-active' : '')} data-tab="dashboard" style={{display: currentView === 'dashboard' ? undefined : 'none', height: currentView === 'dashboard' ? '100%' : undefined}}>
            <TabErrorBoundary name="Home" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('dashboard') && (!dataLoaded ? <SkeletonDashboard /> :
              <DashboardView
                key={debugTimeKey}
                updatesFailed={updatesFailed}
                onRetryUpdates={fetchMyLiveUpdate}
                demoStates={isAdmin && demoStates}
                demoCard={isAdmin && /[?&]democard(=|&|$)/.test(window.location.search)}
                onOpenInSchedule={(id) => { setScheduleFocusId(id); setCurrentView('schedule'); }}
                mySchedule={scheduleShown}
                myActiveUpdates={myActiveUpdates}
                trackingData={trackingData}
                homeRight={isDesktop ? dkHomeRight : null}
                onPost={postLiveUpdate}
                onDeleteUpdate={deleteLiveUpdate}
                onAddTracking={addTracking}
                isAdmin={isAdmin}
                token={token}
                canLog={!isGuest}
                onLog={logIntoResults}
                bk={bk}
                layout={homeLayout.layout}
                isDesktop={isDesktop}
                onEditHome={isGuest ? null : openHomeEdit}
                onSetPlayed={setNotPlayed}
                onDeleteTracking={deleteTracking}
                tournaments={tournaments}
                shareBuddies={shareBuddies}
                buddyLiveUpdates={buddyLiveUpdates}
                buddyEvents={buddyEvents}
                onToggle={toggleTournament}
                onNavigate={(v) => {
                  if (v === '_liveUpdate') {
                    const btn = document.querySelector('.live-update-btn');
                    if (btn) btn.click();
                    return;
                  }
                  if (v === '_share') {
                    setCurrentView('settings');
                    return;
                  }
                  setCurrentView(v);
                }}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'tournaments' ? ' tab-active' : '')} data-tab="tournaments" style={{display: currentView === 'tournaments' ? undefined : 'none', height: currentView === 'tournaments' ? '100%' : undefined}}>
            <TabErrorBoundary name="Schedule" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('tournaments') && (!dataLoaded ? <SkeletonSchedule /> :
              <TournamentsView
                key={debugTimeKey}
                tournaments={tournaments}
                listLoad={listLoad}
                onRetryList={fetchTournaments}
                mySchedule={scheduleShown}
                onToggle={toggleTournament}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                buddyEvents={buddyEvents}
                onBuddySwap={onBuddySwap}
                isAdmin={isAdmin}
                onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
                token={token}
                onOpenCalendarView={() => setCurrentView('calendar')}
                onSwitchView={switchScheduleView}
                mineCount={mineCount}
                onSelectEvent={isDesktop ? selectEvent : undefined}
                selectedEventId={isDesktop ? dkSelectedId : undefined}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'schedule' ? ' tab-active' : '')} data-tab="schedule" style={{display: currentView === 'schedule' ? undefined : 'none', height: currentView === 'schedule' ? '100%' : undefined}}>
            <TabErrorBoundary name="My schedule" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('schedule') && (!dataLoaded ? <SkeletonSchedule /> :
              <ScheduleView
                key={debugTimeKey}
                token={isGuest ? null : token}
                onNavigate={(v) => setCurrentView(v)}
                onSwitchView={isDesktop ? undefined : switchScheduleView}
                mineCount={mineCount}
                focusTournamentId={scheduleFocusId}
                onFocusConsumed={clearScheduleFocus}
                mySchedule={scheduleShown}
                onToggle={toggleTournament}
                pendingIncoming={pendingIncoming}
                onAcceptRequest={handleAcceptRequest}
                onRejectRequest={handleRejectRequest}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                allTournaments={tournaments}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                onAddPersonalEvent={addPersonalEvent}
                onUpdatePersonalEvent={updatePersonalEvent}
                buddyEvents={buddyEvents}
                onBuddySwap={onBuddySwap}
                isAdmin={isAdmin}
                onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'calendar' ? ' tab-active' : '')} data-tab="calendar" style={{display: currentView === 'calendar' ? undefined : 'none', height: currentView === 'calendar' ? '100%' : undefined}}>
            <TabErrorBoundary name="Calendar" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('calendar') && (
              <CalendarView
                key={debugTimeKey}
                token={token}
                allTournaments={tournaments}
                mySchedule={scheduleShown}
                onToggle={toggleTournament}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                buddyEvents={buddyEvents}
                onOpenScheduleView={() => setCurrentView('tournaments')}
                onSwitchView={switchScheduleView}
                mineCount={mineCount}
                desktop={isDesktop}
                onSelectEvent={isDesktop ? selectEvent : undefined}
                selectedEventId={isDesktop ? dkSelectedId : undefined}
                deepLink={isAdmin ? deepLink : null}
                initialSearch={calendarFind}
                onSearchConsumed={clearCalendarFind}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div data-money-zone="" className={'tab-panel' + (currentView === 'tracking' ? ' tab-active' : '')} data-tab="tracking" style={{display: currentView === 'tracking' ? undefined : 'none', height: currentView === 'tracking' ? '100%' : undefined}}>
            <TabErrorBoundary name="Bankroll" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('tracking') && (
              <TrackingView
                // #tax and #bankroll/<tab> open the page they name (App improvements 456: the prop was never passed).
                deepLink={isAdmin ? deepLink : null}
                isGuest={isGuest}
                onGuestRegister={() => { handleLogout(); setAuthView('register'); }}
                trackingData={trackingData}
                tournaments={tournaments}
                mySchedule={mySchedule}
                onAdd={addTracking}
                onUpdate={updateTracking}
                onDelete={deleteTracking}
                onResetResults={resetResults}
                myActiveUpdates={myActiveUpdates}
                isAdmin={isAdmin}
                token={token}
                bk={bk}
                intent={resultsIntent}
                onIntentDone={clearResultsIntent}
                onLog={logIntoResults}
                trackingState={trackingState}
                onRetryTracking={() => { setTrackingState('loading'); fetchTracking(); }}
                onSetPlayed={setNotPlayed}
                onAddDnp={(date, note) => addPersonalEvent(date, DNP_TYPE, note)}
                onDeleteDnp={toggleTournament}
                sidePane={isDesktop ? dkSideBankroll : null}
                onSplitChange={setBankrollSplit}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'hands' ? ' tab-active' : '')} data-tab="hands" style={{display: currentView === 'hands' ? undefined : 'none', height: currentView === 'hands' ? '100%' : undefined}}>
            <TabErrorBoundary name="Hands" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('hands') && (
                <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
                    {/* The tool selector (Replayer / Solver / …) now lives as a second
                        footer row above the bottom nav — see HANDS_TOOLS below — so it
                        stays put while the tool content scrolls. */}
                    <div style={{flex:1,minHeight:0}}>
                      {handsTool === 'scanner' && isAdmin
                        ? <HandsScanner />
                        : handsTool === 'study' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><StudyHub tool={studyTool} onTool={setStudyTool} fallback={<LazyFallback />}
                            onPlayHand={() => { setDrillAsk(true); setDrillFromStudy(true); setHandsTool('replayer'); }}
                            pendingSolverSpot={pendingSolverSpot} onConsumeSolverSpot={() => setPendingSolverSpot(null)}
                            pendingDrawSpot={pendingDrawSpot} onConsumeDrawSpot={() => setPendingDrawSpot(null)} /></Suspense>
                        : <Suspense fallback={<LazyFallback />}><HandReplayerView token={token} heroName={realName || username || 'Hero'} cardSplay={cardSplay} initialHand={sharedHandData} onClearInitialHand={() => setSharedHandData(null)} onSolveSpot={isAdmin ? (spot => { setPendingSolverSpot(spot); setStudyTool('solve'); setHandsTool('study'); }) : undefined} onStudyDraw={isAdmin ? (spot => { setPendingDrawSpot(spot); setStudyTool('draw'); setHandsTool('study'); }) : undefined} quickAdd={isAdmin} drillEnabled={isAdmin} drillAsk={drillAsk} onDrillAsked={() => setDrillAsk(false)} onDrillBack={drillFromStudy ? (() => { setDrillFromStudy(false); setHandsTool('study'); }) : null} schedule={mySchedule} updates={myActiveUpdates} sidePane={isDesktop ? dkSideHands : null} onSplitChange={setHandsSplit} active={currentView === 'hands'} sharedQuestion={sharedQuestion} onSharedQuestionAnswered={onSharedQuestionAnswered} /></Suspense>}
                    </div>
                  </div>
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'settings' ? ' tab-active' : '')} data-tab="settings" style={{display: currentView === 'settings' ? undefined : 'none', height: currentView === 'settings' ? '100%' : undefined}}>
            <TabErrorBoundary name="Settings" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('settings') && (
              <SettingsView
                onGuestExit={(view) => { handleLogout(); setAuthView(view); }}
                username={username}
                avatar={avatar}
                realName={realName}
                nameMode={nameMode}
                onToggleNameMode={(mode) => { setNameMode(mode); localStorage.setItem('displayNameMode', mode); }}
                onAvatarUpload={handleAvatarUpload}
                onAvatarRemove={handleAvatarRemove}
                theme={theme}
                toggleTheme={toggleTheme}
                pickTheme={pickTheme}
                onFindPeople={() => setCurrentView('social')}
                contrast={contrast}
                toggleContrast={toggleContrast}
                serifFont={serifFont}
                toggleSerifFont={() => setSerifFont(f => SERIF_ORDER[(SERIF_ORDER.indexOf(f) + 1) % SERIF_ORDER.length])}
                onLogout={handleLogout}
                onDebugTimeChange={() => setDebugTimeKey(k => k + 1)}
                shareToken={shareToken}
                onGenerateShareToken={handleGenerateShareToken}
                onRevokeShareToken={handleRevokeShareToken}
                pendingOutgoing={pendingOutgoing}
                onCancelRequest={handleCancelRequest}
                shareBuddies={shareBuddies}
                onRemoveBuddy={handleRemoveBuddy}
                token={token}
                isAdmin={isAdmin}
                seasonLabel={seasonLabel}
                isGuest={isGuest}
                onEditHome={isGuest ? null : openHomeEdit}
                onEditName={isGuest ? undefined : () => setEditingName(true)}
                onToken={replaceToken}
                pushPerm={pushSupported ? pushPerm : 'denied'}
                onEnablePush={isPushAdmin && pushSupported ? subscribeToPush : null}
                onShowCode={isGuest ? null : () => setShowAtTable(true)}
                onBlocksChanged={() => { refreshBlocks(); fetchShareBuddies(); }}
              />
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'admin' ? ' tab-active' : '')} data-tab="admin" style={{display: currentView === 'admin' ? undefined : 'none', height: currentView === 'admin' ? '100%' : undefined}}>
            <TabErrorBoundary name="Admin" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('admin') && isAdmin && (
              <Suspense fallback={<LazyFallback />}><AdminView token={token} onNavigate={(v) => setCurrentView(v)} /></Suspense>
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'batches' ? ' tab-active' : '')} data-tab="batches" style={{display: currentView === 'batches' ? undefined : 'none', height: currentView === 'batches' ? '100%' : undefined}}>
            <TabErrorBoundary name="New Events" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('batches') && isAdmin && (
              <Suspense fallback={<LazyFallback />}>
                <AdminBatchesView
                  token={token}
                  batchId={batchId}
                  onSelectBatch={openBatch}
                  onShowInSchedule={applyFindLink}
                  tournaments={tournaments}
                  mySchedule={scheduleShown}
                  onToggle={toggleTournament}
                  isAdmin={isAdmin}
                  onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                  onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
                />
              </Suspense>
            )}
            </TabErrorBoundary>
            </div>

            <div data-money-zone="" className={'tab-panel' + (currentView === 'cash' ? ' tab-active' : '')} data-tab="cash" style={{display: currentView === 'cash' ? undefined : 'none', height: currentView === 'cash' ? '100%' : undefined}}>
            <TabErrorBoundary name="Cash" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('cash') && isAdmin && (
              <Suspense fallback={<LazyFallback />}><CashView token={token} onModeChange={setCashMode} sidePane={isDesktop ? dkSideCash : null} /></Suspense>
            )}
            </TabErrorBoundary>
            </div>

            <div data-money-zone="" className={'tab-panel' + (currentView === 'staking' ? ' tab-active' : '')} data-tab="staking" style={{display: currentView === 'staking' ? undefined : 'none', height: currentView === 'staking' ? '100%' : undefined}}>
            <TabErrorBoundary name="Staking" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('staking') && (
              isAdmin
                ? <Suspense fallback={<LazyFallback />}><StakingView token={token} tournaments={tournaments} mySchedule={scheduleShown} deepLink={isAdmin ? deepLink : null} /></Suspense>
                : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'calc(var(--subrow) * 7.5) calc(var(--subrow) * 2.5)',textAlign:'center'}}>
                    <h2 style={{fontFamily:"'Univers Condensed', 'Univers', sans-serif",fontSize:'calc(var(--gu) * 1.914)',fontWeight:700,color:'var(--text)',margin:'0 0 calc(var(--subrow) * 1)'}}>Staking</h2>
                    <p style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.325)',margin:0}}>Coming Soon</p>
                  </div>
            )}
            </TabErrorBoundary>
            </div>

            <div className={'tab-panel' + (currentView === 'social' ? ' tab-active' : '')} data-tab="social" style={{display: currentView === 'social' ? undefined : 'none', height: currentView === 'social' ? '100%' : undefined}}>
            <TabErrorBoundary name="Social" onSchedule={() => setCurrentView('tournaments')}>
            {visitedTabs.has('social') && (
              <SocialView
                pendingIncoming={pendingIncoming}
                onAcceptRequest={handleAcceptRequest}
                onRejectRequest={handleRejectRequest}
                shareBuddies={shareBuddies}
                buddyLiveUpdates={buddyLiveUpdates}
                displayName={displayName}
                myGroups={myGroups}
                activeGroupId={activeGroupId}
                setActiveGroupId={setActiveGroupId}
                groupFeed={groupFeed}
                groupSchedule={groupSchedule}
                fetchGroupFeed={fetchGroupFeed}
                fetchGroupSchedule={fetchGroupSchedule}
                fetchMyGroups={fetchMyGroups}
                token={token}
                onRemoveBuddy={handleRemoveBuddy}
                fetchShareBuddies={fetchShareBuddies}
                onShowCode={isGuest ? null : () => setShowAtTable(true)}
                hiddenIds={hiddenIds}
                onBlocked={() => { refreshBlocks(); fetchShareBuddies(); }}
                mySchedule={mySchedule}
                focusBuddyId={socialFocus}
                onFocusUsed={() => setSocialFocus(null)}
              />
            )}
            </TabErrorBoundary>
            </div>

            {swapModalData && (
              <SwapModal
                buddy={swapModalData.buddy}
                tournament={swapModalData.tournament}
                token={token}
                onClose={() => setSwapModalData(null)}
              />
            )}
          </main>

          {/* Portal target for views that need a control bar pinned directly
              above the bottom nav (replayer). Sibling of <BottomNav>, in the
              app-shell flex column — so its bottom edge meets the nav's top
              edge by layout, not by env() math. */}
          <div id="above-nav-slot" />

          {/* A running cash session (beta, admins): its clock over the nav on every tab. */}
          <LiveCashBar enabled={isAdmin} token={token} currentView={currentView} onOpen={() => setCurrentView('tracking')} />

          {/* Hands-tool selector as a second footer row, on top of the primary nav,
              only while the Hands tab is open. One scrolling row so it never grows
              the footer, and it stays put as the tool content scrolls under it. */}
          {/* Grid: rail is 5 subrows tall (3sr pills + 1sr padding each side), 1g side gutter, 1g gaps. */}
          {currentView === 'hands' && isAdmin && (
            <div className="hands-tool-row" style={{display:'flex',gap:'var(--gu)',overflowX:'auto',whiteSpace:'nowrap',background:'var(--bg)',fontFamily:"'Univers Condensed','Univers',sans-serif"}}>
              {/* Each pill a whole-g box (its width in g beside its label), the label centred in it. */}
              {[['replayer','Replayer',6],['study','Study',5],['scanner','Scanner',6]].map(([id,lbl,w]) => (
                (() => { const lit = (drillFromStudy && handsTool === 'replayer' ? 'study' : handsTool) === id; return (
                <button key={id} className="ctl" aria-pressed={lit} onClick={() => { setDrillFromStudy(false); if (id === 'study') setStudyTool(null); setHandsTool(id); }}
                  style={{flex:'0 0 auto',width:`calc(var(--gu) * ${w})`,height:'calc(var(--subrow) * 3)',boxSizing:'border-box',padding:0,borderRadius:'var(--radius)',fontFamily:'inherit',fontSize:'calc(var(--gu) * 1.031)',fontWeight:'var(--fw-bold)',cursor:'pointer',
                    border:'var(--bw-hair) solid ' + (lit ? 'var(--accent)' : 'var(--border)'),
                    background: lit ? 'var(--accent)' : 'transparent',
                    color: lit ? '#fff' : 'var(--text-muted)'}}>
                  {lbl}
                </button>
                ); })()
              ))}
            </div>
          )}
    </>
  );
  // The floating admin toggles, fixed at the foot of the main column's right edge: on the phone
  // the window's corner; on desktop the main pane's, which for the Schedule list is the list pane
  // (its containing block, .dk-fab-scope), so they sit over the list where the phone's do.
  const devToggles = (
    <>
          {isAdmin && gridOverlay && (
            <button
              type="button"
              className={'grid-dev-toggle' + (gridReadout ? ' is-on' : '')}
              title={`${gridReadout ? 'Hide' : 'Show'} grid readout (admin)`}
              aria-pressed={gridReadout}
              onClick={() => setGridReadout(v => { const next = !v; localStorage.setItem('gridReadout', next ? 'on' : 'off'); return next; })}
              style={{ '--dev-up': 19 }}
            >i</button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={'grid-dev-toggle' + (gridOverlay ? ' is-on' : '')}
              title={`${gridOverlay ? 'Hide' : 'Show'} layout grid (admin)`}
              aria-pressed={gridOverlay}
              onClick={() => setGridOverlay(g => { const next = !g; localStorage.setItem('gridOverlay', next ? 'on' : 'off'); return next; })}
            >#</button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={'grid-dev-toggle' + (demoStates ? ' is-on' : '')}
              title={`${demoStates ? 'Hide' : 'Show'} demo dashboard states (admin)`}
              aria-pressed={demoStates}
              onClick={() => setDemoStates(d => !d)}
              style={{ '--dev-up': 13 }}
            >D</button>
          )}
    </>
  );
  // Desktop Schedule tab's secondary panes.
  const dkDetail = isDesktop ? (
    <DesktopEventDetail
      selectedId={dkShownId}
      onSelect={selectEvent}
      tournaments={tournaments}
      mySchedule={scheduleShown}
      onToggle={toggleTournament}
      onSetCondition={setCondition}
      onRemoveCondition={removeCondition}
      onToggleAnchor={toggleAnchor}
      onSetPlannedEntries={setPlannedEntries}
      onUpdatePersonalEvent={updatePersonalEvent}
      buddyEvents={buddyEvents}
      onBuddySwap={onBuddySwap}
      isAdmin={isAdmin}
      onAdminEdit={canEditEvents ? adminEditTournament : undefined}
      onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
    />
  ) : null;
  const dkMine = isDesktop ? (!dataLoaded ? <SkeletonSchedule /> : (
    <ScheduleView
      key={debugTimeKey}
      onNavigate={(v) => setCurrentView(v)}
      mySchedule={scheduleShown}
      onToggle={toggleTournament}
      pendingIncoming={pendingIncoming}
      onAcceptRequest={handleAcceptRequest}
      onRejectRequest={handleRejectRequest}
      onSetCondition={setCondition}
      onRemoveCondition={removeCondition}
      allTournaments={tournaments}
      onToggleAnchor={toggleAnchor}
      onSetPlannedEntries={setPlannedEntries}
      onAddPersonalEvent={addPersonalEvent}
      onUpdatePersonalEvent={updatePersonalEvent}
      buddyEvents={buddyEvents}
      onBuddySwap={onBuddySwap}
      isAdmin={isAdmin}
      onAdminEdit={canEditEvents ? adminEditTournament : undefined}
      onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
      onSelectEvent={selectEvent}
      selectedEventId={dkSelectedId}
    />
  )) : null;
  // The phone's bottom nav and the desktop rail run this one handler, so the two behave alike.
  // Choosing Schedule while already on it scrolls the list back to today (landListOnToday); this
  // used to live only in BottomNav's onChange, and the rail did nothing. Today is looked up in the
  // list's own panel: on desktop My Schedule (the right pane) carries a [data-today-scroll] too.
  /* A tab answers the tap in its first frame (UX pick 46): the bar lights at once and the view, whose
     render is the slow part, follows as a transition. */
  /* Which tab's second pane is showing (desktop): Hands while its list and replay are split, Cash for
     the admins who have it. Every other tab's main pane runs to the shell's right edge (UX pick 107). */
  const handsOnReplayer = !(isAdmin && (handsTool === 'scanner' || handsTool === 'study'));
  const dkSideTab = !isDesktop ? null
    : currentView === 'hands' && handsOnReplayer && handsSplit ? 'hands'
    : currentView === 'cash' && isAdmin ? 'cash'
    : currentView === 'tracking' && bankrollSplit ? 'bankroll' : null;
  const onNavChange = (v) => {
    if (v === currentView && v === 'tournaments') { landListOnToday(); return; }
    navPushRef.current = true;   // a tab pressed is a step Back can undo (453)
    setNavPending(v);
    startTransition(() => setCurrentView(v));
  };
  return (
    <DisplayNameProvider value={displayName}>
    <div
      className={'app-shell' + (isDesktop ? ' is-desktop dk-' + dk.tier : '')}
      style={isDesktop ? { '--dk-shell-n': dk.shellG, '--dk-detail-n': dk.detailCols, '--dk-wide-n': dk.wideCols, '--dk-sb-g': dk.sbG, '--dk-ov-g': dk.ovG } : undefined}
    >
      <header className="top-bar">
        <div className="top-bar-title">
          <h1 ref={wordmarkRef}>futurega<span className="wm-dot">.</span>me</h1>
          {/* The cash tab is not seasonal, so its subtitle names the tab instead of the
              season's date range. The h2 inside CashView is dropped in favour of this. */}
          {currentView === 'cash' ? <small>{cashMode === 'heatmap' ? 'cash game history' : 'live cash games'}</small>
            : currentView === 'hands' ? <small>{handsTool === 'study' ? 'study' : handsTool === 'scanner' ? 'table scanner' : 'hands archive'}</small>
            : currentView === 'dashboard' ? <small>home</small>
            : currentView === 'tracking' ? <small>bankroll</small>
            : currentView === 'social' ? <small>social</small>
            : currentView === 'staking' ? <small>staking</small>
            : currentView === 'settings' ? <small>settings</small>
            : currentView === 'admin' ? <small>admin</small>
            : currentView === 'batches' ? <small>new events</small>
            : (seasonLabel ? <AlternatingSubtitle labels={[seasonLabel, 'scheduler']} /> : null)}
          {/* The Swiss theme's running head (theme-swiss.css; hidden in every other theme). */}
          <small className="sw-runhead">{swissRunningHead}</small>
        </div>
        <div className="top-bar-actions">
          <button
            className="notif-btn btn btn-ghost btn-icon"
            onClick={() => {
              setShowNotifications(prev => {
                if (!prev) markNotificationsSeen();
                return !prev;
              });
            }}
            title="Notifications"
            aria-label={notifCount > 0 ? `Notifications, ${notifCount} new` : 'Notifications'}
            aria-expanded={!!showNotifications}
          >
            <Icon.bell />
            {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
          </button>
          <LiveUpdatePanel
            mySchedule={scheduleShown}
            myActiveUpdates={myActiveUpdates}
            onPost={postLiveUpdate}
            onAddTracking={addTracking}
          />
          <ThemeButton theme={theme} nextThemeLabel={nextThemeLabel} onToggle={toggleTheme} />
        </div>
        <div className="top-bar-user">
          <button className="username-chip snap-g" onClick={() => setShowUserMenu(m => !m)} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',background:'none',border:'none',padding:0,cursor:'pointer',overflow:'hidden'}}>
            <Avatar src={avatar} username={username} size={22} style={{flexShrink:0}} />
            {/* A real name shortens by the house order (FitName: "E. Bennett", then "Bennett") before
                it is ever cut; it read "Ethan Be…" (owner, 2026-10-20). A username is one word. */}
            {nameMode === 'username' || !realName
              ? <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{username}</span>
              : <FitName name={realName} />}
          </button>
          {showUserMenu && createPortal(
            <>
              <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={() => setShowUserMenu(false)} />
              {/* On the grid (owner rule, 2026-10-10): 16g wide, its right edge on the shell's 1g
                  margin — the shell is centred in the window (37g, or dk.shellG on desktop), so
                  half the window less half the shell, plus 1g — its top on 7r under the bar. The
                  ring is an inset shadow, not a border, so the 5r rows inside start on the box's
                  own lines. */}
              <div style={{position:'fixed',top:'calc(var(--sa-t) + var(--subrow) * 7)',right:`calc(50% - var(--gu) * ${isDesktop ? dk.shellG : 37} / 2 + var(--gu))`,zIndex:9999,background:'var(--surface)',borderRadius:'calc(var(--subrow) * 1)',padding:0,width:'calc(var(--gu) * 16)',boxSizing:'border-box',boxShadow:'inset 0 0 0 var(--bw-hair) var(--border), 0 calc(var(--subrow) * 1) calc(var(--subrow) * 3) rgba(0,0,0,0.4)',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
                {/* Who is signed in (UX pick 49): a 7r head, the avatar beside "E. Bennett" over @username. */}
                <div className="um-head">
                  <Avatar src={avatar} username={authUsername || username} size={0} style={{ width: 'calc(var(--subrow) * 4)', height: 'calc(var(--subrow) * 4)', fontSize: 'var(--fs-xs)' }} />
                  <span className="um-who">
                    <span className="um-name">{initialName(realName, authUsername || username)}</span>
                    <span className="um-handle">@{authUsername || username} · Signed in</span>
                  </span>
                </div>
                {/* Yours first, the admin tools under their own caption, Sign out last (UX picks 49, 99); each
                    row with the rail's icon. On desktop the rail has the rest: Settings and Sign out only. */}
                {(() => {
                  const go = (v) => () => { setShowUserMenu(false); v === 'batches' ? openBatch(null) : setCurrentView(v); };
                  const row = (id, label, Glyph, onClick) => (
                    <button key={id} type="button" className="um-row" onClick={onClick}>
                      <span className="um-icon" aria-hidden="true"><Glyph /></span><span className="um-label">{label}</span>
                    </button>
                  );
                  const mine = [
                    !isDesktop && row('social', 'Social', Icon.people, go('social')),
                    !isDesktop && handReplayerAccess && !isAdmin && row('hands', 'Hand Replayer', Icon.cards, go('hands')),
                    row('settings', 'Settings', Icon.gear, go('settings')),
                    !isGuest && row('report', 'Report a problem', Icon.warn, () => { setShowUserMenu(false); setShowReport(true); }),
                  ].filter(Boolean);
                  const admin = isAdmin && !isDesktop ? [
                    row('staking', 'Staking', Icon.handshake, go('staking')),
                    row('admin', evalPct != null ? `Admin \u00b7 eval ${evalPct}%` : 'Admin', Icon.lock, go('admin')),
                    row('batches', 'New Events', Icon.bell, go('batches')),
                  ] : [];
                  return (
                    <>
                      {mine}
                      {admin.length > 0 && <><div className="um-rule" /><div className="um-caption">Admin</div>{admin}</>}
                    </>
                  );
                })()}
                <div className="um-rule" />
                <button type="button" className="um-row um-signout" onClick={() => { setShowUserMenu(false); handleLogout(); }}>
                  <span className="um-label">Sign out</span>
                </button>
              </div>
            </>,
            document.body
          )}
        </div>
      </header>

      {isGuest && (
        /* Classed so the full-bleed replayer can hide it: a banner about
           saving schedules has nothing to say over a hand replay. */
        <div className="guest-banner" style={{background:'var(--accent)',color:'#000',padding:'calc(var(--subrow) * 1) calc(var(--subrow) * 2)',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'calc(var(--gu) * 1.178)',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
          <span>{guestPicks.length
            ? `Create an account to keep your ${guestPicks.length} saved event${guestPicks.length === 1 ? '' : 's'}`
            : 'Browsing as a guest. An account keeps your schedule.'}</span>
          <button className="guest-banner-btn snap-g" onClick={() => { handleLogout(); setAuthView('register'); }}>
            Create account
          </button>
        </div>
      )}

      {(showRealNamePrompt || editingName) && (
        <RealNamePrompt
          token={token}
          initialName={editingName ? (realName || '') : undefined}
          onSave={(name) => { setRealName(name); localStorage.setItem('realName', name); setShowRealNamePrompt(false); setEditingName(false); }}
          onDismiss={() => { setShowRealNamePrompt(false); setEditingName(false); }}
        />
      )}

      {/* Setup waits behind the real-name prompt so a brand-new user answers
          one at a time rather than seeing two stacked modals. A first run that
          finishes lands on the Schedule it just set up; a re-run stays put. */}
      {showOnboarding && !showRealNamePrompt && !editingName && (
        <Suspense fallback={null}><OnboardingWizard
          token={token}
          isGuest={isGuest}
          tournaments={tournaments}
          firstRun={onboardingFirstRun}
          onDone={(res) => {
            setShowOnboarding(false);
            if (res && res.applied && onboardingFirstRun) setCurrentView('tournaments');
          }}
        /></Suspense>
      )}

      {showReport && (
        <Suspense fallback={null}><ReportProblemSheet token={token} view={currentView} onClose={() => setShowReport(false)} /></Suspense>
      )}
      {showAtTable && (
        <Suspense fallback={null}><AtTableSheet token={token} name={realName || username} onClose={() => setShowAtTable(false)} onConnected={fetchShareBuddies} /></Suspense>
      )}
      {!isGuest && <AppLockVeil />}
      {showSearch && (
        <Suspense fallback={null}>
          <SearchEverything open={showSearch} onClose={() => setShowSearch(false)} token={token}
            tournaments={tournaments} mySchedule={mySchedule} buddies={shareBuddies} groups={myGroups}
            onEvent={(t) => { setCurrentView('tournaments'); if (isDesktop) selectEvent(t.id); }}
            onHand={() => setCurrentView('hands')}
            onPerson={(b) => { setSocialFocus(b.id); setCurrentView('social'); }}
            onGroup={(g) => { setCurrentView('social'); setActiveGroupId(g.id); fetchGroupFeed(g.id); }}
            onSettings={() => setCurrentView('settings')} />
        </Suspense>
      )}
      {showNotifications && (
        <NotificationsPanel
          notifications={notifications}
          token={token}
          onClose={() => setShowNotifications(false)}
          fetchNotifications={fetchNotifications}
          fetchShareBuddies={fetchShareBuddies}
          fetchMyGroups={fetchMyGroups}
          onEnablePush={isPushAdmin && pushSupported && pushPerm === 'default' ? subscribeToPush : null}
          onOpenUrl={openAppUrl}
        />
      )}

      {/* One element tree for both layouts, so the main column (the list's scroller and the list)
          sits at the same place in it either way and crossing 1024 wide never remounts it: a
          remount dropped the scroll position and the list landed back on today. On the phone the
          two wrappers are display: contents (.layout-contents), so the column lays out in
          .app-shell exactly as it did without them. */}
      <div className={isDesktop ? 'dk-body' : 'layout-contents'}>
          {isDesktop && (
            <DesktopRail
              isAdmin={isAdmin}
              evalPct={evalPct}
              current={(navPending || currentView) === 'schedule' || (navPending || currentView) === 'calendar' ? 'tournaments' : (navPending || currentView)}
              onChange={v => (v === 'batches' ? openBatch(null) : onNavChange(v))}
            />
          )}
          <div className={!isDesktop ? 'layout-contents' : 'dk-pane dk-pane-main ' + (currentView === 'tournaments' || currentView === 'calendar' ? 'dk-pane-list dk-fab-scope' : currentView === 'dashboard' ? 'dk-pane-home' : dkSideTab ? 'dk-pane-split' : 'dk-pane-wide')}>
            {primaryColumn}
            {devToggles}
            {/* The Results tab's floating +: a direct child of the main pane, so on desktop it sits
                in that pane (bankroll-fab.css). Guests cannot log results. */}
            {currentView === 'tracking' && !isGuest && <BankrollFab scope="page" isAdmin={isAdmin} onPick={logIntoResults} />}
          </div>
          {/* The home's second pane (docs/desktop-layout.md "Dashboard"): Up Next and the rest of
              NOW stay in the main pane; the NUMBERS column (the period block, later Trend) is
              portalled in here by DashboardView. Mounted for the whole desktop session and only
              hidden off the Dashboard, so the portal's content keeps its state across tabs.
              Desktop only, by its own guard too: master renders one element tree for both
              layouts (79a82c3), and in that tree an unguarded pane showed on the phone, an empty
              15px box over the home's foot. */}
          {isDesktop && (
            <div className="dk-pane dk-pane-mine" style={currentView === 'dashboard' ? undefined : { display: 'none' }}>
              <div className="dk-scroll dk-home-right" ref={setDkHomeRight} />
            </div>
          )}
          {/* Hands' and Cash's second pane (UX picks 68, 107): the replay beside the saved hands, the
              heatmaps beside Live. Mounted for the whole desktop session, like the home's, so what is
              portalled in keeps its state across tabs. */}
          {isDesktop && (
            <div className="dk-pane dk-pane-side" style={dkSideTab ? undefined : { display: 'none' }}>
              <div className="dk-side-host" ref={setDkSideHands} style={dkSideTab === 'hands' ? undefined : { display: 'none' }} />
              <div className="dk-side-host" ref={setDkSideCash} style={dkSideTab === 'cash' ? undefined : { display: 'none' }} />
              <div data-money-zone="" className="dk-side-host dk-scroll dk-side-bankroll" ref={setDkSideBankroll} style={dkSideTab === 'bankroll' ? undefined : { display: 'none' }} />
            </div>
          )}
          {/* One right pane, two blocks (owner, 2026-10-10: My Schedule goes UNDER the event details,
              not in a third column): the selected event on top, My Schedule below it in the same
              scroll. With nothing selected, My Schedule is the whole pane. */}
          {dkPaneShown && (
            <div className="dk-pane dk-pane-detail dk-fab-scope">
              {/* Two scrollers, not one: My Schedule lands on the next event by scrolling ITS
                  scroller (ScheduleView resolves the nearest .dk-scroll), which must not drag the
                  event details out of view, nor be reset when an event is selected. */}
              {dkPhase && (
                <div
                  ref={dkDetailNode}
                  className={'dk-scroll dk-detail-block' + (dkPhase === 'closing' ? ' is-closing' : '')}
                >{dkDetail}</div>
              )}
              {/* Two columns of cards where the pane is 64g or wider (UX pick 26). */}
              <div className={'dk-scroll dk-mine-block' + (dk.detailCols >= 7 ? ' is-two-col' : '')}>{dkMine}</div>
            </div>
          )}
      </div>

      {!isDesktop && (
        <BottomNav
          isAdmin={isAdmin}
          current={(() => {
            const cv = navPending || currentView;
            if (cv === 'hands' && isAdmin) return 'hands';
            if (cv === 'calendar' || cv === 'schedule') return 'tournaments';
            if (['social', 'settings', 'hands', 'admin', 'batches'].includes(cv)) return null;
            return cv;
          })()}
          onChange={onNavChange}
        />
      )}

      {activeMilestone && (
        <MilestoneCelebration
          milestone={activeMilestone}
          onShare={() => setActiveMilestone(null)}
          onDismiss={() => setActiveMilestone(null)}
        />
      )}

      {/* Edit home (components/HomeEditSheet.jsx): portalled to the body while open. */}
      {homeEdit && !isGuest && (
        <Suspense fallback={null}>
          <HomeEditSheet layout={homeLayout.layout} set={homeLayout.set} status={homeLayout.status}
            ctx={homeCtx} isDesktop={isDesktop} onClose={closeHomeEdit} />
        </Suspense>
      )}

      {/* Admin-only layout grid: a faint overlay of the real content grid plus a
          floating toggle, so alignment can be checked live and layout fixes made
          by eye. Gated on isAdmin; state persists in localStorage. */}
      {isAdmin && gridOverlay && <Suspense fallback={null}><GridOverlay showReadout={gridReadout} /></Suspense>}
    </div>
    </DisplayNameProvider>
  );
}

// The entry point: a backer link renders its page alone (components/BackerPage.jsx), so App's
// hooks (the session, the schedule fetches, push for admins) never run for it.
// futurega.me/live: the live-only landing page the ads link to (launch plan; server.js serveLive).
const IS_LIVE_PAGE = window.location.pathname.replace(/[/]+$/, '') === '/live';

export default function Root() {
  if (BACKER_TOKEN) return <Suspense fallback={null}><BackerPage token={BACKER_TOKEN} /></Suspense>;
  if (IS_LIVE_PAGE) return <Suspense fallback={null}><LivePage /></Suspense>;
  return <App />;
}
