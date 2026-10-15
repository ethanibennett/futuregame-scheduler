import React from 'react';
import Icon from './Icon.jsx';
import { THEME_ICON } from '../utils/theme.js';

/**
 * The theme button: the current theme's icon (moon, sunset, sun, cloud), one press to the next.
 * The main app's top bar and the backer page's both render this, so the two are the same button.
 * It is a real button whose name says what it switches to ("Switch to Dusk mode"). The shape is
 * the caller's container: styles.css gives .btn-icon one rule, a 3g x 4r circle with the icon
 * centred, in the app's .top-bar-actions and in the backer page's .bp-top alike.
 */
export default function ThemeButton({ theme, nextThemeLabel, onToggle, className = 'btn btn-ghost btn-icon' }) {
  const text = `Switch to ${nextThemeLabel} mode`;
  return (
    <button type="button" className={className} onClick={onToggle} title={text} aria-label={text}>
      {React.createElement(Icon[THEME_ICON[theme]] || Icon.moon)}
    </button>
  );
}
