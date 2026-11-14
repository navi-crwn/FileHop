/* The notice shown at the top of the dashboard. The list is fixed in the code and empty by default: no notice
   means no card and no empty space. To announce something, add an entry and ship it; the card can be closed and
   then stays away for seven days (per notice id, in this browser). Text per language, English as the fallback. */
export type Announcement = {
  id: string;
  text: Partial<Record<string, string>> & { en: string };
  /* optional single link */
  href?: string;
  linkText?: Partial<Record<string, string>> & { en: string };
};

/* VITE_DEMO_ANNOUNCEMENT=1 at build time adds one sample notice, only to look at the card in a preview build. */
export const ANNOUNCEMENTS: Announcement[] = import.meta.env?.VITE_DEMO_ANNOUNCEMENT
  ? [{ id: 'demo', text: { en: 'Scheduled maintenance on Sunday 15 November, 02:00 to 03:00 UTC. FileHop stays usable; signing in may pause for a few minutes.' } }]
  : [];

export const HIDE_DAYS = 7;
export const announceKey = (id: string) => `filehop-announce-${id}`;
