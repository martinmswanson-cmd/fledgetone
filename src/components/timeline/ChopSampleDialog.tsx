/**
 * Chop sample: cut a sample (an audio clip's part of its sound) into up to 16 chops, at its hits,
 * into equal parts or by hand (drag, add and remove the markers on its waveform), hear each, and
 * put them on a new Drum Rack track's pads with a clip that plays them: in a new order ("Chop and
 * play", a seeded starting pattern) or as they were. Or onto a Slicer, as before.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Scissors } from 'lucide-react';
import { songTempo, useTimelineStore } from '../../store/timelineStore';
import { tempoAt } from '../../audio/tempoMap';
import { audioSourceSeconds } from '../../store/audioClips';
import { soundStatusText, useSoundLibrary, decodeSound } from '../../audio/soundLibrary';
import { liveMix } from '../../audio/engine';
import { ENVELOPE_HOP } from '../../audio/slicing';
import { soundEnvelope } from '../../audio/slicerTools';
import { auditionPart, stopAudition } from '../../audio/auditionPart';
import { addChop, chopEnd, chopStarts, DEFAULT_CHOP_FADE, MAX_CHOPS, moveChop, removeChop, type ChopMode } from '../../store/sampleFlip';
import { chopToRack } from '../../store/flipActions';
import { padNote } from '../../store/sampleKits';
import { Modal } from './Modal';
import { Waveform } from './Waveform';
import { SampleInfo } from './SampleInfo';
import { showToast } from './toastStore';

const WAVE_H = 96;
const COLUMNS = 720;
const EQUAL_COUNTS = [4, 8, 12, 16] as const;
const pill = (on: boolean) =>
  `h-7 px-2.5 rounded-md border text-[11px] font-mono ${on ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100' : 'border-forge-border text-forge-muted hover:text-forge-text hover:border-cyan-500/70'}`;

/** Follow the pointer until release. */
function followPointer(onMove: (ev: PointerEvent) => void): void {
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  document.body.style.cursor = 'ew-resize';
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export const ChopSampleDialog: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const audio = clip?.audio;
  const soundId = audio?.soundId ?? '';
  const meta = useSoundLibrary((s) => s.metas[soundId]);
  const status = useSoundLibrary((s) => s.status[soundId]);
  const bpmAtClip = useTimelineStore((s) => (clip ? tempoAt(clip.startBar, songTempo(s)) : s.bpm));
  const part = useMemo(() => {
    if (!clip?.audio || !meta) return null;
    // The stretch of the sound the clip plays (as recorded: a stretched clip still chops its own sound)
    const start = clip.audio.offset;
    const end = Math.min(meta.seconds, start + audioSourceSeconds(clip, bpmAtClip));
    return end > start ? { start, end } : null;
  }, [clip, meta, bpmAtClip]);

  const [decoded, setDecoded] = useState(false);
  const [mode, setMode] = useState<ChopMode>('transients');
  const [count, setCount] = useState(8);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [handCuts, setHandCuts] = useState<number[]>([]);
  const [fadeMs, setFadeMs] = useState(DEFAULT_CHOP_FADE * 1000);
  const [choke, setChoke] = useState(true);
  const [flip, setFlip] = useState(true);
  const [bassCut, setBassCut] = useState(false);
  const [width, setWidth] = useState(COLUMNS);
  const waveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    if (soundId) decodeSound(soundId, liveMix.bus.context.sampleRate).then(() => live && setDecoded(true), () => {});
    return () => {
      live = false;
      stopAudition();
    };
  }, [soundId]);
  useLayoutEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(1, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(1, el.clientWidth));
    return () => ro.disconnect();
  }, [part]);

  // At the hits or in equal parts: cut afresh whenever those settings change (by hand keeps its own markers)
  const autoCuts = useMemo(() => {
    if (!part || mode === 'hand') return [];
    const env = decoded ? soundEnvelope(soundId) : undefined;
    if (mode === 'transients' && !env) return [];
    return chopStarts(env ?? new Float32Array(0), ENVELOPE_HOP, part.start, part.end, mode, count, sensitivity);
  }, [part, mode, count, sensitivity, decoded, soundId]);
  const cuts = mode === 'hand' ? handCuts : autoCuts;

  if (!clip || !audio) return null;
  const ready = !!part && decoded && cuts.length > 0;
  const span = part ? part.end - part.start : 1;
  const xOf = (t: number) => ((t - (part?.start ?? 0)) / span) * width;
  const tOf = (clientX: number) => {
    const rect = waveRef.current!.getBoundingClientRect();
    return (part?.start ?? 0) + (Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width) * span;
  };
  const chopAt = (t: number) => {
    let i = 0;
    while (i + 1 < cuts.length && cuts[i + 1] <= t) i++;
    return i;
  };
  const hear = (i: number) => part && void auditionPart(soundId, cuts[i], chopEnd(cuts, i, part.end));
  const byHand = (next: number[]) => {
    setMode('hand');
    setHandCuts(next);
  };
  const name = (clip.name || meta?.name || 'Sample').replace(/\.[a-z0-9]+$/i, '').slice(0, 30);

  const chop = () => {
    if (!part || !cuts.length) return;
    const trackId = chopToRack({ soundId, name, cuts, end: part.end, fade: fadeMs / 1000, choke, flip, bassCut, clipId });
    if (trackId) {
      showToast(`${cuts.length} chops on the pads of a new Drum Rack (C2 up)${flip ? ', with a pattern that flips them: New idea (in its panel) writes another' : ''}.`);
      onClose();
    }
  };
  const toSlicer = () => {
    if (!part || !cuts.length) return;
    const trackId = useTimelineStore.getState().chopClipToSlicer(clipId, { soundId, name, start: part.start, end: part.end, slices: cuts, mode: 'auto', count: 8, sensitivity, pitch: false, focus: 0 });
    if (trackId) {
      showToast(`${cuts.length} slices on a new Slicer track (C3 up).`);
      onClose();
    }
  };

  return (
    <Modal title={`Chop "${clip.name}"`} onClose={onClose} wide>
      <SampleInfo soundId={audio.shiftedFrom ?? soundId} clipId={clipId} />
      {(!part || !decoded) && <p className="text-amber-300 text-xs">{status === 'ready' ? 'Reading the sound…' : soundStatusText(status)}</p>}

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-forge-muted" role="group" aria-label="How to chop">
        <button type="button" className={pill(mode === 'transients')} onClick={() => setMode('transients')} title="A chop starts at each hit: a drum, a chord stab, a word (the strongest 16)">
          At the hits
        </button>
        <button type="button" className={pill(mode === 'equal')} onClick={() => setMode('equal')} title="Equal parts: beats or bars of a loop">
          Equal
        </button>
        <button type="button" className={pill(mode === 'hand')} onClick={() => byHand(cuts.length ? cuts : part ? [part.start] : [])} title="Place the markers yourself: double-click the waveform to add one, drag to move, right-click to remove">
          By hand
        </button>
        {mode === 'transients' && (
          <label className="flex items-center gap-1.5" title="How faint a hit still starts a chop">
            SENS
            <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} className="w-24 accent-cyan-400" aria-label="Sensitivity" />
          </label>
        )}
        {mode === 'equal' &&
          EQUAL_COUNTS.map((n) => (
            <button key={n} type="button" className={pill(count === n)} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        <span className="ml-auto">
          {cuts.length} / {MAX_CHOPS} chops
        </span>
      </div>

      <div
        ref={waveRef}
        className="relative rounded border border-forge-border bg-black/40 overflow-hidden cursor-pointer select-none"
        style={{ height: WAVE_H }}
        title="Click a chop to hear it • drag a marker to move it • double-click to add one • right-click a marker to remove it"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('[data-chop-marker]') || !ready) return;
          hear(chopAt(tOf(e.clientX)));
        }}
        onDoubleClick={(e) => part && byHand(addChop(cuts, tOf(e.clientX), part.end))}
      >
        {part && <Waveform soundId={soundId} from={part.start} to={part.end} width={width} height={WAVE_H} color="#22d3ee" className="block" />}
        {part &&
          cuts.map((t, i) => (
            <React.Fragment key={i}>
              <span className="absolute top-0.5 text-[9px] font-mono text-white/80 pointer-events-none" style={{ left: xOf(t) + 3 }}>
                {i + 1}
              </span>
              {i > 0 && (
                <div
                  data-chop-marker=""
                  className="absolute top-0 bottom-0 -ml-[4px] w-[9px] cursor-ew-resize group"
                  style={{ left: xOf(t) }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    // Dragging takes the markers over by hand, from where they are now
                    byHand(cuts);
                    followPointer((ev) => setHandCuts((now) => moveChop(now, i, tOf(ev.clientX), part.end)));
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    byHand(removeChop(cuts, i));
                  }}
                  title={`Chop ${i + 1} (pad ${i + 1}, ${padNote(i)}): drag to move, right-click to remove`}
                >
                  <div className="absolute left-[4px] top-0 bottom-0 w-px bg-cyan-200 group-hover:bg-white shadow-[0_0_4px_rgba(103,232,249,0.9)]" />
                </div>
              )}
            </React.Fragment>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-mono text-forge-muted">
        <label className="flex items-center gap-1.5" title="A short fade at each chop's start and end, so a cut mid-note doesn't click">
          FADE
          <input type="range" min={0} max={50} step={1} value={fadeMs} onChange={(e) => setFadeMs(Number(e.target.value))} className="w-20 accent-cyan-400" aria-label="Fade" />
          <span className="w-10 text-forge-text tabular-nums">{fadeMs} ms</span>
        </label>
        <label className="flex items-center gap-1.5" title="One chop cuts off the one before, as on a classic sampler (choke group 1). Off: chops ring over each other">
          <input type="checkbox" checked={choke} onChange={(e) => setChoke(e.target.checked)} />
          one at a time
        </label>
        <label className="flex items-center gap-1.5" title="Write a starting pattern that plays the chops in a new order on the beat grid (else they play in order, as the sample did)">
          <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
          chop and play
        </label>
        <label className="flex items-center gap-1.5" title="Filter out the sample's bass and kick (a steep low cut), to lay your own 808 under it">
          <input type="checkbox" checked={bassCut} onChange={(e) => setBassCut(e.target.checked)} />
          filter out the bass
        </label>
      </div>
      <p className="text-[11px] text-forge-muted">
        The chops go on a new Drum Rack's pads, chop 1 on pad 1 (C2): play them from the pads, the computer keyboard or a MIDI pad controller, with note repeat, or in the piano roll. Each pad has its own start, end, fade, reverse, pitch, level and choke.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={chop} disabled={!ready} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-500/70 bg-cyan-500/15 text-cyan-100 text-xs font-semibold hover:bg-cyan-500/25 disabled:opacity-40" autoFocus>
          <Scissors className="w-3.5 h-3.5" /> Chop to 16 pads
        </button>
        <button type="button" onClick={toSlicer} disabled={!ready} className="h-8 px-3 rounded-md border border-forge-border text-forge-muted text-xs hover:text-forge-text hover:border-forge-borderLight disabled:opacity-40" title="Put the same chops on a Slicer track instead (one per key from C3 up), with a clip that plays them in order">
          To a Slicer instead
        </button>
      </div>
    </Modal>
  );
};
