/**
 * How to install Fledgetone as an app in a browser that doesn't offer the install prompt to the
 * page (Safari, Firefox, or Chrome and Edge when they've decided not to): a short sentence by
 * browser and system. Plain logic on the user agent string, so Node tests it.
 */

/** What the page knows about where it runs. */
export interface InstallContext {
  userAgent: string;
  /** navigator.maxTouchPoints: an iPad reports itself as a Mac, with touch */
  maxTouchPoints: number;
  /** Whether this copy of the app can be installed at all (the one-file build can't: it has no manifest) */
  installable: boolean;
}

/** Where the installable app is published. */
export const APP_SITE = 'fledgetone.com';

/** The sentence telling how to install the app here. */
export function installAdvice({ userAgent: ua, maxTouchPoints, installable }: InstallContext): string {
  if (!installable) return `To install Fledgetone as an app, open ${APP_SITE} in Chrome, Edge or Safari and install it from there.`;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const edge = /Edg\//.test(ua);
  const chrome = /Chrome\/|CriOS\//.test(ua) && !edge;
  const firefox = /Firefox\/|FxiOS\//.test(ua);
  const safari = /Safari\//.test(ua) && !chrome && !edge && !firefox && !/Android/.test(ua);
  if (ios) return 'In Safari, tap Share, then Add to Home Screen.';
  if (safari) return 'In Safari, choose File › Add to Dock (or Share › Add to Dock).';
  if (edge) return 'In Edge, open the menu (…) › Apps › Install Fledgetone, or click the install icon at the right of the address bar.';
  if (/Android/.test(ua)) return firefox ? 'In Firefox, open the menu (⋮) › Install.' : 'Open the browser menu (⋮) › Install app (or Add to Home screen).';
  if (chrome) return 'In Chrome, click the install icon at the right of the address bar, or open the menu (⋮) › Cast, save and share › Install page as app.';
  if (firefox) return "Firefox on a computer doesn't install web apps: open Fledgetone in Chrome, Edge or Safari to install it. It works in Firefox as it is.";
  return "This browser doesn't offer to install web apps: open Fledgetone in Chrome, Edge or Safari to install it.";
}
