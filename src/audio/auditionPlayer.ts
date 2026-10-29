/**
 * Hearing a suggestion before and after: the same bars rendered twice, A (the song now) and B (the
 * song as the suggestion would make it), played looped and in step from the same moment, each
 * through its own gain after the master, so a switch between them is a 20 ms crossfade at the same
 * place in the music. Both are rendered as the export would (recordings as live playback has
 * them) and the song itself is never touched: no store change, no undo step, no autosave.
 *
 * Ears first: playback fades in, every switch and the stop fade, and a B more than LOUDER_LIMIT_LU
 * louder than A is played turned down to A + LOUDER_LIMIT_LU (the note says so). The caller pauses
 * the song's own playback first. A small store says what's happening, for the suggestion card.
 */
import { create } from 'zustand';
import { liveContext, afterMaster } from './liveContext';
import { initAudio } from './engine';
import { measureRender, renderRange, type ListenSnapshot } from './listen';

/** How long a switch between A and B takes, seconds. */
export const SWITCH_SECONDS = 0.02;
/** How long playback takes to come in, and to go when stopped, seconds. */
export const FADE_SECONDS = 0.08;
/** B is never played more than this many LU louder than A. */
export const LOUDER_LIMIT_LU = 6;

export interface AuditionState {
  /** The suggestion being heard (null: none). */
  key: string | null;
  phase: 'idle' | 'rendering' | 'playing';
  /** Rendering: how far, 0 to 1. */
  progress: number;
  hearing: 'a' | 'b';
  /** B's loudness against A's, LU (as rendered, before any turning down). */
  levelDiff: number | null;
  /** Plain words: B was turned down, or why it can't play. */
  note: string | null;
  error: string | null;
  /** The bars heard, [from, to). */
  bars: [number, number] | null;
}

export const useAudition = create<AuditionState>(() => ({ key: null, phase: 'idle', progress: 0, hearing: 'b', levelDiff: null, note: null, error: null, bars: null }));

interface Playing {
  sources: AudioBufferSourceNode[];
  gains: { a: GainNode; b: GainNode };
  /** The gain B plays at when heard (1, or less when it was turned down). */
  bLevel: number;
  master: GainNode;
}

let playing: Playing | null = null;
let rendering: AbortController | null = null;
/** The last pair rendered, kept so a second Hear doesn't render again. */
let cache: { key: string; a: AudioBuffer; b: AudioBuffer; bLevel: number; diff: number } | null = null;

// (the context the output after the master lives in, as the other previews play into it)
const raw = () => liveContext.rawContext as AudioContext;

function ramp(param: AudioParam, to: number, seconds: number) {
  const now = raw().currentTime;
  param.cancelAndHoldAtTime(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

/** Stop hearing (fading out). The renders are kept for next time. */
export function stopAudition(): void {
  rendering?.abort();
  rendering = null;
  const p = playing;
  playing = null;
  if (p) {
    ramp(p.master.gain, 0, FADE_SECONDS);
    const end = raw().currentTime + FADE_SECONDS + 0.02;
    for (const s of p.sources) {
      try {
        s.stop(end);
      } catch {
        // Already stopped
      }
    }
    window.setTimeout(() => p.master.disconnect(), (FADE_SECONDS + 0.1) * 1000);
  }
  useAudition.setState({ phase: 'idle', progress: 0 });
}

/** Switch between A (now) and B (suggested), crossfading in SWITCH_SECONDS. */
export function hearAudition(which: 'a' | 'b'): void {
  useAudition.setState({ hearing: which });
  if (!playing) return;
  ramp(playing.gains.a.gain, which === 'a' ? 1 : 0, SWITCH_SECONDS);
  ramp(playing.gains.b.gain, which === 'b' ? playing.bLevel : 0, SWITCH_SECONDS);
}

/** Forget the kept renders (the song or the suggestion changed). */
export function forgetAudition(key?: string): void {
  if (!key || cache?.key === key) cache = null;
  if (key && useAudition.getState().key === key) stopAudition();
}

/** The renders of the last audition, for checking (A and B, as heard). */
export const auditionBuffers = (): { a: AudioBuffer; b: AudioBuffer } | null => (cache ? { a: cache.a, b: cache.b } : null);

/**
 * Render bars [from, to) of `now` and `suggested` (unless the same `key` was rendered last) and
 * play them looped, hearing `hearing` first. Resolves once playing (or stopped or failed).
 */
export async function startAudition(opts: { key: string; now: ListenSnapshot; suggested: ListenSnapshot; fromBar: number; toBar: number; hearing?: 'a' | 'b' }): Promise<void> {
  stopAudition();
  const hearing = opts.hearing ?? 'b';
  useAudition.setState({ key: opts.key, phase: 'rendering', progress: 0, hearing, note: null, error: null, bars: [opts.fromBar, opts.toBar] });
  const controller = new AbortController();
  rendering = controller;
  try {
    let pair = cache?.key === opts.key ? cache : null;
    if (!pair) {
      const signal = controller.signal;
      const a = await renderRange(opts.now, opts.fromBar, opts.toBar, { signal, progress: (f) => useAudition.setState({ progress: f * 0.45 }) });
      const b = await renderRange(opts.suggested, opts.fromBar, opts.toBar, { signal, progress: (f) => useAudition.setState({ progress: 0.45 + f * 0.45 }) });
      const [ma, mb] = [await measureRender(a, signal), await measureRender(b, signal)];
      const diff = Number.isFinite(ma.lufs) && Number.isFinite(mb.lufs) ? mb.lufs - ma.lufs : Number.isFinite(mb.lufs) ? Infinity : 0;
      // A B much louder than A is turned down to A + the limit (a B from silence: to -23 LUFS-ish, by its own level)
      const over = Number.isFinite(diff) ? diff - LOUDER_LIMIT_LU : Number.isFinite(mb.lufs) ? Math.max(0, mb.lufs + 23) : 0;
      pair = { key: opts.key, a, b, diff, bLevel: over > 0 ? 10 ** (-over / 20) : 1 };
      cache = pair;
    }
    if (rendering !== controller) return;
    rendering = null;
    await initAudio();
    const ctx = raw();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(afterMaster());
    const gains = { a: ctx.createGain(), b: ctx.createGain() };
    gains.a.gain.value = hearing === 'a' ? 1 : 0;
    gains.b.gain.value = hearing === 'b' ? pair.bLevel : 0;
    gains.a.connect(master);
    gains.b.connect(master);
    // Both start at the same moment and loop the same length: always at the same place in the music
    const at = ctx.currentTime + 0.05;
    const sources = (['a', 'b'] as const).map((k) => {
      const src = ctx.createBufferSource();
      src.buffer = pair![k];
      src.loop = true;
      src.connect(gains[k]);
      src.start(at);
      return src;
    });
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(1, at + FADE_SECONDS);
    playing = { sources, gains, bLevel: pair.bLevel, master };
    const diff = pair.diff;
    useAudition.setState({
      phase: 'playing',
      progress: 1,
      levelDiff: Number.isFinite(diff) ? Math.round(diff * 10) / 10 : null,
      note: pair.bLevel < 1 ? `The suggestion is ${Number.isFinite(diff) ? `${Math.round(diff * 10) / 10} LU` : 'much'} louder: it plays turned down to ${LOUDER_LIMIT_LU} LU over the song as it is.` : null,
    });
  } catch (err) {
    if (rendering === controller) rendering = null;
    if (controller.signal.aborted) return;
    useAudition.setState({ phase: 'idle', error: err instanceof Error ? err.message : String(err) });
  }
}
