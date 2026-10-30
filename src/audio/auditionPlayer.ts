/**
 * Hearing a suggestion before and after: the same bars rendered twice, A (the song now) and B (the
 * song as the suggestion would make it), each looped over exactly those bars through its own gain
 * after the master. A switch between them is a 20 ms crossfade at the same place in the music: the
 * one switched to starts again at the bar (and part of a bar) the other had reached, so a
 * suggestion that changes the tempo (A and B of different lengths) still switches in step. Both are rendered as the export would (recordings as live playback has
 * them) and the song itself is never touched: no store change, no undo step, no autosave.
 *
 * Ears first: playback fades in, every switch and the stop fade, and a B more than LOUDER_LIMIT_LU
 * louder than A is played turned down to A + LOUDER_LIMIT_LU (the note says so). The caller pauses
 * the song's own playback first, and it's one preview among the app's others: starting, it stops
 * any other (Try it in a game, the audition pads...), and another starting stops it
 * (exclusivePreview.ts). A small store says what's happening, for the suggestion card.
 */
import { create } from 'zustand';
import { liveContext, afterMaster } from './liveContext';
import { initAudio } from './engine';
import { measureRender, renderRange, type ListenSnapshot } from './listen';
import type { Tempo } from './tempoMap';
import { sameBarOffset } from './auditionMath';
import { claimPreview, registerPreview } from './exclusivePreview';

/** How long a switch between A and B takes, seconds. */
export const SWITCH_SECONDS = 0.02;
/** How long playback takes to come in, and to go when stopped, seconds. */
export const FADE_SECONDS = 0.08;
/** B is never played more than this many LU louder than A. */
export const LOUDER_LIMIT_LU = 6;

export interface AuditionState {
  /** The suggestion being heard (null: none). */
  key: string | null;
  /** Exactly what's rendered for it (the caller's renderKey: the suggestion's version), or null. */
  renderKey: string | null;
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

export const useAudition = create<AuditionState>(() => ({ key: null, renderKey: null, phase: 'idle', progress: 0, hearing: 'b', levelDiff: null, note: null, error: null, bars: null }));

type Side = 'a' | 'b';

interface Playing {
  /** Each side's source now, through a fade of its own (a restart fades the old one out). */
  voices: Record<Side, Voice>;
  /** When each source's loop began (context time). */
  began: Record<Side, number>;
  tempo: Record<Side, Tempo>;
  fromBar: number;
  buffers: Record<Side, AudioBuffer>;
  gains: Record<Side, GainNode>;
  heard: Side;
  /** The gain B plays at when heard (1, or less when it was turned down). */
  bLevel: number;
  master: GainNode;
}

let playing: Playing | null = null;
let rendering: AbortController | null = null;
/**
 * The last pair rendered, kept so a second Hear doesn't render again: for suggestion `key`, the
 * renders of `renderKey` (the caller's name for exactly what was rendered: the suggestion's version).
 */
let cache: { key: string; renderKey: string; a: AudioBuffer; b: AudioBuffer; bLevel: number; diff: number } | null = null;

// (the context the output after the master lives in, as the other previews play into it)
const raw = () => liveContext.rawContext as AudioContext;

function ramp(param: AudioParam, to: number, seconds: number) {
  const now = raw().currentTime;
  param.cancelAndHoldAtTime(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

/** This player's name among the previews (exclusivePreview.ts). */
const AUDITION_PREVIEW = 'suggestion';

/** Stop hearing (fading out). The renders are kept for next time. */
export function stopAudition(): void {
  rendering?.abort();
  rendering = null;
  const p = playing;
  playing = null;
  if (p) {
    ramp(p.master.gain, 0, FADE_SECONDS);
    const end = raw().currentTime + FADE_SECONDS + 0.02;
    for (const v of Object.values(p.voices)) {
      try {
        v.src.stop(end);
      } catch {
        // Already stopped
      }
    }
    window.setTimeout(() => p.master.disconnect(), (FADE_SECONDS + 0.1) * 1000);
  }
  useAudition.setState({ phase: 'idle', progress: 0 });
}

interface Voice {
  src: AudioBufferSourceNode;
  fade: GainNode;
}

/** A side's looped source from `offset` at `at`, through its own fade (from silence over SWITCH_SECONDS if `fadeIn`). */
function loopVoice(ctx: AudioContext, buffer: AudioBuffer, out: GainNode, at: number, offset: number, fadeIn: boolean): Voice {
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(fadeIn ? 0 : 1, at);
  if (fadeIn) fade.gain.linearRampToValueAtTime(1, at + SWITCH_SECONDS);
  fade.connect(out);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(fade);
  src.start(at, offset);
  return { src, fade };
}

/** Fade a voice out over SWITCH_SECONDS from `at`, then stop it: never cut while it may still be heard. */
function retire(v: Voice, at: number) {
  v.fade.gain.cancelScheduledValues(at);
  v.fade.gain.setValueAtTime(v.fade.gain.value, at);
  v.fade.gain.linearRampToValueAtTime(0, at + SWITCH_SECONDS);
  try {
    v.src.stop(at + SWITCH_SECONDS + 0.01);
  } catch {
    // Already stopped
  }
  v.src.onended = () => {
    v.src.disconnect();
    v.fade.disconnect();
  };
}

/** Switch between A (now) and B (suggested), crossfading in SWITCH_SECONDS at the same place in the music. */
export function hearAudition(which: Side): void {
  useAudition.setState({ hearing: which });
  const p = playing;
  if (!p || p.heard === which) return;
  const ctx = raw();
  const from = p.heard;
  const at = ctx.currentTime + 0.01;
  // The side switched to starts again where the other is now
  const offset = sameBarOffset(Math.max(0, at - p.began[from]), p.fromBar, { tempo: p.tempo[from], seconds: p.buffers[from].duration }, { tempo: p.tempo[which], seconds: p.buffers[which].duration });
  // (the old source of that side may still be fading from a switch a moment ago: it fades out as the new one fades in)
  retire(p.voices[which], at);
  p.voices[which] = loopVoice(ctx, p.buffers[which], p.gains[which], at, offset, true);
  p.began[which] = at - offset;
  p.heard = which;
  ramp(p.gains.a.gain, which === 'a' ? 1 : 0, SWITCH_SECONDS);
  ramp(p.gains.b.gain, which === 'b' ? p.bLevel : 0, SWITCH_SECONDS);
}

/** Forget the kept renders of suggestion `key` (or all) and stop hearing it. */
export function forgetAudition(key?: string): void {
  if (!key || cache?.key === key) cache = null;
  if (key && useAudition.getState().key === key) stopAudition();
}

/** The renders of the last audition, for checking (A and B, as heard). */
export const auditionBuffers = (): { a: AudioBuffer; b: AudioBuffer } | null => (cache ? { a: cache.a, b: cache.b } : null);

const tempoOf = (s: ListenSnapshot): Tempo => ({ bpm: s.bpm, points: s.tempoPoints ?? [] });

/**
 * Render bars [from, to) of `now` and `suggested` (unless `renderKey` was rendered last) and play
 * them looped, hearing `hearing` first. `key` is the suggestion. Resolves once playing (or stopped
 * or failed).
 */
export async function startAudition(opts: { key: string; renderKey: string; now: ListenSnapshot; suggested: ListenSnapshot; fromBar: number; toBar: number; hearing?: Side }): Promise<void> {
  stopAudition();
  const hearing = opts.hearing ?? 'b';
  useAudition.setState({ key: opts.key, renderKey: opts.renderKey, phase: 'rendering', progress: 0, hearing, note: null, error: null, bars: [opts.fromBar, opts.toBar] });
  const controller = new AbortController();
  rendering = controller;
  try {
    let pair = cache?.renderKey === opts.renderKey ? cache : null;
    if (!pair) {
      const signal = controller.signal;
      const a = await renderRange(opts.now, opts.fromBar, opts.toBar, { signal, progress: (f) => useAudition.setState({ progress: f * 0.45 }) });
      const b = await renderRange(opts.suggested, opts.fromBar, opts.toBar, { signal, progress: (f) => useAudition.setState({ progress: 0.45 + f * 0.45 }) });
      const [ma, mb] = [await measureRender(a, signal), await measureRender(b, signal)];
      const diff = Number.isFinite(ma.lufs) && Number.isFinite(mb.lufs) ? mb.lufs - ma.lufs : Number.isFinite(mb.lufs) ? Infinity : 0;
      // A B much louder than A is turned down to A + the limit (a B from silence: to -23 LUFS-ish, by its own level)
      const over = Number.isFinite(diff) ? diff - LOUDER_LIMIT_LU : Number.isFinite(mb.lufs) ? Math.max(0, mb.lufs + 23) : 0;
      pair = { key: opts.key, renderKey: opts.renderKey, a, b, diff, bLevel: over > 0 ? 10 ** (-over / 20) : 1 };
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
    // Both start at the top of the range (a switch puts the other at the same bar again)
    const at = ctx.currentTime + 0.05;
    const voices = { a: loopVoice(ctx, pair.a, gains.a, at, 0, false), b: loopVoice(ctx, pair.b, gains.b, at, 0, false) };
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(1, at + FADE_SECONDS);
    // The one preview playing: Try it in a game, the audition pads, the SFX maker... stop
    claimPreview(AUDITION_PREVIEW);
    playing = { voices, began: { a: at, b: at }, tempo: { a: tempoOf(opts.now), b: tempoOf(opts.suggested) }, fromBar: opts.fromBar, buffers: { a: pair.a, b: pair.b }, gains, heard: hearing, bLevel: pair.bLevel, master };
    const diff = pair.diff;
    useAudition.setState({
      phase: 'playing',
      progress: 1,
      levelDiff: Number.isFinite(diff) ? Math.round(diff * 10) / 10 : null,
      note: pair.bLevel < 1 ? `The suggestion is ${Number.isFinite(diff) ? `about ${Math.round(diff)} dB` : 'much'} louder (in loudness): it plays turned down to about ${LOUDER_LIMIT_LU} dB louder than the song as it is.` : null,
    });
  } catch (err) {
    if (rendering === controller) rendering = null;
    if (controller.signal.aborted) return;
    useAudition.setState({ phase: 'idle', error: err instanceof Error ? err.message : String(err) });
  }
}

// Another preview starting stops this one (one at a time, see exclusivePreview.ts)
registerPreview(AUDITION_PREVIEW, stopAudition);
