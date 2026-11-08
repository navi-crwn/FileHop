/* "1-3,7,9-" → zero-based page indices, clamped to the document.
   Kept in its own module so it can be tested without pdf-lib or a browser. */

export function parsePages(spec: string, total: number): number[] {
  const out = new Set<number>();
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(p);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : total;
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i - 1);
    } else {
      const n = parseInt(p, 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) out.add(n - 1);
    }
  }
  if (out.size === 0) throw new Error('bad_page_selection');
  return [...out].sort((a, b) => a - b);
}

/** same grammar as your typical PDF print dialog, and honest about junk */
export function looksLikePages(spec: string): boolean {
  return /^[\d,\s-]*\d[\d,\s-]*$/.test(spec.trim());
}
