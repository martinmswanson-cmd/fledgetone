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
 * once its before-and-after starts when the musician presses Hear on one it hasn't been found for:
 * Hear never waits for it, the rules' regions play at once (the card says "Finding where it
 * changes…", said once to screen readers, and Stop cancels it), and what it finds besides makes it
 * heard only in part until that's played too. A search whose result can't be used any more (the
 * suggestion answered, changed or made again, another song) stops; the next waiting one follows
 * whenever one ends. A song of the musician's longer than
 * MEASURE_MAX_SECONDS isn't rendered whole (`foundWhy` 'too_long': decided by the song as it is,
 * so a suggestion can't make it so), nor one a suggestion makes longer than
 * MEASURE_RENDER_MAX_SECONDS ('made_too_long'): the rules' regions alone are used, as when a render
 * fails ('failed'), and the card says it wasn't checked by sound; if its rules may count fewer bars
 * than the truth (a tail the studio doesn't know: Suggestion.sure), Accept always asks for its
 * second press (suggestionsStore.ts uncheckedTail).
 *
 * The same two renders are measured too, bar by bar (loudness from their gating blocks, and true
 * peak): where Suggested comes out much louder than the song (safety.ts measuredRise) and the
 * rules' cautions said nothing about level (or less than it measured), the card gets a caution of
 * its own (measuredCaution, withMeasured). Until the check has run (or where it can't be), a
 * before-and-after's own renders measured the same way stand in (auditionRise, songWatch.ts): as
 * soon as they're rendered, before it plays, and it plays Suggested turned down by its loudest bar
 * over auditionPlayer.ts LOUDER_LIMIT_LU.
 */
import { create } from 'zustand';
import type { ProjectSnapshot } from '../store/project';
import { currentProject, useTimelineStore } from '../store/timelineStore';
import { renderRange } from '../audio/listen';
import { channelsOf } from '../audio/exportWav';
import { barToSeconds, type Tempo } from '../audio/tempoMap';
import { createLoudnessAnalyser, truePeakOf } from '../audio/loudness';
import { barDifferences, barLoudness, changedRegions, type BarSpan } from './listenReport';
import { measuredRise, type BarLevel, type MeasuredRise } from './safety';
import { maxOf } from '../support/minMax';
import { listenSnapshot } from './listenSnapshot';
import { useAudition } from '../audio/auditionPlayer';
import { stretchBars } from '../audio/auditionMath';
import { announce, isOpen, measuredWarning, measureEnd, tooLongWhy, updateSuggestion, useSuggestions, withMeasured, withSoundRegions, type NotFoundWhy, type Suggestion } from './suggestionsStore';
import type { BarRange } from './songDiff';

export { MEASURE_MAX_SECONDS, MEASURE_RENDER_MAX_SECONDS, MEASURE_TAIL_SECONDS, MEASURE_UNSURE_TAIL_SECONDS, measureEnd, tooLongWhy } from './suggestionsStore';
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

type Found = { sound: BarRange[]; rise: MeasuredRise | null } | { why: NotFoundWhy } | null;

/** A render's bars measured (loudness and true peak, `spans` where they lie in it), and the whole of it (its integrated loudness, its highest true peak). Rejects with the signal's reason if aborted. */
export async function levelsOf(audio: AudioBuffer, spans: readonly BarSpan[], signal: AbortSignal): Promise<{ bars: BarLevel[]; song: BarLevel }> {
  const channels = channelsOf(audio).slice(0, 2);
  const left = channels[0];
  const right = channels[1] ?? new Float32Array(left.length);
  const rate = audio.sampleRate;
  const breathe = async () => {
    await new Promise((r) => setTimeout(r, 0));
    signal.throwIfAborted();
  };
  // (the true peak bar by bar below, so the analyser leaves it out)
  const analyser = createLoudnessAnalyser(rate, undefined, undefined, false);
  const hop = Math.round(rate / 10);
  for (let i = 0; i < left.length; i += hop) {
    const n = Math.min(hop, left.length - i);
    analyser.feed(left.subarray(i, i + n), right.subarray(i, i + n), n);
    if ((i / hop) % 50 === 49) await breathe();
  }
  const lufs = barLoudness(analyser.blocks(), hop / rate, spans);
  const peaks: number[] = [];
  for (let k = 0; k < spans.length; k++) {
    const [from, to] = [spans[k].start, spans[k].end].map((t) => Math.min(left.length, Math.max(0, Math.round(t * rate))));
    const p = to > from ? truePeakOf([left.subarray(from, to), right.subarray(from, to)]) : 0;
    peaks.push(p > 0 ? 20 * Math.log10(p) : -Infinity);
    if (k % 8 === 7) await breathe();
  }
  return { bars: lufs.map((l, k) => ({ lufs: l, peak: peaks[k] })), song: { lufs: analyser.read().integrated, peak: peaks.length ? maxOf(peaks) : -Infinity } };
}

/**
 * A before-and-after's own renders measured bar by bar, as the sound check measures the whole
 * song: A and B (the song now and as suggested), each of the stretches `plays` one after another,
 * stretch `i` starting `starts[side][i]` seconds into its render, each side's bars where its own
 * tempo puts them. How much louder B comes out (measuredRise, against A's bars and A's whole
 * loudness), its bar the song's; null: nowhere much louder. Rejects with the signal's reason if aborted.
 */
export async function auditionRise(
  a: AudioBuffer,
  b: AudioBuffer,
  plays: ReadonlyArray<{ fromBar: number; toBar: number }>,
  starts: { a: readonly number[]; b: readonly number[] },
  tempo: { a: Tempo; b: Tempo },
  signal: AbortSignal
): Promise<MeasuredRise | null> {
  const [sa, sb] = [stretchBars(plays, starts.a, tempo.a), stretchBars(plays, starts.b, tempo.b)];
  const bars = sa.map((x) => x.bar);
  const spans = { a: sa.map(({ start, end }) => ({ start, end })), b: sb.map(({ start, end }) => ({ start, end })) };
  if (!bars.length) return null;
  const [la, lb] = [await levelsOf(a, spans.a, signal), await levelsOf(b, spans.b, signal)];
  const rise = measuredRise(la.bars, lb.bars, la.song);
  return rise && { ...rise, bar: bars[rise.bar - 1] ?? plays[0].fromBar };
}

/** Render `before` and `s.song` whole and compare them (null: aborted): where they differ, and how much louder Suggested comes out (null: not much, or it couldn't be measured). */
async function measure(before: ProjectSnapshot, s: Suggestion, signal: AbortSignal, progress: (f: number) => void): Promise<Found> {
  const long = tooLongWhy(before, s);
  if (long) return { why: long };
  const end = measureEnd(before, s);
  try {
    const a = await renderRange(listenSnapshot(before), 1, end, { signal, progress: (f) => progress(f * 0.5) });
    if (signal.aborted) return null;
    const b = await renderRange(listenSnapshot(s.song), 1, end, { signal, progress: (f) => progress(0.5 + f * 0.5) });
    if (signal.aborted) return null;
    const diffs = barDifferences(channelsOf(a), channelsOf(b), a.sampleRate, spansOf(before, end), spansOf(s.song, end));
    // How loud each comes out, bar by bar (a measure that fails leaves where it's heard as found)
    let rise: MeasuredRise | null = null;
    try {
      const [la, lb] = [await levelsOf(a, spansOf(before, end), signal), await levelsOf(b, spansOf(s.song, end), signal)];
      rise = measuredRise(la.bars, lb.bars, la.song);
    } catch (err) {
      if (signal.aborted) return null;
      console.warn('Measuring how loud a suggestion comes out failed:', err);
    }
    return { sound: changedRegions(diffs, 1), rise };
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

/**
 * Stop finding (for `id` only, if given). What was found so far is dropped; what's still waiting
 * is found in the background again once it's quiet (queueFinding).
 */
export function stopFinding(id?: string): void {
  if (!job || (id !== undefined && job.id !== id)) return;
  job.controller.abort();
  job = null;
  useFinding.setState({ id: null, version: 0, progress: 0, asked: false });
  queueFinding();
}

/** What the musician hears once when a search they asked for starts (polite: the before-and-after plays meanwhile). */
export const FINDING_WORDS = 'Finding where it changes, by sound. You can listen meanwhile.';

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
  // (one that can't be checked by sound: said at once, never announced as begun)
  const long = tooLongWhy(before, s);
  if (long) {
    updateSuggestion(id, (x) => (x.version === s.version ? { ...x, foundWhy: long } : x));
    return Promise.resolve(true);
  }
  if (job && job.id === id && job.version === s.version) {
    if (asked && !job.asked) {
      job.asked = true;
      useFinding.setState({ asked: true });
      announce(FINDING_WORDS);
    }
    return job.done;
  }
  stopFinding();
  watchFinding();
  const controller = new AbortController();
  const version = s.version;
  useFinding.setState({ id, version, progress: 0, asked });
  if (asked) announce(FINDING_WORDS);
  const done = (async () => {
    const found = await measure(before, s, controller.signal, (f) => {
      if (job?.controller === controller) useFinding.setState({ progress: f });
    });
    if (job?.controller !== controller) return false;
    job = null;
    useFinding.setState({ id: null, version: 0, progress: 0, asked: false });
    // (whatever happened, the rest waiting are found next)
    queueFinding();
    if (!found) return false;
    const now = useSuggestions.getState().suggestions.find((x) => x.id === id);
    if (!now || now.version !== version || now.stale || !isOpen(now)) return false;
    // (what it measured takes the place of what a before-and-after or the last version measured; where it can't be found, that stays)
    updateSuggestion(id, (x) => ('sound' in found ? withMeasured(withSoundRegions(x, found.sound, before), found.rise, before) : { ...x, foundWhy: found.why }));
    // (a caution it found is said, as the card shows it, unless the card says it already)
    const said = useSuggestions.getState().suggestions.find((x) => x.id === id);
    const caution = said && measuredWarning(said);
    if (caution && caution !== measuredWarning(now)) announce(`A caution, found by sound: ${caution}`);
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
    // (the song playing: found again once it stops, see watchFinding; one being found: next after it)
    if (useTimelineStore.getState().isPlaying) return;
    if (job) return queueFinding();
    // (a before-and-after rendering now goes first: try again in a moment)
    if (useAudition.getState().phase === 'rendering') return queueFinding();
    const next = useSuggestions.getState().suggestions.find(needsFinding);
    if (!next) return;
    void findWhere(next.id, currentProject(), false);
  }, MEASURE_IDLE_MS);
}

let watching = false;

/**
 * Stop finding in the background while the song plays, and start again once it stops; stop a
 * search whose result can't be used any more (its suggestion answered, out of date, made for
 * another song, changed under it, or made again: one the musician asked for starts again on the
 * version made), and find a suggestion's new version once it's made. Once.
 */
export function watchFinding(): void {
  if (watching) return;
  watching = true;
  useTimelineStore.subscribe((st, prev) => {
    if (st.isPlaying === prev.isPlaying) return;
    if (st.isPlaying) stopFinding();
    else queueFinding();
  });
  useSuggestions.subscribe((st, prev) => {
    if (st.suggestions === prev.suggestions) return;
    if (job) {
      const { id, version, asked } = job;
      const s = st.suggestions.find((x) => x.id === id);
      if (!s || !isOpen(s) || s.stale || s.version !== version) {
        stopFinding();
        if (asked && s && needsFinding(s)) void findWhere(id, currentProject(), true);
      }
    }
    if (!job && st.suggestions.some(needsFinding)) queueFinding();
  });
}
