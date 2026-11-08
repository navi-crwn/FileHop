/* Runtime capability probes. Safe to import from the worker as well as the page:
   everything DOM-only is guarded, so the worker never touches `window`. */

const hasDom = typeof document !== 'undefined';

export const ISOLATED: boolean = (() => {
  try {
    return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  } catch {
    return false;
  }
})();

/** Does this browser actually encode AVIF? Canvas silently hands back a PNG
    when it cannot, so the returned MIME tells the truth. */
export const AVIF_ENCODABLE: boolean = (() => {
  if (!hasDom) return false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    return false;
  }
})();

/** HEIC in, when the platform decoder knows it (Safari). */
export const HEIC_DECODABLE: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
})();

export const HAS_FS_ACCESS: boolean = (() => {
  if (!hasDom) return false;
  return typeof (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
})();

export const REDUCED_MOTION: boolean = (() => {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();
