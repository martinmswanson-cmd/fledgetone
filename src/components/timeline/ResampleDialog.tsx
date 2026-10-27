/**
 * The Resample dialog: print the chosen clips, the loop range (every track, or the selected one)
 * to a new sound, with its effects (before the master section, or through it), and put it on a new
 * Audio track, a new Slicer track already chopped (at its hits or into 8 or 16 slices, played in
 * order, as a stutter or shuffled, the last slice backwards if asked) or a new Fledge Synth track
 * as its user table (a bass, lead or pad). Opened from a clip's right-click menu and Tools ›
 * Resample. The work is in resampleActions.ts.
 */
import React, { useMemo, useState } from 'react';
import { AudioWaveform } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { formatBarCount } from '../../store/timelineTypes';
import { resample, useResampling } from '../../store/resampleActions';
import type { ResampleSource, ResampleTarget, SliceChoice, SlicePattern, WavetableRole } from '../../store/resample';
import { FIXED_CYCLES, TABLE_FRAME_COUNTS, type CycleChoice } from '../../audio/plugins/userTable';
import { showToast } from './toastStore';
import { useResampleDialog, type ResampleFrom } from './resampleDialogStore';

type From = ResampleFrom;

const pill = (on: boolean) => `h-7 px-2.5 rounded-md border font-mono text-[11px] ${on ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border hover:text-forge-text'}`;

function Choices<T extends string | number>({ label, value, options, set }: { label: string; value: T; options: Array<[T, string]>; set: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="w-20 shrink-0">{label}</span>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} className={pill(value === v)} onClick={() => set(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export const ResampleDialog: React.FC = () => {
  const { open, from: startFrom, target: startTarget } = useResampleDialog();
  return open ? <ResampleForm key={`${startFrom}-${startTarget}`} startFrom={startFrom} startTarget={startTarget} /> : null;
};

const ResampleForm: React.FC<{ startFrom: From; startTarget: ResampleTarget }> = ({ startFrom, startTarget }) => {
  const clips = useTimelineStore((s) => s.clips);
  const selected = useMemo(() => clips.filter((c) => c.isSelected), [clips]);
  const loop = useTimelineStore((s) => s.loopRegion);
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === s.selectedTrackId));
  const busy = useResampling((r) => r.fraction);
  const [from, setFrom] = useState<From>(startFrom === 'clips' && !selected.length ? 'mix' : startFrom);
  const [target, setTarget] = useState<ResampleTarget>(startTarget);
  const [withMaster, setWithMaster] = useState(false);
  const [tail, setTail] = useState(false);
  const [muteSource, setMuteSource] = useState(false);
  const [slices, setSlices] = useState<SliceChoice>(16);
  const [pattern, setPattern] = useState<SlicePattern>('stutter');
  const [reverseLast, setReverseLast] = useState(true);
  const [frames, setFrames] = useState(16);
  const [cycle, setCycle] = useState<CycleChoice>('pitch');
  const [role, setRole] = useState<WavetableRole>('lead');
  const close = () => useResampleDialog.setState({ open: false });

  const source: ResampleSource | null =
    from === 'clips'
      ? selected.length
        ? { kind: 'clips', clipIds: selected.map((c) => c.id) }
        : null
      : from === 'track'
        ? track
          ? { kind: 'range', from: loop.inBar, to: loop.outBar, trackIds: [track.id] }
          : null
        : { kind: 'range', from: loop.inBar, to: loop.outBar };
  const range = `bars ${formatBarCount(loop.inBar)}–${formatBarCount(loop.outBar)}`;

  const go = async () => {
    if (!source) return;
    try {
      const r = await resample({ source, target, withMaster, tail, muteSource, slices, pattern, reverseLast, frames, cycle, role });
      showToast(r.message);
      if (r.trackId) close();
    } catch (err) {
      showToast(`Couldn't resample it: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Modal title="Resample" onClose={close}>
      <div className="flex flex-col gap-3 p-4 text-xs text-forge-muted" aria-label="Resample">
        <p>Print it to a new sound, with its effects, then chop it, play it backwards, mangle it or play it as a wavetable. What it came from stays as it is.</p>
        <Choices<From>
          label="What"
          value={from}
          set={setFrom}
          options={[
            ...(selected.length ? [['clips', selected.length === 1 ? `"${selected[0].name}"` : `${selected.length} clips`] as [From, string]] : []),
            ['mix', `The mix, ${range}`],
            ...(track ? [['track', `${track.name}, ${range}`] as [From, string]] : []),
          ]}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={withMaster} onChange={(e) => setWithMaster(e.target.checked)} />
          Through the master section too (its glue, OTT, width and limiter; else before it)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={tail} onChange={(e) => setTail(e.target.checked)} />
          Let reverb and echo ring out past the end (else exactly the bars, so it loops in time)
        </label>
        {from !== 'mix' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={muteSource} onChange={(e) => setMuteSource(e.target.checked)} />
            Mute the track{from === 'clips' && new Set(selected.map((c) => c.trackId)).size > 1 ? 's' : ''} it came from
          </label>
        )}
        <Choices<ResampleTarget>
          label="Onto"
          value={target}
          set={setTarget}
          options={[
            ['audio', 'A new audio track'],
            ['slicer', 'A new Slicer, chopped'],
            ['wavetable', 'A Fledge Synth wavetable'],
          ]}
        />
        {target === 'slicer' && (
          <div className="flex flex-col gap-2 pl-2 border-l border-forge-border">
            <Choices<SliceChoice> label="Cut" value={slices} set={setSlices} options={[['transients', 'At its hits'], [8, '8 equal'], [16, '16 equal']]} />
            <Choices<SlicePattern> label="Pattern" value={pattern} set={setPattern} options={[['order', 'In order'], ['stutter', 'Stutter'], ['shuffle', 'Shuffle']]} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reverseLast} onChange={(e) => setReverseLast(e.target.checked)} />
              The last slice backwards (a reversed tail)
            </label>
            <p>Each slice plays on its own key from C3 up: draw notes on the Slicer's rows to rearrange them.</p>
          </div>
        )}
        {target === 'wavetable' && (
          <div className="flex flex-col gap-2 pl-2 border-l border-forge-border">
            <Choices<number> label="Cycles" value={frames} set={setFrames} options={TABLE_FRAME_COUNTS.map((n) => [n, String(n)])} />
            <Choices<CycleChoice> label="Cut at" value={cycle} set={setCycle} options={[['pitch', 'Its pitch'], ...FIXED_CYCLES.map((n) => [n, `${n} samples`] as [CycleChoice, string])]} />
            <Choices<WavetableRole> label="Plays as" value={role} set={setRole} options={[['bass', 'Bass'], ['lead', 'Lead'], ['pad', 'Pad']]} />
            <p>A held, steady sound works best (a pad, a vowel, a chord). Its cycles are spread from start to end: the table's Position moves through the sound.</p>
          </div>
        )}
        {!source && <p className="text-amber-300">{from === 'clips' ? 'Select a clip first.' : 'Select a track first.'}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="h-8 px-3 rounded-md border border-forge-border hover:text-forge-text">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void go()}
            disabled={!source || busy !== null}
            className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25 disabled:opacity-40"
          >
            <AudioWaveform className="w-3.5 h-3.5" />
            {busy !== null ? `Rendering ${Math.round(busy * 100)}%` : 'Resample'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
