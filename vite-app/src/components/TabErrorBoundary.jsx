import React from 'react';
import Icon from './Icon.jsx';

/**
 * One tab's error boundary (App improvements 451). A record a screen cannot read used to unmount the whole
 * app: no top bar, no tab bar, an empty page that a reload could not fix. Now the tab that failed says so
 * where its content was, the rest of the app untouched: Try again remounts it, Go to Schedule leaves it.
 * main.jsx keeps one more around the root as the last resort.
 */
export default class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, epoch: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The tab and the error stay visible in the console (and in a crash report) though the screen recovers.
    console.error(`[tab] ${this.props.name || 'A tab'} could not be shown:`, error, info && info.componentStack);
  }

  render() {
    const { error, epoch } = this.state;
    if (!error) return <React.Fragment key={epoch}>{this.props.children}</React.Fragment>;
    const name = this.props.name || 'This tab';
    // A tab whose code could not be fetched (offline, or a deploy renamed it) is said so; Try again then reloads
    // once online, since a failed import is not retried by a remount (App improvements 452).
    const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch|Unable to preload|Loading chunk/i.test(String(error && (error.message || error)));
    const retry = () => {
      if (chunk && navigator.onLine) { window.location.reload(); return; }
      this.setState((s) => ({ error: null, epoch: s.epoch + 1 }));
    };
    return (
      <div className="tab-error" role="alert">
        <span className="tab-error-mark" aria-hidden="true">{Icon.warn ? <Icon.warn /> : '!'}</span>
        <h2 className="tab-error-title">{name === 'app' ? 'The app' : name === 'This tab' ? 'This tab' : `The ${name} tab`} couldn&rsquo;t be shown</h2>
        <p className="tab-error-body">{chunk
          ? 'Its screen loads the first time you open it, and the connection dropped (or the app was just updated).'
          : 'Nothing you saved is affected, and the other tabs still work.'}</p>
        <div className="tab-error-actions">
          <button type="button" className="btn btn-primary ctl tab-error-retry" onClick={retry}>
            <span>Try again</span>
          </button>
          {this.props.onSchedule && (
            <button type="button" className="btn btn-ghost ctl tab-error-leave" onClick={() => { this.setState((s) => ({ error: null, epoch: s.epoch + 1 })); this.props.onSchedule(); }}>
              <span>Go to Schedule</span>
            </button>
          )}
        </div>
      </div>
    );
  }
}
