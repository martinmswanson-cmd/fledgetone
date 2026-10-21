/**
 * Fledgetone as a phone app (Capacitor, see capacitor.config.json and docs/APP.md): the native
 * pieces a web page can't have on a phone, behind plain functions the rest of the code calls. On
 * the web each one does nothing (or answers false), so callers keep their browser way as well.
 *
 * - Haptics: a light tap on a pad (iPhones give none to web pages).
 * - The screen kept awake while the song plays.
 * - Files: exports and project files go to the phone's share sheet (a web view can't download),
 *   from where they're saved to Files, iCloud Drive or sent on.
 * - Links: a shared song links to fledgetone.com, not to the app's own local address.
 * - Android: the app's page in the phone's settings (a microphone refused for good is allowed
 *   there), and a project file opened in the app from another one ("Open with", "Share"), both
 *   through the app's own small plugin (android/.../FledgetonePlugin.java).
 *
 * The audio session (sound with the silent switch on, and on in the background) and the
 * microphone are set in the native projects themselves (ios/, android/). What happens when the
 * app goes to the background or Back is pressed is in appLifecycle.ts.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Running as the phone app (not in a browser). */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Running as the Android app. */
export const isAndroidApp = (): boolean => isNativeApp() && Capacitor.getPlatform() === 'android';

/** The app's own plugin (Android only). */
interface FledgetonePlugin {
  openSettings(): Promise<void>;
  takeOpenedFile(): Promise<{ name?: string; text?: string }>;
  addListener(event: 'fileOpened', listener: () => void): Promise<PluginListenerHandle>;
}
const fledgetone = registerPlugin<FledgetonePlugin>('Fledgetone');

/** Open the app's page in the phone's settings (Permissions there). False where there's none. */
export async function nativeOpenSettings(): Promise<boolean> {
  if (!isAndroidApp()) return false;
  try {
    await fledgetone.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand each project file opened in the app from another app to `open`: the one it was started
 * with, and any that arrive while it runs. (Android; nothing elsewhere.) `failed` hears why one
 * couldn't be read.
 */
export function onOpenedFiles(open: (file: File) => void, failed: (reason: string) => void): void {
  if (!isAndroidApp()) return;
  const take = () =>
    fledgetone.takeOpenedFile().then(
      ({ name, text }) => {
        if (text !== undefined) open(new File([text], name || 'project.json', { type: 'application/json' }));
      },
      (err) => failed(err instanceof Error ? err.message : String(err))
    );
  void fledgetone.addListener('fileOpened', () => void take()).catch(() => {});
  void take();
}

/** Where shared links point from the app: the studio on fledgetone.com opens them. */
export const APP_LINK_BASE = 'https://fledgetone.com/app/';

/** A light tap, as a pad answers a finger. */
export function nativeTap(): void {
  if (!isNativeApp()) return;
  void import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
}

/** Keep the screen on (true) or let it sleep again (false). */
export function nativeKeepAwake(on: boolean): void {
  if (!isNativeApp()) return;
  void import('@capacitor-community/keep-awake')
    .then(({ KeepAwake }) => (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()))
    .catch(() => {});
}

/** The file as base64, for the native file system. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  // In pieces: a whole song's bytes at once overflow the call stack
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Hand a file to the phone's share sheet (save to Files, iCloud Drive, send it). Resolves true
 * once shared, false if closed without sharing; throws if it couldn't be offered.
 */
export async function nativeShareFile(blob: Blob, name: string): Promise<boolean> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  // (A plain name: the share sheet shows it, and the file system refuses slashes)
  const safe = name.replace(/[/\\:]/g, '-');
  const { uri } = await Filesystem.writeFile({ path: safe, data: await base64Of(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: safe, files: [uri] });
    return true;
  } catch (err) {
    // Closed without choosing: not a failure
    if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return false;
    throw err;
  }
}

/** Hand a link to the phone's share sheet. True once shared or closed, false if there's none. */
export async function nativeShareLink(url: string, title: string): Promise<boolean> {
  const { Share } = await import('@capacitor/share');
  try {
    await Share.share({ title, url });
  } catch {
    // Closed without choosing
  }
  return true;
}

/** Set the app's frame once at start: a dark status bar over the dark app, the splash let go. */
export function startNativeApp(): void {
  if (!isNativeApp()) return;
  void import('@capacitor/status-bar').then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Dark })).catch(() => {});
  void import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {});
}
