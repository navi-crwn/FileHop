/* Asks before something is thrown away, with the family dialog: HopUI from hop-ui.js,
   the hop-assets v5 file vendored under /hop-ui/v5/ and loaded by index.html, so the page
   still fetches nothing from another origin. If that script is not there, the browser's
   own confirm() asks instead, so a destructive button never acts unasked. */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** label of the confirming button */
  ok?: string;
  /** red button, and the focus starts on Cancel */
  danger?: boolean;
  /** the control that opened it: the dialog grows from there */
  anchor?: Element | null;
}

interface HopUI {
  confirm(o: ConfirmOptions): Promise<boolean>;
}

export function confirmAction(o: ConfirmOptions): Promise<boolean> {
  const ui = (globalThis as { HopUI?: HopUI }).HopUI;
  if (ui && typeof ui.confirm === 'function') return ui.confirm(o);
  return Promise.resolve(globalThis.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title));
}
