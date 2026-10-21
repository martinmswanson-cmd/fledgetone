/**
 * Waiting with a limit: a promise that gives up after a while, and a download that gives up when
 * no bytes have come for a while (a stuck connection, which the browser itself can wait on for
 * minutes). Either way the timer and the listeners are let go, so nothing is left behind. Also a
 * download's address with its set's fingerprint (versionedUrl). No audio
 * engine here, so Node can test it; recordingStore.ts and exportWav.ts use it.
 */

/** `promise`, or a rejection with `message` once `ms` have passed (or `signal` aborts first, with its reason). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(message));
    }, ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        done();
        resolve(v);
      },
      (err: unknown) => {
        done();
        reject(err);
      }
    );
  });
}

/**
 * Download `url`'s bytes, giving up (the request is cancelled) when nothing has arrived for
 * `stallMs`: no answer, or a body that stops coming. A slow download that keeps coming is never
 * cut off. Rejects on an HTTP error or a web page in place of the file, and with `signal`'s
 * reason when it aborts.
 */
export async function fetchBytes(url: string, stallMs: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  const onAbort = () => controller.abort(signal!.reason);
  if (signal?.aborted) throw signal.reason;
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    wake();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    // A page in place of the file: a server that answers a missing file with the app itself (the
    // phone app's own server, a preview) has none, so the next address is tried
    if (res.headers.get('content-type')?.startsWith('text/html')) throw new Error(`${url}: not here`);
    if (!res.body) return await res.arrayBuffer();
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      wake();
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out.buffer;
  } catch (err) {
    if (stalled) throw new Error(`${url}: nothing arrived for ${Math.round(stallMs / 1000)} s`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The address downloaded: with the set's fingerprint as `?v=`, so the server can let browsers keep a
 * recording for good (public/_headers) and a re-made set still arrives fresh, at a new address.
 */
export const versionedUrl = (url: string, version: string): string => (version ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : url);
