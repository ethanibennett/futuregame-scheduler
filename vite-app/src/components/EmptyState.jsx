import React from 'react';
import Icon from './Icon.jsx';

/**
 * Two kinds of empty, deliberately different.
 *
 * The app had 24 empty-state strings, seven of which said "no events" in seven
 * ways. They read as inconsistent copy, but the real problem was that two
 * unrelated situations were sharing one undifferentiated shrug:
 *
 *   <FirstRun>  The user has never done this. Invite them — verb-first
 *               headline, one line on why it is worth doing, one action.
 *
 *   <Filtered>  The data exists; the query excluded it. Name the filter that
 *               did the excluding and offer the way out. Never a create-CTA:
 *               the thing already exists, they just cannot see it.
 *
 * Copy rules for both: sentence case, no terminal punctuation on the headline,
 * no "Nothing here yet", no apology, no exclamation marks.
 */

function resolveIcon(name, fallback) {
  return Icon[name] || Icon[fallback];
}

/* block (Bankroll design 96): drawn as one card, the Bankroll tab's one empty state: --surface, a hairline
   ring, 4r of padding, a 3g mark, the title, one sentence, one action (only where the page has none above it). */
export function FirstRun({ icon = 'star', title, body, actionLabel, onAction, compact = false, block = false, secondary = null }) {
  const Glyph = resolveIcon(icon, 'star');
  return (
    <div className={(compact ? 'empty-state empty-state-compact' : 'empty-state') + (block ? ' is-block' : '')}>
      <Glyph />
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {actionLabel && onAction && !secondary ? (
        <button type="button" className="empty-state-action snap-g-centred" onClick={onAction}>
          {/* snap-g-centred: the width rounds up to whole g with its parent's parity, so centred it sits on g lines. */}
          <span className="empty-state-action-label">{actionLabel}</span>
        </button>
      ) : null}
      {/* Two actions (Bankroll design 45): the first in the brand, the second quiet beside it. */}
      {actionLabel && onAction && secondary ? (
        <div className="empty-state-actions">
          <button type="button" className="empty-state-action snap-g-centred" onClick={onAction}><span className="empty-state-action-label">{actionLabel}</span></button>
          <button type="button" className="empty-state-action empty-state-action-quiet snap-g-centred" onClick={secondary.onClick}><span className="empty-state-action-label">{secondary.label}</span></button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * `hint` is where a count of what was excluded belongs — "14 events match
 * everything else in your filter". Nothing computes that yet, so callers pass
 * a plain hint for now; the prop is here so adding the count later is a
 * call-site change rather than a component change.
 *
 * `actions` is [{ label, onClick }]; the first is styled as the way out.
 */
export function Filtered({ icon = 'filter', title, hint, actions = [], compact = false }) {
  const Glyph = resolveIcon(icon, 'empty');
  const usable = actions.filter(a => a && a.label && a.onClick);
  return (
    <div className={compact ? 'empty-state empty-state-compact' : 'empty-state'}>
      <Glyph />
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {usable.length > 0 ? (
        <div className="empty-state-actions">
          {usable.map((a, i) => (
            <button
              key={a.label}
              type="button"
              className={i === 0 ? 'empty-state-action snap-g-centred' : 'empty-state-action empty-state-action-quiet snap-g-centred'}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A failed load says so (Bankroll design 97): the empty block with a --neg mark, a title naming what did
 * not load, one sentence, and Try again, which refetches that section. The empty text belongs only to a
 * response that says the list is empty; a failed request shows this instead.
 */
export function LoadFailed({ title = 'This did not load', body = 'Nothing is lost. Check the connection and try again.', onRetry, retryLabel = 'Try again', inline = false }) {
  const Glyph = resolveIcon('warn', 'empty');
  if (inline) {
    return (
      <p className="load-failed-line" role="alert">
        <span>{title}. {body}</span>
        {onRetry ? <button type="button" className="load-failed-retry" onClick={onRetry}>{retryLabel}</button> : null}
      </p>
    );
  }
  return (
    <div className="empty-state is-block is-failed" role="alert">
      <Glyph />
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {onRetry ? (
        <button type="button" className="empty-state-action snap-g-centred" onClick={onRetry}>
          <span className="empty-state-action-label">{retryLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

export default { FirstRun, Filtered, LoadFailed };
