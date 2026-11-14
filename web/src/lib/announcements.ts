/* The family notice shown at the top of the dashboard. There is no list in the code: the Go server reads the hub's
   announcements.json (one source for the whole family) and hands the live notices to a signed-in browser inside
   /api/v1/me. The text is one language, the one the hub's admin typed, shown as it is. No data = no card, no space.
   A notice can be closed and then stays away for seven days (per notice id, in this browser); a critical one cannot. */
export type Announcement = {
  id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  /** a link on the hub's own domain, or nothing */
  url?: string;
  closable: boolean;
};

export const HIDE_DAYS = 7;
export const announceKey = (id: string) => `ann-${id}`;

/** Reads the notices out of the /api/v1/me answer, keeping only what is safe to draw. */
export function parseAnnouncements(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const out: Announcement[] = [];
  for (const r of raw.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue;
    const { id, level, title, body, url, closable } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title) continue;
    const lv = level === 'critical' || level === 'warning' ? level : 'info';
    out.push({
      id,
      level: lv,
      title,
      body: typeof body === 'string' ? body : '',
      url: typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined,
      closable: lv !== 'critical' && closable !== false
    });
  }
  return out;
}
