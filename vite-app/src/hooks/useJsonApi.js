import { useCallback } from 'react';
import { API_URL } from '../utils/api.js';

/**
 * A JSON caller for one session: api(method, path, body) -> { status, data }. It never throws: a
 * network failure is status 0 with empty data, and a body that is not JSON reads as {}. `base` is a
 * path prefix under /api (the Standing view uses none; the dashboard import, /bankrolls/import/dashboard).
 */
export default function useJsonApi(token, base = '') {
  return useCallback(async (method, path, body) => {
    try {
      const res = await fetch(`${API_URL}${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (_) { return { status: 0, data: {} }; }
  }, [token, base]);
}
