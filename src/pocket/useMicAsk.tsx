/**
 * Asking for the microphone in Pocket: in the phone app, the first time, a plain word about why
 * before the phone's own question; when it's refused, how to allow it, with a way to the app's
 * settings on Android (or the site's settings in a browser), and Try again.
 */
import React, { useCallback, useState } from 'react';
import { Mic, Settings } from 'lucide-react';
import { showToast } from '../components/timeline/toastStore';
import { isAndroidApp, isNativeApp, nativeOpenSettings } from '../native/nativeApp';
import { Sheet, pill } from './pocketUi';

const EXPLAINED_KEY = 'fledgetone.micExplained';

function explained(): boolean {
  try {
    return localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}
function markExplained(): void {
  try {
    localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    // Asked again next time: fine
  }
}

const refused = (err: unknown) => err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');

/**
 * Run something that opens the microphone (`go`), asking properly: in the app, the first time, a
 * word about why before the phone asks; if it's refused, how to allow it. Other failures are told
 * in a toast. `sheet` is what to show (put it in the screen).
 */
export function useMicAsk(): { ask: (go: () => Promise<void>) => void; sheet: React.ReactNode } {
  const [state, setState] = useState<{ kind: 'explain' | 'refused'; go: () => Promise<void> } | null>(null);
  const run = useCallback(async (go: () => Promise<void>) => {
    try {
      await go();
    } catch (err) {
      if (refused(err)) setState({ kind: 'refused', go });
      else showToast(`Couldn't start recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);
  const ask = useCallback(
    (go: () => Promise<void>) => {
      if (isNativeApp() && !explained()) setState({ kind: 'explain', go });
      else void run(go);
    },
    [run]
  );
  const close = useCallback(() => setState(null), []);
  let sheet: React.ReactNode = null;
  if (state?.kind === 'explain') {
    sheet = (
      <Sheet title="The microphone" onClose={close}>
        <div className="px-1 space-y-3">
          <p className="text-sm">Fledgetone needs the microphone to record your voice. It stays on your phone.</p>
          <p className="text-xs text-forge-muted">The phone asks next: allow it while using the app.</p>
          <button
            type="button"
            className={`${pill} w-full !border-cyan-400 text-cyan-200`}
            onClick={() => {
              markExplained();
              const { go } = state;
              setState(null);
              void run(go);
            }}
          >
            <Mic className="w-4 h-4" /> Continue
          </button>
          <button type="button" className={`${pill} w-full`} onClick={close}>
            Not now
          </button>
        </div>
      </Sheet>
    );
  } else if (state?.kind === 'refused') {
    sheet = (
      <Sheet title="The microphone is off" onClose={close}>
        <div className="px-1 space-y-3">
          {isNativeApp() ? (
            <p className="text-sm">
              Fledgetone isn't allowed to use the microphone, so it can't record. To allow it, open Fledgetone's settings, then Permissions, Microphone, and choose
              Allow only while using the app.
            </p>
          ) : (
            <p className="text-sm">The browser didn't allow the microphone, so Fledgetone can't record. Allow it in the site's settings (the icon beside the address), then try again.</p>
          )}
          {isAndroidApp() && (
            <button
              type="button"
              className={`${pill} w-full !border-cyan-400 text-cyan-200`}
              onClick={() => void nativeOpenSettings().then((ok) => !ok && showToast("Couldn't open the settings: find Fledgetone under Settings, Apps"))}
            >
              <Settings className="w-4 h-4" /> Open Fledgetone's settings
            </button>
          )}
          <button
            type="button"
            className={`${pill} w-full`}
            onClick={() => {
              const { go } = state;
              setState(null);
              void run(go);
            }}
          >
            Try again
          </button>
        </div>
      </Sheet>
    );
  }
  return { ask, sheet };
}
