import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';

import { API_URL } from './utils/api.js';
import { haptic, THEME_ORDER, THEME_LABEL, THEME_ICON, THEME_META, SERIF_FONTS, SERIF_ORDER, VENUE_BRAND_VAR, getVenueBrandColor, formatSeasonLabel } from './utils/utils.js';
import { decodeHand } from './utils/hand-shorthand.js';
import { detectMilestones, measureStickyStack } from './utils/milestones.js';
import usePullToRefresh from './hooks/usePullToRefresh.js';

import { useToast } from './contexts/ToastContext.jsx';
import { useDisplayName, DisplayNameProvider } from './contexts/DisplayNameContext.jsx';

import Icon from './components/Icon.jsx';
import Avatar from './components/Avatar.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import ForgotPasswordForm from './components/ForgotPasswordForm.jsx';
import ResetPasswordForm from './components/ResetPasswordForm.jsx';
import BottomNav from './components/BottomNav.jsx';
import DashboardView from './components/DashboardView.jsx';
import TournamentsView from './components/TournamentsView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import CalendarView from './components/CalendarView.jsx';
import TrackingView from './components/TrackingView.jsx';
import SettingsView from './components/SettingsView.jsx';
import SocialView from './components/SocialView.jsx';
import LiveUpdatePanel from './components/LiveUpdatePanel.jsx';
import ScheduleExportModal from './components/ScheduleExportModal.jsx';
import SharedScheduleView from './components/SharedScheduleView.jsx';
import SkeletonDashboard from './components/SkeletonDashboard.jsx';
import SkeletonSchedule from './components/SkeletonSchedule.jsx';
import RealNamePrompt from './components/RealNamePrompt.jsx';
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

const LazyFallback = () => <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text-muted)',fontFamily:"'Univers Condensed','Univers',sans-serif",fontSize:'0.85rem'}}>Loading…</div>;

// Detect shared schedule URL: /shared/:token
const SHARED_MATCH = window.location.pathname.match(/^\/shared\/([a-f0-9]+)$/);
const SHARED_TOKEN = SHARED_MATCH ? SHARED_MATCH[1] : null;

// Detect password reset URL: /#reset?token=<hex>
const RESET_MATCH = window.location.hash.match(/^#reset\?token=([a-f0-9]{64})$/);
const RESET_TOKEN = RESET_MATCH ? RESET_MATCH[1] : null;

// Detect shared hand URL: /#h/ENCODED_STRING
const HAND_MATCH = window.location.hash.match(/^#h\/(.+)$/);
const HAND_SHORTHAND = HAND_MATCH ? decodeURIComponent(HAND_MATCH[1]) : null;

// Detect notification deep link: /?find=<query> — a new-series push tap lands on the calendar
// with this query applied (web push opens the URL; the native tap listener parses the same form).
const FIND_MATCH = window.location.search.match(/[?&]find=([^&]*)/);
const FIND_PARAM = FIND_MATCH ? decodeURIComponent(FIND_MATCH[1].replace(/\+/g, ' ')) : null;
// /?view=calendar — a notification that concerns many events (feed sync) opens the calendar
// without a search. Only 'calendar' is honored; anything else falls through to the default view.
const VIEW_MATCH = window.location.search.match(/[?&]view=([a-z]+)/);
const VIEW_PARAM = VIEW_MATCH ? VIEW_MATCH[1] : null;

export default function App() {
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
  const tapListenerArmed = useRef(false); // the push effect re-runs on token changes; arm once
  const [viewKey, setViewKey] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState(new Set(['dashboard']));
  const scrollPositions = useRef({});
  const toast = useToast();

  const setCurrentView = useCallback((v) => {
    _setCurrentView(prev => {
      if (v !== prev) {
        const container = document.querySelector('.content-area');
        if (container) scrollPositions.current[prev] = container.scrollTop;
        setVisitedTabs(s => { const n = new Set(s); n.add(v); return n; });
        requestAnimationFrame(() => {
          const c = document.querySelector('.content-area');
          if (c && v === 'schedule') {
            const panel = c.querySelector('.tab-panel[data-tab="schedule"]');
            const todayEl = panel ? panel.querySelector('[data-today-scroll]') : null;
            if (todayEl) {
              const sticky = panel.querySelector('.schedule-sticky-header');
              const stickyH = sticky ? Math.max(0, sticky.getBoundingClientRect().bottom - c.getBoundingClientRect().top) : 0;
              const groupAbsTop = todayEl.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
              c.scrollTop = Math.max(0, groupAbsTop - stickyH);
            } else {
              c.scrollTop = 0;
            }
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
  const [sharedHandArrived, setSharedHandArrived] = useState(!!HAND_SHORTHAND);

  // If a shared hand was decoded, switch to hands tab on mount
  useEffect(() => {
    if (sharedHandData) setCurrentView('hands');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const res = await guardedFetch(`${API_URL}/tournaments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res) return;
      const data = await res.json();
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

  // Bulk-clear all of the user's tracking entries (Dashboard "Reset"
  // button). Optimistic — clears local state immediately, then re-fetches.
  const resetResults = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tracking`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json().catch(() => ({}));
      setTrackingData([]);
      toast.success(`Cleared ${data.count || 0} result${data.count === 1 ? '' : 's'}`);
      fetchTracking();
    } catch (e) {
      console.error('Reset tracking:', e);
      toast.error('Failed to reset results');
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

  const addTracking = useCallback(async (data) => {
    try {
      const matchedTournament = tournaments.find(tr => tr.id === data.tournamentId);
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
        const err = await res.json();
        setError(err.error || 'Failed to add tracking entry');
        return;
      }
      if (totalFieldSize) await saveFieldSize(data.tournamentId, totalFieldSize);
      fetchTracking();

      if (milestones.length > 0) {
        setActiveMilestone(milestones[0]);
      }
    } catch { setError('Failed to add tracking entry'); }
  }, [token, tournaments, trackingData]);

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

  const deleteTracking = useCallback(async (entryId) => {
    try {
      await fetch(`${API_URL}/tracking/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchTracking();
    } catch { setError('Failed to delete tracking entry'); }
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
      setBuddyEvents(data.buddyEvents || {});
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
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${API_URL}/events?token=${token}`);

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

    es.onerror = () => console.warn('SSE connection error, will auto-reconnect');
    return () => es.close();
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
  const isPushAdmin = !!token && !isGuest && ['ham', 'ham5', 'claude'].includes((username || '').toLowerCase());
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
  const isAdmin = ['ham', 'ham5', 'claude'].includes((username || '').toLowerCase());
  // The write capability is separate and DOES have to match the server, which gates every admin
  // route on ['ham','ham5'] in 8 places. Passing the callbacks conditionally is enough: the row
  // renders its Edit button on `isAdmin && onAdminEdit`, so an account without the capability
  // keeps the rollout features and simply never sees an editor it cannot save from.
  const canEditEvents = ['ham', 'ham5'].includes((username || '').toLowerCase());

  // ── Render: shared schedule page ──
  if (SHARED_TOKEN) {
    return <SharedScheduleView shareToken={SHARED_TOKEN} />;
  }

  // ── Render: password reset page ──
  if (RESET_TOKEN) {
    return <ResetPasswordForm resetToken={RESET_TOKEN} theme={theme} toggleTheme={toggleTheme} />;
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
  return (
    <DisplayNameProvider value={displayName}>
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-title">
          <h1>futurega.me</h1>
          {seasonLabel ? <small>{seasonLabel}</small> : null}
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
        <div className="top-bar-user" style={{position:'relative',minWidth:0,flexShrink:1,display:'flex',alignItems:'center'}}>
          <button className="username-chip" onClick={() => setShowUserMenu(m => !m)} style={{display:'flex',alignItems:'center',gap:'6px',background:'none',border:'none',padding:0,cursor:'pointer',maxWidth:'100%',overflow:'hidden'}}>
            <Avatar src={avatar} username={username} size={22} style={{flexShrink:0}} />
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nameMode === 'username' ? username : (realName || username)}</span>
          </button>
          {showUserMenu && createPortal(
            <>
              <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={() => setShowUserMenu(false)} />
              <div style={{position:'fixed',top:'52px',right:'12px',zIndex:9999,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'8px',padding:'4px 0',minWidth:'180px',boxShadow:'0 8px 24px rgba(0,0,0,0.4)',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
                <button onClick={() => {
                  setShowUserMenu(false);
                  setCurrentView('schedule');
                  requestAnimationFrame(() => {
                    const c = document.querySelector('.content-area');
                    if (!c) return;
                    const panel = c.querySelector('.tab-panel[data-tab="schedule"]');
                    const todayEl = panel ? panel.querySelector('[data-today-scroll]') : null;
                    if (!todayEl) { c.scrollTop = 0; return; }
                    const sticky = panel.querySelector('.schedule-sticky-header');
                    const stickyH = sticky ? Math.max(0, sticky.getBoundingClientRect().bottom - c.getBoundingClientRect().top) : 0;
                    const groupAbsTop = todayEl.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
                    c.scrollTop = Math.max(0, groupAbsTop - stickyH);
                  });
                }}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'0.85rem'}}>
                  My Schedule
                </button>
                <button onClick={() => { setShowUserMenu(false); setCurrentView('tracking'); }}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'0.85rem'}}>
                  Results &amp; Tracking
                </button>
                {handReplayerAccess && !isAdmin && (
                  <button onClick={() => { setShowUserMenu(false); setCurrentView('hands'); }}
                    style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'0.85rem'}}>
                    Hand Replayer
                  </button>
                )}
                <button onClick={() => { setShowUserMenu(false); setCurrentView('settings'); }}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'0.85rem'}}>
                  Settings
                </button>
                {isAdmin && (
                  <button onClick={() => { setShowUserMenu(false); setCurrentView('admin'); }}
                    style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text)',cursor:'pointer',fontSize:'0.85rem'}}>
                    Admin
                  </button>
                )}
                <div style={{height:'1px',background:'var(--border)',margin:'2px 0'}} />
                <button onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  style={{display:'block',width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'0.85rem'}}>
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
        <div className="guest-banner" style={{background:'var(--accent)',color:'#000',padding:'8px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'0.8rem',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
          <span>Guest mode -- your schedule won't be saved. Register to keep it!</span>
          <button onClick={() => { handleLogout(); setAuthView('register'); }}
            style={{background:'rgba(0,0,0,0.2)',color:'#000',border:'none',borderRadius:'4px',padding:'4px 12px',cursor:'pointer',fontSize:'0.75rem',fontWeight: 'var(--fw-bold)',fontFamily:'Univers Condensed, Univers, sans-serif'}}>
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

      <main className="content-area ptr-container" ref={contentAreaRef} {...ptrProps}>
        <div className={'ptr-indicator' + (refreshing ? ' visible' : '')} ref={ptrIndicator}>
          <div className={'ptr-spinner' + (refreshing ? ' spinning' : '')} />
        </div>

        {/* Tab panels: visited tabs stay mounted, only active is visible */}
        <div className={'tab-panel' + (currentView === 'dashboard' ? ' tab-active' : '')} data-tab="dashboard" style={{display: currentView === 'dashboard' ? undefined : 'none', height: currentView === 'dashboard' ? '100%' : undefined}}>
        {visitedTabs.has('dashboard') && (!dataLoaded ? <SkeletonDashboard /> :
          <DashboardView
            key={debugTimeKey}
            onOpenInSchedule={(id) => { setScheduleFocusId(id); setCurrentView('schedule'); }}
            mySchedule={mySchedule}
            myActiveUpdates={myActiveUpdates}
            trackingData={trackingData}
            shareBuddies={shareBuddies}
            buddyLiveUpdates={buddyLiveUpdates}
            displayName={displayName}
            buddyEvents={buddyEvents}
            onPost={postLiveUpdate}
            onDeleteUpdate={deleteLiveUpdate}
            onAddTracking={addTracking}
            onResetResults={resetResults}
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
            myActiveUpdates={myActiveUpdates}
          />
        )}
        </div>

        <div className={'tab-panel' + (currentView === 'hands' ? ' tab-active' : '')} data-tab="hands" style={{display: currentView === 'hands' ? undefined : 'none', height: currentView === 'hands' ? '100%' : undefined}}>
        {visitedTabs.has('hands') && (
          isAdmin || sharedHandArrived
            ? <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
                {isAdmin && (
                  <div className="hands-tool-rail" style={{display:'flex',gap:6,padding:'8px 14px 0',fontFamily:"'Univers Condensed','Univers',sans-serif",flexWrap:'wrap'}}>
                    {/* ids must match the handsTool render chain below; 'watch' (SolverPlayView)
                        was rendered there but had no button, so the self-play viewer was
                        unreachable — restored 2026-08-18. */}
                    {[['replayer','Replayer'],['solver','Solver'],['trainer','Solver Trainer'],['watch','Watch Solver'],['razz-trainer','Trainer'],['multiway','3-Way']].map(([id,lbl]) => (
                      <button key={id} onClick={() => setHandsTool(id)}
                        style={{padding:'4px 12px',borderRadius:12,fontFamily:'inherit',fontSize:'0.7rem',fontWeight: 'var(--fw-bold)',cursor:'pointer',
                          border:'1px solid ' + (handsTool === id ? 'var(--accent)' : 'var(--border)'),
                          background: handsTool === id ? 'var(--accent)' : 'transparent',
                          color: handsTool === id ? '#fff' : 'var(--text-muted)'}}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{flex:1,minHeight:0}}>
                  {handsTool === 'solver' && isAdmin
                    ? <Suspense fallback={<LazyFallback />}><SolverView pendingSpot={pendingSolverSpot} onConsumeSpot={() => setPendingSolverSpot(null)} /></Suspense>
                    : handsTool === 'trainer' && isAdmin
                    ? <Suspense fallback={<LazyFallback />}><SolverTrainerView /></Suspense>
                    : handsTool === 'watch' && isAdmin
                    ? <Suspense fallback={<LazyFallback />}><SolverPlayView /></Suspense>
                    : handsTool === 'razz-trainer' && isAdmin
                    ? <Suspense fallback={<LazyFallback />}><RazzTrainerView /></Suspense>
                    : handsTool === 'multiway' && isAdmin
                    ? <Suspense fallback={<LazyFallback />}><Multiway3TrainerView /></Suspense>
                    : <Suspense fallback={<LazyFallback />}><HandReplayerView token={token} heroName={realName || username || 'Hero'} cardSplay={cardSplay} initialHand={sharedHandData} onClearInitialHand={() => setSharedHandData(null)} onSolveSpot={isAdmin ? (spot => { setPendingSolverSpot(spot); setHandsTool('solver'); }) : undefined} /></Suspense>}
                </div>
              </div>
            : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',textAlign:'center'}}>
                <h2 style={{fontFamily:"'Univers Condensed', 'Univers', sans-serif",fontSize:'1.3rem',fontWeight:700,color:'var(--text)',margin:'0 0 8px'}}>Hand Replayer</h2>
                <p style={{color:'var(--text-muted)',fontSize:'0.9rem',margin:0}}>Coming Soon</p>
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
          />
        )}
        </div>

        <div className={'tab-panel' + (currentView === 'admin' ? ' tab-active' : '')} data-tab="admin" style={{display: currentView === 'admin' ? undefined : 'none', height: currentView === 'admin' ? '100%' : undefined}}>
        {visitedTabs.has('admin') && isAdmin && (
          <Suspense fallback={<LazyFallback />}><AdminView token={token} onNavigate={(v) => setCurrentView(v)} /></Suspense>
        )}
        </div>

        <div className={'tab-panel' + (currentView === 'staking' ? ' tab-active' : '')} data-tab="staking" style={{display: currentView === 'staking' ? undefined : 'none', height: currentView === 'staking' ? '100%' : undefined}}>
        {visitedTabs.has('staking') && (
          isAdmin
            ? <Suspense fallback={<LazyFallback />}><StakingView token={token} tournaments={tournaments} mySchedule={mySchedule} /></Suspense>
            : <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',textAlign:'center'}}>
                <h2 style={{fontFamily:"'Univers Condensed', 'Univers', sans-serif",fontSize:'1.3rem',fontWeight:700,color:'var(--text)',margin:'0 0 8px'}}>Staking</h2>
                <p style={{color:'var(--text-muted)',fontSize:'0.9rem',margin:0}}>Coming Soon</p>
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

      <BottomNav
        isAdmin={isAdmin}
        current={(() => {
          if (currentView === 'hands' && isAdmin) return 'hands';
          if (['tracking', 'calendar', 'settings', 'schedule', 'hands', 'admin'].includes(currentView)) return null;
          return currentView;
        })()}
        onChange={v => {
          if (v === currentView && v === 'tournaments') {
            const todayEl = document.querySelector('[data-today-scroll]');
            const container = document.querySelector('.content-area');
            if (todayEl && container) {
              const caTop = container.getBoundingClientRect().top;
              const sticky = container.querySelector('.sticky-filters');
              const stickyH = sticky ? sticky.getBoundingClientRect().bottom - caTop : 0;
              const elTop = todayEl.getBoundingClientRect().top - caTop + container.scrollTop;
              container.scrollTo({ top: Math.max(0, elTop - stickyH), behavior: 'smooth' });
              setTimeout(() => {
                const firstCard = todayEl.querySelector('.cal-event-row');
                if (!firstCard) return;
                const stickyBottom = measureStickyStack(container);
                const cardVisualTop = firstCard.getBoundingClientRect().top - container.getBoundingClientRect().top;
                if (cardVisualTop < stickyBottom + 2) {
                  container.scrollBy({ top: -(stickyBottom + 2 - cardVisualTop), behavior: 'smooth' });
                }
              }, 350);
            }
            return;
          }
          setCurrentView(v);
        }}
        scheduleCount={mySchedule.filter(t => !t.is_restart).length}
        newShareCount={newShareCount}
      />

      {activeMilestone && (
        <MilestoneCelebration
          milestone={activeMilestone}
          onShare={() => setActiveMilestone(null)}
          onDismiss={() => setActiveMilestone(null)}
        />
      )}
    </div>
    </DisplayNameProvider>
  );
}
