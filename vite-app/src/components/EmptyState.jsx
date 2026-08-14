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

export function FirstRun({ icon = 'star', title, body, actionLabel, onAction, compact = false }) {
  const Glyph = resolveIcon(icon, 'star');
  return (
    <div className={compact ? 'empty-state empty-state-compact' : 'empty-state'}>
      <Glyph />
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="empty-state-action" onClick={onAction}>
          {actionLabel}
        </button>
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
              className={i === 0 ? 'empty-state-action' : 'empty-state-action empty-state-action-quiet'}
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

export default { FirstRun, Filtered };
