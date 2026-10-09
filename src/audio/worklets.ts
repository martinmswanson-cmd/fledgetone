import type * as Tone from 'tone';

/**
 * AudioWorklet modules by context. The processors' code lives in strings (ott.ts, loudness.ts),
 * loaded through a Blob URL so the one-file build needs no extra file. Each module is added once
 * per audio context (the live one, and each WAV export's offline one); Tone's own
 * addAudioWorkletModule remembers only one module per context, so this keeps its own list.
 */
const loaded = new WeakMap<object, Map<string, Promise<void>>>();
const urls = new Map<string, string>();

/** Load the processor `name` from `source` into the context (once), ready for createWorkletNode. */
export function loadWorklet(context: Tone.BaseContext, name: string, source: string): Promise<void> {
  const raw = context.rawContext as unknown as BaseAudioContext;
  let modules = loaded.get(raw);
  if (!modules) {
    modules = new Map();
    loaded.set(raw, modules);
  }
  let loading = modules.get(name);
  if (!loading) {
    if (!raw.audioWorklet) return Promise.reject(new Error('AudioWorklet needs a secure context (https or localhost)'));
    let url = urls.get(name);
    if (!url) {
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      urls.set(name, url);
    }
    loading = raw.audioWorklet.addModule(url);
    modules.set(name, loading);
    // A failed load can be tried again
    loading.catch(() => modules.delete(name));
  }
  return loading;
}

/**
 * A worklet node for a loaded processor. Tone picks the right class: a native AudioWorkletNode
 * for the export's native offline context, standardized-audio-context's for the live one.
 */
export function createWorkletNode(context: Tone.BaseContext, name: string, options: AudioWorkletNodeOptions): AudioWorkletNode {
  return context.createAudioWorkletNode(name, options) as unknown as AudioWorkletNode;
}
