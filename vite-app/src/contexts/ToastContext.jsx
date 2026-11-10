import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500, action = null) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200);
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200);
  }, []);

  const ctx = useMemo(() => ({
    // opts: { duration, action: { label, onClick } } (a toast's one button, e.g. View or Undo).
    success: (msg, opts = {}) => addToast(msg, 'success', opts.duration || 3500, opts.action || null),
    error: (msg, opts = {}) => addToast(msg, 'error', opts.duration || 5000, opts.action || null),
    info: (msg, opts = {}) => addToast(msg, 'info', opts.duration || 3500, opts.action || null),
  }), [addToast]);

  const icons = { success: '\u2713', error: '\u2715', info: '\u2139' };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map(t => (
            <div
              key={t.id}
              className={'toast toast-' + t.type + (t.exiting ? ' exiting' : '')}
              onClick={() => dismiss(t.id)}
            >
              <span className="toast-icon">{icons[t.type]}</span>
              <span className="toast-message">{t.message}</span>
              {t.action && (
                <button type="button" className="toast-action"
                  onClick={(e) => { e.stopPropagation(); dismiss(t.id); t.action.onClick(); }}>
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export { ToastContext };
export default ToastContext;
