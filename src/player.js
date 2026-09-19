export function parseResumeTimestamp(search = '') {
  const raw = new URLSearchParams(search).get('t');
  if (raw == null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
