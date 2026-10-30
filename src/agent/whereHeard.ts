/**
 * Where a suggestion's changes are heard, found by sound: the song as it is (A) and as the
 * suggestion would make it (B) rendered whole, from bar 1 to past the end of the music (as the
 * before-and-after renders them, listen.ts renderRange), and compared bar by bar (barDifferences in
 * listenReport.ts, the agent's listen's own measure): a bar whose difference is above
 * HEARD_DIFFERENCE_DB (-70 dBFS, far under anything heard in a mix: renders are exact, so a bar
 * nothing reaches comes out the same to the sample), or that the tempo moved, sounds different.
 * The suggestion's regions are then the rules' (songDiff.ts: never fewer bars than the truth) and
 * those bars together (withSoundRegions), so a change the rules don't see reaching somewhere (an
 * automation lane holding, a glide speeding up the bars before it, a held controller, a long echo)
 * is played, and must be heard, too.
 *
 * It runs in the background as soon as a suggestion arrives (one at a time, after a moment of
 * quiet, never while the song plays: Play stops it, and it starts again once the song stops), and
 * at once when the musician presses Hear on one it hasn't been found for (the card says "Finding
 * where it changes…", and Stop cancels it). A song longer than MEASURE_MAX_SECONDS (before or
 * after) isn't rendered whole: the rules' regions alone are used (`foundWhy` 'too_long'), as when a
 * render fails ('failed').
 */
import { create } from 'zustand';
import type { ProjectSnapshot } from '../store/project';
import { currentProject, useTimelineStore } from '../store/timelineStore';
import { musicEnd, renderRange } from '../audio/listen';
import { channelsOf } from '../audio/exportWav';
import { barToSeconds, secondsToBar } from '../audio/tempoMap';
import { barDifferences, changedRegions, type BarSpan } from './listenReport';
import { listenSnapshot } from './listenSnapshot';
import { useAudition } from '../audio/auditionPlayer';
import { isOpen, rangeSeconds, updateSuggestion, useSuggestions, withSoundRegions, type Suggestion } from './suggestionsStore';
import type { BarRange } from './songDiff';

/** The longest song rendered whole to find where a suggestion is heard (the slower of before and after), seconds. */
export const MEASURE_MAX_SECONDS = 240;
/** Rendered past the end of the music (and of every region), seconds: what rings out after it. */
export const MEASURE_TAIL_SECONDS = 4;
/** How long the studio waits, quiet, before finding where a suggestion is heard in the background, ms. */
export const MEASURE_IDLE_MS = 1200;

/** What's being found now: for the card ("Finding where it changes…", how far). */
export interface FindingState {
  /** The suggestion, and its version (null: nothing). */
  id: string | null;
  version: number;
  /** 0 to 1. */
  progress: number;
  /** The musician asked for it (Hear): the card shows it. */
  asked: boolean;
}

export const useFinding = create<FindingState>(() => ({ id: null, version: 0, progress: 0, asked: false }));

const tempoOf = (s: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>) => ({ bpm: s.bpm, points: s.tempoPoints ?? [] });

/** Where each of bars [1, end) lies in a render from bar 1, seconds. */
function spansOf(song: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>, end: number): BarSpan[] {
  const t = tempoOf(song);
  const out: BarSpan[] = [];
  for (let bar = 1; bar < end; bar++) out.push({ start: barToSeconds(bar, t), end: barToSeconds(bar + 1, t) });
  return out;
}

/**
 * The bars to render to find where `s` is heard, from bar 1: past the end of the music in either
 * version and of every region the rules found, by MEASURE_TAIL_SECONDS (in the slower of the two).
 */
export function measureEnd(before: ProjectSnapshot, s: Pick<Suggestion, 'song' | 'ruleRegions'>): number {
  const end = Math.max(musicEnd(before), musicEnd(s.song), ...s.ruleRegions.map((r) => r.toBar));
  const past = Math.max(...[before, s.song].map((x) => secondsToBar(barToSeconds(end, tempoOf(x)) + MEASURE_TAIL_SECONDS, tempoOf(x))));
  return Math.max(end + 1, Math.ceil(past - 1e-9));
}

type Found = { sound: BarRange[] } | { why: 'too_long' | 'failed' } | null;

/** Render `before` and `s.song` whole and compare them (null: aborted). */
async function measure(before: ProjectSnapshot, s: Suggestion, signal: AbortSignal, progress: (f: number) => void): Promise<Found> {
  const end = measureEnd(before, s);
  if (rangeSeconds({ fromBar: 1, toBar: end }, [before, s.song]) > MEASURE_MAX_SECONDS) return { why: 'too_long' };
  try {
    const a = await renderRange(listenSnapshot(before), 1, end, { signal, progress: (f) => progress(f * 0.5) });
    if (signal.aborted) return null;
    const b = await renderRange(listenSnapshot(s.song), 1, end, { signal, progress: (f) => progress(0.5 + f * 0.5) });
    if (signal.aborted) return null;
    const diffs = barDifferences(channelsOf(a), channelsOf(b), a.sampleRate, spansOf(before, end), spansOf(s.song, end));
    return { sound: changedRegions(diffs, 1) };
  } catch (err) {
    if (signal.aborted) return null;
    console.warn('Finding where a suggestion is heard failed:', err);
    return { why: 'failed' };
  }
}

interface Job {
  id: string;
  version: number;
  controller: AbortController;
  /** Resolves true once found (or it can't be), false if stopped first. */
  done: Promise<boolean>;
  asked: boolean;
}

let job: Job | null = null;

/** Whether `s` still needs finding: open, made on the song as it is, and not found by sound for this version (nor known it can't be). */
export const needsFinding = (s: Suggestion): boolean => isOpen(s) && !s.stale && s.found === 'rules' && !s.foundWhy;

/** Stop finding (for `id` only, if given). What was found so far is dropped. */
export function stopFinding(id?: string): void {
  if (!job || (id !== undefined && job.id !== id)) return;
  job.controller.abort();
  job = null;
  useFinding.setState({ id: null, version: 0, progress: 0, asked: false });
}

/**
 * Find where suggestion `id` is heard, by sound, on `before` (the song it's made on now), unless
 * it's found already: true once it is (or it can't be: too long, or the render failed; its regions
 * are the rules' then), false if it was stopped (Stop, the song played, another song) or isn't
 * waiting any more. The musician's own press (Hear): what's finding another is stopped first.
 */
export function findWhere(id: string, before: ProjectSnapshot = currentProject(), asked = true): Promise<boolean> {
  const s = useSuggestions.getState().suggestions.find((x) => x.id === id);
  if (!s || !isOpen(s) || s.stale) return Promise.resolve(false);
  if (!needsFinding(s)) return Promise.resolve(true);
  if (job && job.id === id && job.version === s.version) {
    if (asked && !job.asked) {
      job.asked = true;
      useFinding.setState({ asked: true });
    }
    return job.done;
  }
  stopFinding();
  const controller = new AbortController();
  const version = s.version;
  useFinding.setState({ id, version, progress: 0, asked });
  const done = (async () => {
    const found = await measure(before, s, controller.signal, (f) => {
      if (job?.controller === controller) useFinding.setState({ progress: f });
    });
    if (job?.controller !== controller) return false;
    job = null;
    useFinding.setState({ id: null, version: 0, progress: 0, asked: false });
    if (!found) return false;
    const now = useSuggestions.getState().suggestions.find((x) => x.id === id);
    if (!now || now.version !== version || now.stale || !isOpen(now)) return false;
    updateSuggestion(id, (x) => ('sound' in found ? withSoundRegions(x, found.sound, before) : { ...x, foundWhy: found.why }));
    return true;
  })();
  job = { id, version, controller, done, asked };
  return done;
}

let idle = 0;

/**
 * Find, in the background, where the waiting suggestions are heard, one after another: after
 * MEASURE_IDLE_MS of quiet, never while the song plays (nor while a suggestion's own render for
 * its before-and-after is under way).
 */
export function queueFinding(): void {
  if (typeof window === 'undefined') return;
  watchFinding();
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    idle = 0;
    if (job || useTimelineStore.getState().isPlaying) return;
    // (a before-and-after rendering now goes first: try again in a moment)
    if (useAudition.getState().phase === 'rendering') return queueFinding();
    const next = useSuggestions.getState().suggestions.find(needsFinding);
    if (!next) return;
    void findWhere(next.id, currentProject(), false).then(() => queueFinding());
  }, MEASURE_IDLE_MS);
}

let watching = false;

/** Stop finding in the background while the song plays, and start again once it stops. Once. */
export function watchFinding(): void {
  if (watching) return;
  watching = true;
  useTimelineStore.subscribe((st, prev) => {
    if (st.isPlaying === prev.isPlaying) return;
    if (st.isPlaying) stopFinding();
    else queueFinding();
  });
}
