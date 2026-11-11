/* A person as a short label (the owner's rule: "E. Bennett", the first initial and the last name). One
   word stays as it is; no real name falls back to the username. Pure. */
export function initialName(realName, username = '') {
  const parts = String(realName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`;
  if (parts.length === 1) return parts[0];
  return String(username || '');
}
