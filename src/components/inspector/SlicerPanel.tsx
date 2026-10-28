/**
 * The Slicer's panel: load a sound, see and drag its slices (auto at transients, or equal parts),
 * audition them, Pitch mode, slices played backwards, and a stutter or shuffle pattern written
 * for them.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileAudio, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { SliceCount, SlicerSettings, Track } from '../../store/timelineTypes';
import { SLICE_COUNTS } from '../../store/timelineTypes';
import { importSoundFile, SoundError, useSoundLibrary } from '../../audio/soundLibrary';
import { resliced, slicerFor } from '../../audio/slicerTools';
import { sliceEnd, sliceKey, withoutSlice, withSliceAt } from '../../audio/slicing';
import { previewTrackNotes } from '../../audio/liveTracks';
import { initAudio } from '../../audio/engine';
import { pickAudioFiles } from '../timeline/audioFiles';
import { Waveform } from '../timeline/Waveform';
import { UndoableRange } from '../UndoableRange';
import { SoundLibraryFooter } from './SoundLibraryFooter';
import { BassCutToggle } from '../timeline/SampleInfo';
import { slicePattern } from '../../store/resample';
import { uid } from '../../store/timelineTypes';

const WAVE_H = 72;
/** Closest two slice starts can be dragged, in seconds. */
const MIN_SLICE = 0.02;

/** Follow the pointer until release, showing `cursor` meanwhile. */
function followPointer(cursor: string, onMove: (ev: PointerEvent) => void): void {
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  document.body.style.cursor = cursor;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

const pill = (on: boolean) =>
  `px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition ${
    on ? 'bg-fuchsia-500/25 border-fuchsia-400 text-fuchsia-100' : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
  }`;

/**
 * The Slicer's panel: load a sound, see it cut into slices (Auto at its transients with a
 * Sensitivity, or Equal 4 / 8 / 16 / 32), drag the slice markers, click a slice to hear it
 * (and make it the focused one), and switch Pitch mode on (every key plays the focused slice,
 * transposed from its own key).
 */
export const SlicerPanel: React.FC<{ track: Track }> = ({ track }) => {
  const slicer = track.slicer;
  const status = useSoundLibrary((s) => (slicer ? s.status[slicer.soundId] : undefined));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waveRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(272);
  const hasSound = !!slicer;
  useLayoutEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(1, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(1, el.clientWidth));
    return () => ro.disconnect();
  }, [hasSound]);

  const set = (next: SlicerSettings | undefined, record = true) => useTimelineStore.getState().setTrackSlicer(track.id, next, record);

  const load = async () => {
    const [file] = await pickAudioFiles(false);
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await importSoundFile(file, file.name);
      const fresh = slicerFor(meta);
      // A new sound keeps the modes but is cut afresh
      set(slicer ? resliced({ ...fresh, mode: slicer.mode, count: slicer.count, sensitivity: slicer.sensitivity, pitch: slicer.pitch }) : fresh);
    } catch (err) {
      setError(err instanceof SoundError ? err.message : `Couldn't read "${file.name}" as audio.`);
    } finally {
      setBusy(false);
    }
  };

  const hear = async (index: number) => {
    await initAudio();
    previewTrackNotes(track.id, [{ note: sliceKey(index), duration: '2n', velocity: 0.9 }]);
  };

  // The waveform's time axis: the sliced part of the sound
  const span = slicer ? slicer.end - slicer.start : 1;
  const xOf = (t: number) => ((t - (slicer?.start ?? 0)) / span) * width;
  const tOf = (x: number) => (slicer?.start ?? 0) + (Math.max(0, Math.min(width, x)) / width) * span;

  /** Drag slice `i`'s start between its neighbours (one undo step per drag). */
  const dragMarker = (e: React.PointerEvent, i: number) => {
    if (!slicer || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = waveRef.current!.getBoundingClientRect();
    const lo = slicer.slices[i - 1] + MIN_SLICE;
    const hi = sliceEnd(slicer.slices, i, slicer.end) - MIN_SLICE;
    let recorded = false;
    followPointer('ew-resize', (ev) => {
      const t = Math.max(lo, Math.min(hi, tOf(ev.clientX - rect.left)));
      const current = useTimelineStore.getState().tracks.find((tr) => tr.id === track.id)?.slicer;
      if (!current || current.slices[i] === t) return;
      if (!recorded) {
        recorded = true;
        useTimelineStore.getState().checkpoint();
      }
      set({ ...current, slices: current.slices.map((s, k) => (k === i ? t : s)) }, false);
    });
  };

  const sliceAt = (clientX: number) => {
    if (!slicer) return -1;
    const t = tOf(clientX - waveRef.current!.getBoundingClientRect().left);
    let i = 0;
    while (i + 1 < slicer.slices.length && slicer.slices[i + 1] <= t) i++;
    return i;
  };

  return (
    <div className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-fuchsia-500/40 shadow-md">
      <div className="flex items-center gap-1.5">
        <FileAudio className="w-3.5 h-3.5 text-fuchsia-300" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Slicer</span>
        {slicer && (
          <span className="ml-auto text-[10px] font-mono text-forge-muted">
            {slicer.slices.length} slice{slicer.slices.length === 1 ? '' : 's'} from C3
          </span>
        )}
      </div>

      {slicer ? (
        <span className="truncate text-xs font-semibold text-forge-text" title={slicer.name}>
          {slicer.name}
        </span>
      ) : (
        <p className="text-[11px] text-forge-muted">Load a sound (a vocal, a drum loop) and it is cut into slices, one per key from C3 up, to play in the piano roll.</p>
      )}

      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-100 text-xs font-mono hover:bg-fuchsia-500/20 disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {busy ? 'Loading…' : slicer ? 'Replace sound…' : 'Load a sound…'}
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {slicer && (
        <>
          {/* The waveform with the slice markers: click a slice to hear it, drag a marker to move it, double-click to add one, right-click a marker to remove it */}
          <div
            ref={waveRef}
            className="relative rounded border border-forge-border bg-black/40 overflow-hidden cursor-pointer"
            style={{ height: WAVE_H }}
            title="Click a slice to hear it (and focus it) • drag a marker • double-click to add a slice • right-click a marker to remove it"
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('[data-slice-marker]')) return;
              const i = sliceAt(e.clientX);
              if (i < 0) return;
              if (i !== slicer.focus) set({ ...slicer, focus: i });
              void hear(i);
            }}
            onDoubleClick={(e) => {
              const t = tOf(e.clientX - waveRef.current!.getBoundingClientRect().left);
              if (slicer.slices.some((s) => Math.abs(s - t) < MIN_SLICE) || t <= slicer.start + MIN_SLICE || t >= slicer.end - MIN_SLICE) return;
              set(withSliceAt(slicer, t));
            }}
          >
            <Waveform soundId={slicer.soundId} from={slicer.start} to={slicer.end} width={width} height={WAVE_H} color={track.color} className="block" />
            {status === 'ready' &&
              (slicer.reversed ?? []).filter((i) => i < slicer.slices.length).map((i) => (
                <div
                  key={`r${i}`}
                  className="absolute top-0 bottom-0 bg-amber-400/15 border-y-2 border-amber-400/50 pointer-events-none"
                  style={{ left: xOf(slicer.slices[i]), width: Math.max(1, xOf(sliceEnd(slicer.slices, i, slicer.end)) - xOf(slicer.slices[i])) }}
                />
              ))}
            {status === 'ready' && (
              <div
                className="absolute top-0 bottom-0 bg-fuchsia-400/15 pointer-events-none"
                style={{ left: xOf(slicer.slices[slicer.focus] ?? slicer.start), width: Math.max(1, xOf(sliceEnd(slicer.slices, slicer.focus, slicer.end)) - xOf(slicer.slices[slicer.focus] ?? slicer.start)) }}
              />
            )}
            {slicer.slices.map((t, i) =>
              i === 0 ? null : (
                <div
                  key={i}
                  data-slice-marker=""
                  className="absolute top-0 bottom-0 -ml-[3px] w-[7px] cursor-ew-resize group"
                  style={{ left: xOf(t) }}
                  onPointerDown={(e) => dragMarker(e, i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    set(withoutSlice(slicer, i));
                  }}
                  title={`Slice ${i + 1} (${sliceKey(i)}): drag to move, right-click to remove`}
                >
                  <div className="absolute left-[3px] top-0 bottom-0 w-px bg-fuchsia-300 group-hover:bg-white shadow-[0_0_4px_rgba(240,171,252,0.9)]" />
                </div>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-forge-muted">
            <span className="w-8">CUT</span>
            <button type="button" className={pill(slicer.mode === 'auto')} onClick={() => set(resliced({ ...slicer, mode: 'auto' }))} title="Cut at the transients the Slicer finds">
              Auto
            </button>
            <button type="button" className={pill(slicer.mode === 'equal')} onClick={() => set(resliced({ ...slicer, mode: 'equal' }))} title="Cut into equal parts">
              Equal
            </button>
            {slicer.mode === 'equal' && (
              <select
                value={slicer.count}
                onChange={(e) => set(resliced({ ...slicer, count: Number(e.target.value) as SliceCount }))}
                className="h-5 bg-forge-panel border border-forge-border rounded px-1 text-forge-text"
                aria-label="Number of slices"
              >
                {SLICE_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={pill(slicer.pitch)} onClick={() => set({ ...slicer, pitch: !slicer.pitch })} title="Pitch mode: every key plays the focused slice, transposed from that slice's own key" aria-pressed={slicer.pitch}>
              Pitch
            </button>
            <button
              type="button"
              className={pill(!!slicer.reversed?.includes(slicer.focus))}
              aria-pressed={!!slicer.reversed?.includes(slicer.focus)}
              onClick={() => {
                const now = slicer.reversed ?? [];
                const next = now.includes(slicer.focus) ? now.filter((i) => i !== slicer.focus) : [...now, slicer.focus].sort((a, b) => a - b);
                const { reversed: _old, ...rest } = slicer;
                set(next.length ? { ...rest, reversed: next } : rest);
              }}
              title={`Play Slice ${slicer.focus + 1} backwards (click a slice to choose it)`}
            >
              Backwards
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-forge-muted">
            <span className="w-8">WRITE</span>
            {(['stutter', 'shuffle'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={pill(false)}
                title={kind === 'stutter' ? 'A new 2-bar clip at the playhead that plays the slices with repeats and 1/32 rolls' : 'A new 2-bar clip at the playhead that plays a random slice on each 16th'}
                onClick={() => {
                  const st = useTimelineStore.getState();
                  const bar = Math.max(1, Math.floor(st.playheadPosition));
                  const clipId = st.createEmptyClip(track.id, bar, 2);
                  if (!clipId) return;
                  const seed = Math.floor(Math.random() * 1e9);
                  const notes = slicePattern(kind, slicer.slices.length, 1, 2, seed).map((n) => ({ ...n, id: uid('note') }));
                  // (One undo step with the new clip)
                  useTimelineStore.setState((x) => ({ clips: x.clips.map((c) => (c.id === clipId ? { ...c, name: `${slicer.name} ${kind}`, notes } : c)) }));
                }}
              >
                {kind === 'stutter' ? 'Stutter' : 'Shuffle'}
              </button>
            ))}
          </div>
          {slicer.mode === 'auto' && (
            <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" title="How faint a transient still starts a slice">
              <span className="w-8">SENS</span>
              <UndoableRange
                min={0}
                max={1}
                step={0.01}
                value={slicer.sensitivity}
                onValue={(v) => set(resliced({ ...slicer, sensitivity: v }), false)}
                className="flex-1 min-w-0 cursor-pointer"
                style={{ accentColor: track.color }}
                aria-label="Slice sensitivity"
              />
              <span className="w-8 text-right tabular-nums text-forge-text">{Math.round(slicer.sensitivity * 100)}</span>
            </label>
          )}
          <p className="text-[10px] text-forge-muted/80">
            {slicer.pitch
              ? `Pitch mode: every key plays Slice ${slicer.focus + 1}, at its own pitch on ${sliceKey(slicer.focus)}. Click another slice to focus it.`
              : `Slice 1 plays on C3, Slice 2 on C#3, and so on. A note plays its slice for the note's length, or the slice's if shorter.`}
          </p>
        </>
      )}
      {slicer && <BassCutToggle trackId={track.id} />}
      <SoundLibraryFooter />
    </div>
  );
};
