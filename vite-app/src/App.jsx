import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import AlternatingSubtitle from './components/AlternatingSubtitle.jsx';
import { createPortal } from 'react-dom';

import { API_URL } from './utils/api.js';
import { resetPath } from './utils/reset-results.js';
import { haptic, THEME_ORDER, THEME_LABEL, THEME_ICON, THEME_META, SERIF_FONTS, SERIF_ORDER, VENUE_BRAND_VAR, getVenueBrandColor, formatSeasonLabel, registerRowTimezones, registerVenueCoords, getDebugNow, setDebugNow } from './utils/utils.js';
import { decodeHand } from './utils/hand-shorthand.js';
import { detectMilestones } from './utils/milestones.js';
import { moveDetailBlock, settleDetailBlock, detailBlockMoving, resizeDetailBlock } from './utils/detail-motion.js';
import usePullToRefresh from './hooks/usePullToRefresh.js';

import { useToast } from './contexts/ToastContext.jsx';
import { useDisplayName, DisplayNameProvider } from './contexts/DisplayNameContext.jsx';

import Icon from './components/Icon.jsx';
import Avatar from './components/Avatar.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import ForgotPasswordForm from './components/ForgotPasswordForm.jsx';
import ResetPasswordForm from './components/ResetPasswordForm.jsx';
import BottomNav from './components/BottomNav.jsx';
import GridOverlay from './components/GridOverlay.jsx';
import DesktopRail from './components/DesktopRail.jsx';
import DesktopEventDetail from './components/DesktopEventDetail.jsx';
import useDesktopLayout from './hooks/useDesktopLayout.js';
import useBankrolls from './hooks/useBankrolls.js';
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
import ScheduleExportModal from './components/ScheduleExportModal.jsx';
import SharedScheduleView from './components/SharedScheduleView.jsx';
import BackerPage from './components/BackerPage.jsx';
import { backerTokenFromPath } from './utils/backer-page.js';
import SkeletonDashboard from './components/SkeletonDashboard.jsx';
import SkeletonSchedule from './components/SkeletonSchedule.jsx';
import RealNamePrompt from './components/RealNamePrompt.jsx';
import OnboardingWizard from './components/OnboardingWizard.jsx';
import { hasOnboarded, readLocalLocation, readLocalFilters } from './utils/location-prefs.js';
import NotificationsPanel from './components/NotificationsPanel.jsx';
import SwapModal from './components/SwapModal.jsx';
import MilestoneCelebration from './components/MilestoneCelebration.jsx';

// Code-split the heaviest views (replayer alone is ~4.5k LOC) so the main
// bundle drops by several hundred KB. Each loads on first navigation to
// its tab; subsequent visits are cached by the browser.
const HandReplayerView = lazy(() => import('./components/HandReplayerView.jsx'));
const SolverTrainerView = lazy(() => import('./components/SolverTrainerView.jsx'));
const SolverPlayView = lazy(() => import('./components/SolverPlayView.jsx'));
const SolverView = lazy(() => import('./components/SolverView.jsx'));
const RazzTrainerView = lazy(() => import('./components/RazzTrainerView.jsx'));
const Multiway3TrainerView = lazy(() => import('./components/Multiway3TrainerView.jsx'));
const StakingView = lazy(() => import('./components/StakingView.jsx'));
const AdminView = lazy(() => import('./components/AdminView.jsx'));
const AdminBatchesView = lazy(() => import('./components/AdminBatchesView.jsx'));
const CashView = lazy(() => import('./components/CashView.jsx'));

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
const HAND_SHORTHAND = HAND_MATCH ? decodeURIComponent(HAND_MATCH[1]) : null;

// Server-backed short link: /h/<id>. Unlike the self-contained #h/ fragment, this
// needs a fetch to resolve, handled in an effect below.
const PATH_HAND_MATCH = window.location.pathname.match(/^\/h\/([A-Za-z0-9]{1,16})$/);
const PATH_HAND_ID = PATH_HAND_MATCH ? PATH_HAND_MATCH[1] : null;

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

// The admin gates below read the username claim INSIDE the signed session token, never the
// 'username' storage key: that key is plain localStorage, and setting it to 'ham' by hand used to
// unlock every admin surface (Hands/Solver, Staking, Admin, Cash, the grid and demo toggles) on a
// session that kept working. A hand-made token can claim any name too, but the server refuses it
// on the first authenticated call and guardedFetch signs the session out. Display still uses the
// stored username; only authorisation-shaped decisions use this.
// One r in CSS px, measured (r is a calc of the viewport width, rounded to 1/64 px).
function subrowPx() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:calc(var(--subrow) * 100)';
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect().height / 100;
  probe.remove();
  return r || 1;
}

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

const APP_ADMIN_USERNAMES = ['ham', 'ham5', 'claude'];   // mirrors server.js APP_ADMIN_USERNAMES
const EVENT_EDITOR_USERNAMES = ['ham', 'ham5'];          // mirrors the server's write allowlist
function tokenUsername(tok) {
  try {
    const part = String(tok || '').split('.')[1];
    if (!part) return '';
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (!claims || claims.isGuest) return '';
    return typeof claims.username === 'string' ? claims.username.toLowerCase() : '';
  } catch { return ''; }
}

// debugNow (utils.js) is the admin-only simulated clock. It lives in localStorage and getNow()
// honours it for whoever is signed in, so a value an admin left behind (or anyone typed in)
// shifted every date in the app for a normal user. Drop it before the first render unless the
// stored session is an admin's; the effect in App covers sign-in/out without a reload.
try {
  const bootToken = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (getDebugNow() && !APP_ADMIN_USERNAMES.includes(tokenUsername(bootToken))) setDebugNow('');
} catch { /* storage unavailable — nothing persisted to clear */ }

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || sessionStorage.getItem('token'));
  const [username, setUsername] = useState(localStorage.getItem('username') || sessionStorage.getItem('username'));
  const [isGuest, setIsGuest] = useState(localStorage.getItem('isGuest') === 'true');
  const [authView, setAuthView] = useState('login');
  const [currentView, _setCurrentView] = useState('dashboard');
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
  const [visitedTabs, setVisitedTabs] = useState(new Set(['dashboard']));
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
        requestAnimationFrame(() => {
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
          }
          const panel = c && c.querySelector('.tab-panel.tab-active');
          if (panel) {
            panel.style.animation = 'none';
            panel.offsetHeight;
            panel.style.animation = '';
          }
        });
      }
      return v;
    });
  }, []);

  const [tournaments, setTournaments] = useState([]);
  // Header subtitle — the months the loaded feed actually spans, so it tracks
  // the window instead of naming a season that goes stale.
  const seasonLabel = useMemo(() => formatSeasonLabel(tournaments), [tournaments]);
  const [mySchedule, setMySchedule] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [gameVariants, setGameVariants] = useState([]);
  const [venues, setVenues] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [uploadVenue, setUploadVenue] = useState('');
  const [debugTimeKey, setDebugTimeKey] = useState(0);

  // Avatar
  const [avatar, setAvatar] = useState(localStorage.getItem('avatar') || null);

  // Hand replayer access
  const [handReplayerAccess, setHandReplayerAccess] = useState(localStorage.getItem('handReplayerAccess') === 'true');

  // Hands tab tool: hand replayer or CFR solver trainer
  const [handsTool, setHandsTool] = useState('replayer');

  // "Solve this spot" handoff: a frozen replayer spot, mapped to
  // SolverView's inputs. Set by the replayer's Solve-this-spot button
  // (which also flips handsTool → 'solver'); consumed + cleared by
  // SolverView on mount/update.
  const [pendingSolverSpot, setPendingSolverSpot] = useState(null);

  // Cash tab's Live / Heatmaps mode, for the top bar's subtitle. CashView owns and persists
  // it ('cashMode'); this reads the same key so the first paint is already right.
  const [cashMode, setCashMode] = useState(() => { try { return localStorage.getItem('cashMode') || 'live'; } catch { return 'live'; } });

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
  // First-run filter wizard: auto-opens once for a logged-in (non-guest) user who
  // hasn't been through it. Re-openable later via a 'reopen-onboarding' window event
  // (fired from the location menu), which bypasses the once-only flag.
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    // Auto-open only for genuinely new users: logged in, not a guest, never onboarded,
    // and no filters/location already chosen — so existing users aren't nagged.
    if (token && !isGuest && !hasOnboarded() && !readLocalLocation() && !readLocalFilters()) {
      setShowOnboarding(true);
    }
  }, [token, isGuest]);
  useEffect(() => {
    const reopen = () => setShowOnboarding(true);
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
  const [lastSeenShares, setLastSeenShares] = useState(null);
  const [buddyEvents, setBuddyEvents] = useState({});
  const [swapModalData, setSwapModalData] = useState(null);
  const onBuddySwap = useCallback((buddy, tournament) => setSwapModalData({ buddy, tournament }), []);
  const [newShareCount, setNewShareCount] = useState(0);
  const [shareError, setShareError] = useState('');
  const [shareSuccess, setShareSuccess] = useState('');

  // Tracking
  const [trackingData, setTrackingData] = useState([]);
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
  const [groupFeed, setGroupFeed] = useState([]);
  const [groupSchedule, setGroupSchedule] = useState([]);

  // Notifications
  const [notifications, setNotifications] = useState({ groupInvites: [], buddyRequests: [], acceptedBuddies: [] });
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Milestones
  const [activeMilestone, setActiveMilestone] = useState(null);

  // Theme
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [contrast, setContrast] = useState(localStorage.getItem('contrast') || 'normal');
  const [cardSplay, setCardSplay] = useState(localStorage.getItem('cardSplay') !== 'off');
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[theme] || '#111111');

    // The <meta> above does nothing inside a Capacitor WKWebView, and
    // capacitor.config.json pins the bar to a static dark style — so switching
    // to light or cloudy left light glyphs on a near-white app. The plugin was
    // in package.json and never imported. Driven off the same THEME_META map
    // that feeds the meta tag, so the two cannot drift.
    if (window.Capacitor?.isNativePlatform?.()) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        const light = theme === 'light' || theme === 'cloudy';
        StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
        StatusBar.setBackgroundColor({ color: THEME_META[theme] || '#111111' }).catch(() => {});
      }).catch(() => {});
    }
  }, [theme]);


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
  useEffect(() => {
    if (!PATH_HAND_ID) return;
    fetch(`${API_URL}/hand-links/${PATH_HAND_ID}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.shorthand) return;
        const decoded = decodeHand(d.shorthand);
        if (!decoded) return;
        setSharedHandData(decoded);
        setSharedHandArrived(true);
        setCurrentView('hands');
        // The /h/<id> address stays while the hand is open (it used to be replaced with '/'
        // right here), so sharing the page from the browser, or reloading it, keeps the hand and
        // its preview title instead of the bare site with the season title. It goes back to '/'
        // when the shared hand is closed — the effect below.
        sharedPathShown.current = true;
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sharedHandData || !sharedPathShown.current) return;
    if (/^\/h\//.test(window.location.pathname) && window.history.replaceState) window.history.replaceState(null, '', '/');
    sharedPathShown.current = false;
  }, [sharedHandData]);

  // Listen for hashchange to handle #h/ hand links without full reload
  useEffect(() => {
    const onHashChange = () => {
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

  const toggleTheme = () => setTheme(t => {
    const i = THEME_ORDER.indexOf(t);
    return THEME_ORDER[(i + 1) % THEME_ORDER.length];
  });
  const nextThemeLabel = THEME_LABEL[THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]];
  const toggleContrast = () => setContrast(c => c === 'normal' ? 'high' : 'normal');

  // ── Auto-logout on 401/403 ──
  const guardedFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
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
      const data = await res.json();
      registerVenueCoords(await coordsP);
      // Before render: every start time and zone label reads the zone the row declares.
      registerRowTimezones(Array.isArray(data) ? data : []);
      setTournaments(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch tournaments:', e); toast.error('Failed to load tournaments'); }
  };

  const fetchMySchedule = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/my-schedule`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
      setMySchedule(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch schedule:', e); setMySchedule([]); }
  };

  const fetchGameVariants = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/game-variants`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
      setGameVariants(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch game variants:', e); }
  };

  const fetchVenues = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/venues`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
      setVenues(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch venues:', e); }
  };

  const fetchTracking = async () => {
    try {
      const res = await fetch(`${API_URL}/tracking`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setTrackingData(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch tracking:', e); toast.error('Failed to load tracking data'); }
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

  const fetchMyLiveUpdate = async () => {
    try {
      const res = await guardedFetch(`${API_URL}/live-updates/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
      setMyActiveUpdates(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Fetch live updates:', e); }
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
    } catch (e) { console.error('Post live update:', e); }
  }, [token]);

  const deleteLiveUpdate = useCallback(async (updateId) => {
    try {
      const res = await fetch(`${API_URL}/live-update/${updateId}`, {
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
        setError(err.error || 'Failed to add tracking entry');
        return { ok: false, status: res.status };
      }
      const made = await res.json().catch(() => ({}));
      if (totalFieldSize) await saveFieldSize(data.tournamentId, totalFieldSize);
      fetchTracking();

      if (milestones.length > 0) {
        setActiveMilestone(milestones[0]);
      }
      return { ok: true, status: res.status, id: made && made.id };
    } catch { setError('Failed to add tracking entry'); return { ok: false, status: 0 }; }
  }, [token, tournaments, mySchedule, trackingData]);

  // The home's To log "Didn't play" (true) and its Undo (false): user_schedules.not_played, so it
  // syncs across devices. Resolves true when stored.
  const setNotPlayed = useCallback(async (tournamentId, notPlayed) => {
    try {
      const res = await fetch(`${API_URL}/schedule/${tournamentId}/played`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notPlayed: !!notPlayed })
      });
      if (!res.ok) return false;
      setMySchedule(prev => prev.map(t => (t.id === tournamentId ? { ...t, not_played: notPlayed ? 1 : 0 } : t)));
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
        const err = await res.json();
        setError(err.error || 'Failed to update tracking entry');
        return;
      }
      if (totalFieldSize && tournamentId) await saveFieldSize(tournamentId, totalFieldSize);
      fetchTracking();
    } catch { setError('Failed to update tracking entry'); }
  }, [token]);

  // Resolves true when deleted (the home's To log Undo checks it).
  const deleteTracking = useCallback(async (entryId) => {
    try {
      const res = await fetch(`${API_URL}/tracking/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchTracking();
      return res.ok;
    } catch { setError('Failed to delete tracking entry'); return false; }
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
      const lss = data.lastSeenShares || null;
      setLastSeenShares(lss);
      const newBuddies = (data.buddies || []).filter(b => !lss || b.since > lss).length;
      setNewShareCount(newBuddies + (data.pendingIncoming || []).length);
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
        setGroupSchedule(Array.isArray(data) ? data : []);
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

  const notifCount = notifications.groupInvites.length + notifications.buddyRequests.length + notifications.acceptedBuddies.length;

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

  const handleSendShareRequest = async (e) => {
    e.preventDefault();
    const uname = new FormData(e.target).get('shareUsername');
    if (!uname) return;
    try {
      const res = await fetch(`${API_URL}/share-request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname })
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(data.message);
      e.target.reset();
      fetchShareBuddies();
    } catch { toast.error('Failed to send request'); }
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
    const usernameInput = fd.get('username');
    const realNameInput = fd.get('realName');

    try {
      const endpoint = isRegister ? '/register' : '/login';
      const body = isRegister
        ? { username: usernameInput, email, password, realName: realNameInput }
        : { email, password };

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Authentication failed'); return; }

      if (isRegister) {
        setSuccess('Account created! Please sign in.');
      } else {
        const store = keepSignedIn ? localStorage : sessionStorage;
        store.setItem('token', data.token);
        store.setItem('username', data.username);
        if (data.avatar) store.setItem('avatar', data.avatar);
        else store.removeItem('avatar');
        if (data.realName) store.setItem('realName', data.realName);
        else store.removeItem('realName');
        store.setItem('handReplayerAccess', data.handReplayerAccess ? 'true' : 'false');
        if (!keepSignedIn) localStorage.setItem('sessionOnly', 'true');
        setToken(data.token);
        setUsername(data.username);
        setAvatar(data.avatar || null);
        setRealName(data.realName || null);
        setHandReplayerAccess(!!data.handReplayerAccess);
        if (!data.realName) setShowRealNamePrompt(true);
      }
    } catch { setError('Network error. Please try again.'); }
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
    setCurrentView('dashboard');
    setTournaments([]);
    setMySchedule([]);
    setShareToken(null);
    setShareBuddies([]);
    setPendingIncoming([]);
    setPendingOutgoing([]);
    setLastSeenShares(null);
    setNewShareCount(0);
    setNotifications({ groupInvites: [], buddyRequests: [], acceptedBuddies: [] });
    setShowNotifications(false);
    setShareError('');
    setShareSuccess('');
    setTrackingData([]);
    setBuddyEvents({});
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await fetch(`${API_URL}/avatar`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await res.json();
      if (res.ok) {
        setAvatar(data.avatar);
        localStorage.setItem('avatar', data.avatar);
      }
    } catch {}
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

  const toggleTournament = useCallback(async (tournamentId) => {
    haptic();
    const existing = mySchedule.find(t => t.id === tournamentId);
    const isIn = !!existing;
    try {
      if (isIn) {
        if (existing.venue === 'Personal') {
          await fetch(`${API_URL}/personal-event/${tournamentId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
        } else {
          await fetch(`${API_URL}/schedule/${tournamentId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
        }
      } else {
        await fetch(`${API_URL}/schedule`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId })
        });
      }
      fetchMySchedule();
    } catch { setError('Failed to update schedule'); }
  }, [token, mySchedule]);

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
        return;
      }
      fetchMySchedule();
    } catch { setError('Failed to create personal event'); }
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
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/condition`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions, isPublic })
      });
      fetchMySchedule();
    } catch { setError('Failed to set condition'); }
  }, [token]);

  const removeCondition = useCallback(async (tournamentId) => {
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/condition`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchMySchedule();
    } catch { setError('Failed to remove condition'); }
  }, [token]);

  const toggleAnchor = useCallback(async (tournamentId, isAnchor) => {
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/anchor`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAnchor })
      });
      fetchMySchedule();
    } catch { setError('Failed to update anchor status'); }
  }, [token]);

  const setPlannedEntries = useCallback(async (tournamentId, plannedEntries) => {
    try {
      await fetch(`${API_URL}/schedule/${tournamentId}/entries`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedEntries })
      });
      fetchMySchedule();
    } catch { setError('Failed to update planned entries'); }
  }, [token]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('pdf', file);
    if (uploadVenue) fd.append('venue', uploadVenue);
    try {
      toast.info('Uploading and parsing PDF...');
      const res = await fetch(`${API_URL}/upload-schedule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await res.json();
      toast.success(`Imported ${data.tournamentsCount} tournaments from ${data.format === 'wsop' ? 'WSOP' : 'generic'} format!`);
      setUploadVenue('');
      fetchTournaments();
    } catch { toast.error('Failed to upload schedule'); }
  };

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
        fetchTournaments(), fetchMySchedule(), fetchGameVariants(),
        fetchVenues(), fetchShareToken(), fetchShareBuddies(),
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
          setGroupFeed(prev => [...prev, {
            id: Date.now(), type: 'message',
            user_id: d.userId, username: d.username, avatar: d.avatar,
            content: d.message, created_at: d.createdAt
          }]);
          fetchMyGroups();
        } catch (err) { console.error('SSE group-message error:', err); }
      });
      es.addEventListener('group-updated', () => fetchMyGroups());
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
          if (!d.cleared) {
            setGroupFeed(prev => [...prev, {
              id: Date.now(), type: 'live-update',
              user_id: d.userId, username: d.username,
              content: null, liveData: d, created_at: d.updatedAt
            }]);
          }
        } catch (err) { console.error('SSE group-live-update error:', err); }
      });
      es.addEventListener('group-invite', () => fetchNotifications());
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
  const authUsername = useMemo(() => tokenUsername(token), [token]);
  const isPushAdmin = !!token && !isGuest && APP_ADMIN_USERNAMES.includes(authUsername);
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
  // /?batch=<id>: an admin push tap. Waits for a session, then opens the batch only for an app
  // admin; anyone else just loses the param.
  const batchLinkHandled = useRef(false);
  useEffect(() => {
    if (!token || BATCH_PARAM == null || batchLinkHandled.current) return;
    batchLinkHandled.current = true;
    if (!isGuest && APP_ADMIN_USERNAMES.includes(tokenUsername(token))) openBatch(BATCH_PARAM);
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
              if (typeof url !== 'string') return;
              const b = batchIdFrom(url);
              if (b != null) { openBatch(b); return; }
              const m = url.match(/[?&]find=([^&]*)/);
              if (m) applyFindLink(decodeURIComponent(m[1].replace(/\+/g, ' ')));
              else if (/[?&]view=calendar/.test(url)) setCurrentView('calendar');
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
  }, [isPushAdmin, pushSupported, nativePush, subscribeToPush]);

  // isAdmin is a STAGED-ROLLOUT flag, not an authorisation one. It gates the Hands tab, the
  // solver/replayer panel and StakingView — none of whose endpoints are admin-gated server side —
  // so narrowing it to match the server's write allowlist would revoke working features from
  // 'claude' rather than fix anything.
  // Read from the signed token's claim (authUsername), not the editable 'username' storage key.
  const isAdmin = !isGuest && APP_ADMIN_USERNAMES.includes(authUsername);
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

  // A non-admin session never runs on the simulated clock (see the boot-time clear above): this
  // catches an admin signing out and someone else signing in without a reload.
  useEffect(() => {
    if (isAdmin || !getDebugNow()) return;
    setDebugNow('');
    setDebugTimeKey(k => k + 1);
  }, [isAdmin]);

  // ── Desktop layout (docs/desktop-layout.md) ──
  // Wide landscape windows get a side rail + panes; everything else is the
  // phone layout, unchanged. dk.desktop is false on every phone.
  const dk = useDesktopLayout();
  const isDesktop = dk.desktop;
  const [dkSelectedId, setDkSelectedId] = useState(null);
  // The home's second pane (its NUMBERS column), set by a callback ref once the pane mounts.
  const [dkHomeRight, setDkHomeRight] = useState(null);
  // Closing an event animates like opening one, in reverse (owner, 2026-10-11): the details keep
  // rendering, marked closing, until their collapse ends, so My Schedule rises into their place
  // instead of jumping. Worked out during render (React's "previous value in state" pattern) so
  // the block is never unmounted between the two. Only while the block is on screen (the ref):
  // a selection cleared while the pane was away (the user menu's My Schedule from another tab)
  // has nothing to collapse.
  const dkDetailRef = useRef(null);
  const [dkClosing, setDkClosing] = useState(null); // { id } while the details collapse
  const [dkPrevSelected, setDkPrevSelected] = useState(null);
  const dkPaneShown = isDesktop && currentView === 'tournaments';
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
      resizeDetailBlock(el, dkLastH.current, subrowPx());
      return;
    }
    // was == null: the block mounted in this commit, so it opens from nothing.
    const over = moveDetailBlock(el, dkPhase === 'open' ? 'open' : 'close', subrowPx(), was == null);
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
    return (
      <div className="app-shell" style={{ height: '100%' }}>
        {sharedHandData
          ? <Suspense fallback={<LazyFallback />}>
              <HandReplayerView token={null} heroName="Hero" cardSplay={cardSplay}
                initialHand={sharedHandData} onClearInitialHand={() => {}} linkedReplay />
            </Suspense>
          : <LazyFallback />}
      </div>
    );
  }

  // ── Render: auth screens ──
  if (!token) {
    if (authView === 'forgot') {
      return <ForgotPasswordForm
        onBack={() => setAuthView('login')}
        theme={theme}
        toggleTheme={toggleTheme}
      />;
    }
    return <AuthScreen
      onSubmit={handleLogin}
      error={error}
      success={success}
      theme={theme}
      toggleTheme={toggleTheme}
      onForgotPassword={() => { setError(''); setSuccess(''); setAuthView('forgot'); }}
      onGuestLogin={handleGuestLogin}
      initialRegister={authView === 'register'}
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
            {visitedTabs.has('dashboard') && (!dataLoaded ? <SkeletonDashboard /> :
              <DashboardView
                key={debugTimeKey}
                demoStates={isAdmin && demoStates}
                demoCard={isAdmin && /[?&]democard(=|&|$)/.test(window.location.search)}
                onOpenInSchedule={(id) => { setScheduleFocusId(id); setCurrentView('schedule'); }}
                mySchedule={mySchedule}
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
                onSetPlayed={setNotPlayed}
                onDeleteTracking={deleteTracking}
                tournaments={tournaments}
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
            </div>

            <div className={'tab-panel' + (currentView === 'tournaments' ? ' tab-active' : '')} data-tab="tournaments" style={{display: currentView === 'tournaments' ? undefined : 'none', height: currentView === 'tournaments' ? '100%' : undefined}}>
            {visitedTabs.has('tournaments') && (!dataLoaded ? <SkeletonSchedule /> :
              <TournamentsView
                key={debugTimeKey}
                tournaments={tournaments}
                mySchedule={mySchedule}
                onToggle={toggleTournament}
                gameVariants={gameVariants}
                venues={venues}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                buddyEvents={buddyEvents}
                buddyLiveUpdates={buddyLiveUpdates}
                onBuddySwap={onBuddySwap}
                isAdmin={isAdmin}
                onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
                token={token}
                onRefreshTournaments={fetchTournaments}
                onOpenCalendarView={() => setCurrentView('calendar')}
                onSelectEvent={isDesktop ? selectEvent : undefined}
                selectedEventId={isDesktop ? dkSelectedId : undefined}
              />
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'schedule' ? ' tab-active' : '')} data-tab="schedule" style={{display: currentView === 'schedule' ? undefined : 'none', height: currentView === 'schedule' ? '100%' : undefined}}>
            {visitedTabs.has('schedule') && (!dataLoaded ? <SkeletonSchedule /> :
              <ScheduleView
                key={debugTimeKey}
                onNavigate={(v) => setCurrentView(v)}
                focusTournamentId={scheduleFocusId}
                onFocusConsumed={clearScheduleFocus}
                mySchedule={mySchedule}
                onToggle={toggleTournament}
                shareBuddies={shareBuddies}
                pendingIncoming={pendingIncoming}
                lastSeenShares={lastSeenShares}
                onAcceptRequest={handleAcceptRequest}
                onRejectRequest={handleRejectRequest}
                token={token}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                allTournaments={tournaments}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                onAddPersonalEvent={addPersonalEvent}
                onUpdatePersonalEvent={updatePersonalEvent}
                buddyEvents={buddyEvents}
                buddyLiveUpdates={buddyLiveUpdates}
                onBuddySwap={onBuddySwap}
                isAdmin={isAdmin}
                onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
              />
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'calendar' ? ' tab-active' : '')} data-tab="calendar" style={{display: currentView === 'calendar' ? undefined : 'none', height: currentView === 'calendar' ? '100%' : undefined}}>
            {visitedTabs.has('calendar') && (
              <CalendarView
                key={debugTimeKey}
                token={token}
                allTournaments={tournaments}
                mySchedule={mySchedule}
                onToggle={toggleTournament}
                gameVariants={gameVariants}
                venues={venues}
                onSetCondition={setCondition}
                onRemoveCondition={removeCondition}
                onToggleAnchor={toggleAnchor}
                onSetPlannedEntries={setPlannedEntries}
                buddyEvents={buddyEvents}
                buddyLiveUpdates={buddyLiveUpdates}
                onOpenScheduleView={() => setCurrentView('tournaments')}
                initialSearch={calendarFind}
                onSearchConsumed={clearCalendarFind}
              />
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'tracking' ? ' tab-active' : '')} data-tab="tracking" style={{display: currentView === 'tracking' ? undefined : 'none', height: currentView === 'tracking' ? '100%' : undefined}}>
            {visitedTabs.has('tracking') && (
              <TrackingView
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
              />
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'hands' ? ' tab-active' : '')} data-tab="hands" style={{display: currentView === 'hands' ? undefined : 'none', height: currentView === 'hands' ? '100%' : undefined}}>
            {visitedTabs.has('hands') && (
              isAdmin || sharedHandArrived
                ? <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
                    {/* The tool selector (Replayer / Solver / …) now lives as a second
                        footer row above the bottom nav — see HANDS_TOOLS below — so it
                        stays put while the tool content scrolls. */}
                    <div style={{flex:1,minHeight:0}}>
                      {handsTool === 'scanner' && isAdmin
                        ? <HandsScanner />
                        : handsTool === 'solver' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><SolverView pendingSpot={pendingSolverSpot} onConsumeSpot={() => setPendingSolverSpot(null)} /></Suspense>
                        : handsTool === 'trainer' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><SolverTrainerView /></Suspense>
                        : handsTool === 'watch' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><SolverPlayView /></Suspense>
                        : handsTool === 'razz-trainer' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><RazzTrainerView /></Suspense>
                        : handsTool === 'multiway' && isAdmin
                        ? <Suspense fallback={<LazyFallback />}><Multiway3TrainerView /></Suspense>
                        : <Suspense fallback={<LazyFallback />}><HandReplayerView token={token} heroName={realName || username || 'Hero'} cardSplay={cardSplay} initialHand={sharedHandData} onClearInitialHand={() => setSharedHandData(null)} onSolveSpot={isAdmin ? (spot => { setPendingSolverSpot(spot); setHandsTool('solver'); }) : undefined} quickAdd={isAdmin} /></Suspense>}
                    </div>
                  </div>
                : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'calc(var(--subrow) * 7.5) calc(var(--subrow) * 2.5)',textAlign:'center'}}>
                    <h2 style={{fontFamily:"'Univers Condensed', 'Univers', sans-serif",fontSize:'calc(var(--gu) * 1.914)',fontWeight:700,color:'var(--text)',margin:'0 0 calc(var(--subrow) * 1)'}}>Hand Replayer</h2>
                    <p style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.325)',margin:0}}>Coming Soon</p>
                  </div>
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'settings' ? ' tab-active' : '')} data-tab="settings" style={{display: currentView === 'settings' ? undefined : 'none', height: currentView === 'settings' ? '100%' : undefined}}>
            {visitedTabs.has('settings') && (
              <SettingsView
                username={username}
                avatar={avatar}
                realName={realName}
                nameMode={nameMode}
                onToggleNameMode={(mode) => { setNameMode(mode); localStorage.setItem('displayNameMode', mode); }}
                onAvatarUpload={handleAvatarUpload}
                onAvatarRemove={handleAvatarRemove}
                theme={theme}
                toggleTheme={toggleTheme}
                contrast={contrast}
                toggleContrast={toggleContrast}
                cardSplay={cardSplay}
                toggleCardSplay={() => { setCardSplay(s => { const next = !s; localStorage.setItem('cardSplay', next ? 'on' : 'off'); return next; }); }}
                serifFont={serifFont}
                toggleSerifFont={() => setSerifFont(f => SERIF_ORDER[(SERIF_ORDER.indexOf(f) + 1) % SERIF_ORDER.length])}
                onLogout={handleLogout}
                onDebugTimeChange={() => setDebugTimeKey(k => k + 1)}
                onUpload={handleFileUpload}
                uploadError={uploadError}
                uploadSuccess={uploadSuccess}
                uploadVenue={uploadVenue}
                onUploadVenueChange={setUploadVenue}
                shareToken={shareToken}
                onGenerateShareToken={handleGenerateShareToken}
                onRevokeShareToken={handleRevokeShareToken}
                onSendShareRequest={handleSendShareRequest}
                pendingOutgoing={pendingOutgoing}
                onCancelRequest={handleCancelRequest}
                shareBuddies={shareBuddies}
                onRemoveBuddy={handleRemoveBuddy}
                shareError={shareError}
                shareSuccess={shareSuccess}
                token={token}
                onRefreshTournaments={fetchTournaments}
                isAdmin={isAdmin}
                seasonLabel={seasonLabel}
                isGuest={isGuest}
              />
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'admin' ? ' tab-active' : '')} data-tab="admin" style={{display: currentView === 'admin' ? undefined : 'none', height: currentView === 'admin' ? '100%' : undefined}}>
            {visitedTabs.has('admin') && isAdmin && (
              <Suspense fallback={<LazyFallback />}><AdminView token={token} onNavigate={(v) => setCurrentView(v)} /></Suspense>
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'batches' ? ' tab-active' : '')} data-tab="batches" style={{display: currentView === 'batches' ? undefined : 'none', height: currentView === 'batches' ? '100%' : undefined}}>
            {visitedTabs.has('batches') && isAdmin && (
              <Suspense fallback={<LazyFallback />}>
                <AdminBatchesView
                  token={token}
                  batchId={batchId}
                  onSelectBatch={openBatch}
                  onShowInSchedule={applyFindLink}
                  tournaments={tournaments}
                  mySchedule={mySchedule}
                  onToggle={toggleTournament}
                  isAdmin={isAdmin}
                  onAdminEdit={canEditEvents ? adminEditTournament : undefined}
                  onClearOverrides={canEditEvents ? clearTournamentOverrides : undefined}
                />
              </Suspense>
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'cash' ? ' tab-active' : '')} data-tab="cash" style={{display: currentView === 'cash' ? undefined : 'none', height: currentView === 'cash' ? '100%' : undefined}}>
            {visitedTabs.has('cash') && isAdmin && (
              <Suspense fallback={<LazyFallback />}><CashView token={token} onModeChange={setCashMode} /></Suspense>
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'staking' ? ' tab-active' : '')} data-tab="staking" style={{display: currentView === 'staking' ? undefined : 'none', height: currentView === 'staking' ? '100%' : undefined}}>
            {visitedTabs.has('staking') && (
              isAdmin
                ? <Suspense fallback={<LazyFallback />}><StakingView token={token} tournaments={tournaments} mySchedule={mySchedule} /></Suspense>
                : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'calc(var(--subrow) * 7.5) calc(var(--subrow) * 2.5)',textAlign:'center'}}>
                    <h2 style={{fontFamily:"'Univers Condensed', 'Univers', sans-serif",fontSize:'calc(var(--gu) * 1.914)',fontWeight:700,color:'var(--text)',margin:'0 0 calc(var(--subrow) * 1)'}}>Staking</h2>
                    <p style={{color:'var(--text-muted)',fontSize:'calc(var(--gu) * 1.325)',margin:0}}>Coming Soon</p>
                  </div>
            )}
            </div>

            <div className={'tab-panel' + (currentView === 'social' ? ' tab-active' : '')} data-tab="social" style={{display: currentView === 'social' ? undefined : 'none', height: currentView === 'social' ? '100%' : undefined}}>
            {visitedTabs.has('social') && (
              <SocialView
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
                onNavigate={(v) => setCurrentView(v)}
              />
            )}
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
              {[['replayer','Replayer',6],['scanner','Scanner',6],['solver','Solver',5],['trainer','Solver Trainer',8],['watch','Watch Solver',8],['razz-trainer','Trainer',5],['multiway','3-Way',5]].map(([id,lbl,w]) => (
                <button key={id} className="ctl" onClick={() => setHandsTool(id)}
                  style={{flex:'0 0 auto',width:`calc(var(--gu) * ${w})`,height:'calc(var(--subrow) * 3)',boxSizing:'border-box',padding:0,borderRadius:'var(--radius)',fontFamily:'inherit',fontSize:'calc(var(--gu) * 1.031)',fontWeight:'var(--fw-bold)',cursor:'pointer',
                    border:'var(--bw-hair) solid ' + (handsTool === id ? 'var(--accent)' : 'var(--border)'),
                    background: handsTool === id ? 'var(--accent)' : 'transparent',
                    color: handsTool === id ? '#fff' : 'var(--text-muted)'}}>
                  {lbl}
                </button>
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
      mySchedule={mySchedule}
      onToggle={toggleTournament}
      onSetCondition={setCondition}
      onRemoveCondition={removeCondition}
      onToggleAnchor={toggleAnchor}
      onSetPlannedEntries={setPlannedEntries}
      onUpdatePersonalEvent={updatePersonalEvent}
      buddyEvents={buddyEvents}
      buddyLiveUpdates={buddyLiveUpdates}
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
      mySchedule={mySchedule}
      onToggle={toggleTournament}
      shareBuddies={shareBuddies}
      pendingIncoming={pendingIncoming}
      lastSeenShares={lastSeenShares}
      onAcceptRequest={handleAcceptRequest}
      onRejectRequest={handleRejectRequest}
      token={token}
      onSetCondition={setCondition}
      onRemoveCondition={removeCondition}
      allTournaments={tournaments}
      onToggleAnchor={toggleAnchor}
      onSetPlannedEntries={setPlannedEntries}
      onAddPersonalEvent={addPersonalEvent}
      onUpdatePersonalEvent={updatePersonalEvent}
      buddyEvents={buddyEvents}
      buddyLiveUpdates={buddyLiveUpdates}
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
  const onNavChange = (v) => {
    if (v === currentView && v === 'tournaments') { landListOnToday(); return; }
    setCurrentView(v);
  };
  return (
    <DisplayNameProvider value={displayName}>
    <div
      className={'app-shell' + (isDesktop ? ' is-desktop dk-' + dk.tier : '')}
      style={isDesktop ? { '--dk-shell-n': dk.shellG, '--dk-detail-n': dk.detailCols, '--dk-wide-n': dk.wideCols, '--dk-sb-g': dk.sbG, '--dk-ov-g': dk.ovG } : undefined}
    >
      <header className="top-bar">
        <div className="top-bar-title">
          <h1>futurega.me</h1>
          {/* The cash tab is not seasonal, so its subtitle names the tab instead of the
              season's date range. The h2 inside CashView is dropped in favour of this. */}
          {currentView === 'cash' ? <small>{cashMode === 'heatmap' ? 'cash game history' : 'live cash games'}</small>
            : currentView === 'hands' ? <small>hands archive</small>
            : currentView === 'dashboard' ? <small>dashboard</small>
            : (seasonLabel ? <AlternatingSubtitle labels={[seasonLabel, 'scheduler']} /> : null)}
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
          >
            <Icon.bell />
            {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
          </button>
          <LiveUpdatePanel
            mySchedule={mySchedule}
            myActiveUpdates={myActiveUpdates}
            onPost={postLiveUpdate}
            onAddTracking={addTracking}
          />
          <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title={`Switch to ${nextThemeLabel} mode`}>
            {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
          </button>
        </div>
        <div className="top-bar-user">
          <button className="username-chip snap-g" onClick={() => setShowUserMenu(m => !m)} style={{display:'flex',alignItems:'center',gap:'calc(var(--subrow) * 0.75)',background:'none',border:'none',padding:0,cursor:'pointer',overflow:'hidden'}}>
            <Avatar src={avatar} username={username} size={22} style={{flexShrink:0}} />
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nameMode === 'username' ? username : (realName || username)}</span>
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
                <button onClick={() => {
                  setShowUserMenu(false);
                  setCurrentView('schedule');
                  // Also when My Schedule is already showing (no tab change, so setCurrentView
                  // lands nothing). The same landing as the tab change's, in My Schedule's own
                  // scroller: on desktop the right pane's, never the Schedule list's.
                  requestAnimationFrame(landMySchedule);
                }}
                  style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                  My Schedule
                </button>
                {/* Social moved here from the bottom nav (owner, 2026-10-14); its slot there is Bankroll,
                    which opens Results & Tracking. */}
                <button onClick={() => { setShowUserMenu(false); setCurrentView('social'); }}
                  style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                  Social
                </button>
                {handReplayerAccess && !isAdmin && (
                  <button onClick={() => { setShowUserMenu(false); setCurrentView('hands'); }}
                    style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                    Hand Replayer
                  </button>
                )}
                <button onClick={() => { setShowUserMenu(false); setCurrentView('settings'); }}
                  style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                  Settings
                </button>
                {isAdmin && (
                  <button onClick={() => { setShowUserMenu(false); setCurrentView('admin'); }}
                    style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                    Admin
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => { setShowUserMenu(false); openBatch(null); }}
                    style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                    New Events
                  </button>
                )}
                {/* The divider: a 1r row with the hairline drawn across its middle. */}
                <div style={{height:'var(--subrow)',background:'linear-gradient(var(--border), var(--border)) center / 100% calc(var(--subrow) * 0.125) no-repeat'}} />
                <button onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  style={{display:'flex',alignItems:'center',width:'100%',height:'calc(var(--subrow) * 5)',boxSizing:'border-box',lineHeight:1,textAlign:'left',padding:'0 calc(var(--subrow) * 2)',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.252)'}}>
                  Sign Out
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
          <span>Guest mode -- your schedule won't be saved. Register to keep it!</span>
          <button onClick={() => { handleLogout(); setAuthView('register'); }}
            style={{background:'rgba(0,0,0,0.2)',color:'#000',border:'none',borderRadius:'calc(var(--subrow) * 0.5)',padding:'calc(var(--subrow) * 0.5) calc(var(--subrow) * 1.5)',cursor:'pointer',fontSize:'calc(var(--gu) * 1.104)',fontWeight: 'var(--fw-bold)',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
            Register
          </button>
        </div>
      )}

      {showRealNamePrompt && (
        <RealNamePrompt
          token={token}
          onSave={(name) => { setRealName(name); localStorage.setItem('realName', name); setShowRealNamePrompt(false); }}
          onDismiss={() => setShowRealNamePrompt(false)}
        />
      )}

      {/* Onboarding waits behind the real-name prompt so a brand-new user answers
          one at a time rather than seeing two stacked modals. */}
      {showOnboarding && !showRealNamePrompt && (
        <OnboardingWizard token={token} onDone={() => setShowOnboarding(false)} />
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
              current={currentView === 'schedule' ? 'tournaments' : currentView}
              onChange={v => (v === 'batches' ? openBatch(null) : onNavChange(v))}
            />
          )}
          <div className={!isDesktop ? 'layout-contents' : 'dk-pane dk-pane-main ' + (currentView === 'tournaments' ? 'dk-pane-list dk-fab-scope' : currentView === 'dashboard' ? 'dk-pane-home' : 'dk-pane-wide')}>
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
          {/* One right pane, two blocks (owner, 2026-10-10: My Schedule goes UNDER the event details,
              not in a third column): the selected event on top, My Schedule below it in the same
              scroll. With nothing selected, My Schedule is the whole pane. */}
          {isDesktop && currentView === 'tournaments' && (
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
              <div className="dk-scroll dk-mine-block">{dkMine}</div>
            </div>
          )}
      </div>

      {!isDesktop && (
        <BottomNav
          isAdmin={isAdmin}
          current={(() => {
            if (currentView === 'hands' && isAdmin) return 'hands';
            if (['social', 'calendar', 'settings', 'schedule', 'hands', 'admin', 'batches'].includes(currentView)) return null;
            return currentView;
          })()}
          onChange={onNavChange}
          scheduleCount={mySchedule.filter(t => !t.is_restart).length}
          newShareCount={newShareCount}
        />
      )}

      {activeMilestone && (
        <MilestoneCelebration
          milestone={activeMilestone}
          onShare={() => setActiveMilestone(null)}
          onDismiss={() => setActiveMilestone(null)}
        />
      )}

      {/* Admin-only layout grid: a faint overlay of the real content grid plus a
          floating toggle, so alignment can be checked live and layout fixes made
          by eye. Gated on isAdmin; state persists in localStorage. */}
      {isAdmin && gridOverlay && <GridOverlay showReadout={gridReadout} />}
    </div>
    </DisplayNameProvider>
  );
}

// The entry point: a backer link renders its page alone (components/BackerPage.jsx), so App's
// hooks (the session, the schedule fetches, push for admins) never run for it.
export default function Root() {
  if (BACKER_TOKEN) return <BackerPage token={BACKER_TOKEN} />;
  return <App />;
}
