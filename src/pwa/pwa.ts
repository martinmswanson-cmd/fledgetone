/**
 * Fledgetone as an installed app: registers the service worker (src/pwa/sw.js, production builds
 * on fledgetone.com only), tells when a new version is ready (the page moves to it only when the
 * person clicks Reload, after writing the autosave, and then opens What's new at its entries),
 * offers the browser's install prompt, and asks the browser to keep this site's storage (the
 * autosave, the library and the recordings) when the disk runs low.
 *
 * It looks for a new version when the app opens and about every 30 minutes, only while online
 * and not playing or exporting; one that arrives meanwhile is announced once that's over
 * (UpdateNotice.tsx waits for busyNow to clear).
 *
 * The dev server never registers a worker, and removes any left by a production preview on the
 * same address, so it always serves the code being edited. The one-file build (published as
 * fledgetone.html) has no worker: it says so with <meta name="fledgetone-build" content="single">.
 */
import { create } from 'zustand';
import { flushAutosave, useTimelineStore } from '../store/timelineStore';
import { useRenderBusy } from '../audio/renderBusy';
import { useUiStore } from '../store/uiStore';
import { installAdvice } from './installAdvice';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** A new version is installed and waiting for Reload */
  updateReady: boolean;
  /** Its version number (package.json), when the worker says */
  updateVersion: string | null;
  /** The browser offered its install prompt (Chrome, Edge) */
  canPrompt: boolean;
  /** Running as the installed app (its own window), or installed from this tab */
  installed: boolean;
  /** Whether the browser keeps this site's storage when the disk runs low (null: not known yet, or no such setting) */
  persisted: boolean | null;
}

export const usePwa = create<PwaState>(() => ({ updateReady: false, updateVersion: null, canPrompt: false, installed: false, persisted: null }));

/** The one-file build: no worker, no manifest. */
export const isSingleFileBuild = (): boolean => typeof document !== 'undefined' && !!document.querySelector('meta[name="fledgetone-build"][content="single"]');

/** Remembered across the reload into a new version: open What's new once it's running. */
const WHATS_NEW_KEY = 'fledgetone.whatsNewAfterUpdate';

/** How often to look for a new version while the app stays open. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

let installEvent: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let reloading = false;

const runningInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Not a moment to interrupt: playing, or rendering an export or a freeze. */
export const busyNow = (): boolean => useTimelineStore.getState().isPlaying || useRenderBusy.getState().running > 0;

/** Read whether storage is kept for good, and ask for it when `ask` (the browser may say no, silently). */
export async function checkPersistence(ask = false): Promise<boolean | null> {
  const storage = navigator.storage;
  if (!storage?.persisted) return null;
  try {
    let kept = await storage.persisted();
    if (!kept && ask && storage.persist) kept = await storage.persist();
    usePwa.setState({ persisted: kept });
    return kept;
  } catch {
    return null;
  }
}

/** How much this site keeps in the browser (bytes), and about how much it may use. */
export async function storageUse(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Show the install prompt where the browser offers it; else the sentence telling how. */
export async function installApp(): Promise<string | undefined> {
  if (installEvent) {
    const e = installEvent;
    installEvent = null;
    usePwa.setState({ canPrompt: false });
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === 'accepted' ? undefined : 'Not installed. You can install Fledgetone any time from Help › Install Fledgetone.';
  }
  return installAdvice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, installable: !isSingleFileBuild() });
}

/**
 * Move to the waiting version: write the autosave first (after the reload, Restore brings the work
 * back), then reload once the new worker has taken over. Returns why it didn't, or undefined.
 */
export function reloadToUpdate(): string | undefined {
  if (!flushAutosave()) return "Your work couldn't be autosaved (the browser's storage is full): save it with File › Save first, then Reload.";
  try {
    localStorage.setItem(WHATS_NEW_KEY, usePwa.getState().updateVersion ?? 'next');
  } catch {
    // No storage: What's new just doesn't open by itself
  }
  reloading = true;
  if (!waiting) {
    window.location.reload();
    return undefined;
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // If the worker doesn't take over (another tab holds the old one), reload anyway: the person asked for it
  window.setTimeout(() => window.location.reload(), 3000);
  return undefined;
}

/** After the reload into a new version: What's new, once (it opens at the running version's entries). */
function whatsNewAfterUpdate(): void {
  let pending: string | null = null;
  try {
    pending = localStorage.getItem(WHATS_NEW_KEY);
    if (pending) localStorage.removeItem(WHATS_NEW_KEY);
  } catch {
    return;
  }
  if (pending) useUiStore.getState().setDialog('changes');
}

/** Ask a worker which version it brings. */
function versionOf(w: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => {
      window.clearTimeout(timer);
      resolve(typeof e.data?.version === 'string' ? e.data.version : null);
    };
    w.postMessage({ type: 'VERSION' }, [ch.port2]);
  });
}

function watchForUpdates(reg: ServiceWorkerRegistration): void {
  const ready = async (w: ServiceWorker) => {
    // Only an update: the first install has no page of an older version to replace
    if (!navigator.serviceWorker.controller) return;
    waiting = w;
    usePwa.setState({ updateReady: true, updateVersion: await versionOf(w) });
  };
  if (reg.waiting) void ready(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') void ready(w);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) window.location.reload();
  });
  // Look again every 30 minutes and when the app comes back into view, only while online and
  // quiet (a check skipped while busy happens at the next one)
  const check = () => {
    if (navigator.onLine === false || busyNow() || usePwa.getState().updateReady) return;
    void reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.setInterval(check, UPDATE_CHECK_MS);
}

/** Start it all (once, from main.tsx). */
export function startPwa(): void {
  if (typeof window === 'undefined') return;
  usePwa.setState({ installed: runningInstalled() });
  whatsNewAfterUpdate();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // the app offers it from the Help menu, not the browser's own bar at once
    installEvent = e as InstallPromptEvent;
    usePwa.setState({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    usePwa.setState({ installed: true, canPrompt: false });
    void checkPersistence(true);
  });

  // Keep the work: once installed, or once there's a song of the person's own (its first autosave)
  void checkPersistence(runningInstalled());
  const stop = useTimelineStore.subscribe((s) => {
    if (!s.autosaveStatus?.ok) return;
    stop();
    void checkPersistence(true);
  });

  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    // The dev server: a worker left by a preview build on this address would serve stale code
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }
  if (isSingleFileBuild() || !window.isSecureContext) return;
  // Registering looks for a new version too, as every opening of the app does (when online)
  // Under the build's base: / for the app on its own, /app/ on fledgetone.com (npm run build:site)
  const base = import.meta.env.BASE_URL;
  const register = () =>
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then(watchForUpdates)
      .catch(() => {});
  // After the page has loaded, so the worker's downloads don't compete with the app's own
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
