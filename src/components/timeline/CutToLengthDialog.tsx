/**
 * The Cut to length dialog: pick a length and the song is rebuilt from its sections to last that
 * long (see cutToLength.ts).
 */
import React, { useMemo, useState } from 'react';
import { Scissors } from 'lucide-react';
import { Modal } from './Modal';
import { useSongMeter, useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { secondsBetween } from '../../audio/tempoMap';
import { exactTempo, MAX_TEMPO_NUDGE, planCut, songSections } from '../../store/cutToLength';
import { formatBpm } from '../../store/timelineTypes';
import { parseTimecode } from '../../audio/transport';

/** The lengths ads, trailers and social clips come in. */
const LENGTHS = [6, 15, 30, 60, 90];

const clock = (seconds: number) => {
  const c = Math.round(seconds * 100);
  const m = Math.floor(c / 6000);
  return `${m}:${((c - m * 6000) / 100).toFixed(2).padStart(5, '0')}`;
};

/**
 * Cut to length: pick 6, 15, 30, 60 or 90 seconds (or type one) and the song is rebuilt from its
 * sections to last that long, ending on its own ending, as one undo step. See cutToLength.ts.
 */
export const CutToLengthDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const clips = useTimelineStore((s) => s.clips);
  const markers = useTimelineStore((s) => s.markers);
  const bpm = useTimelineStore((s) => s.bpm);
  const tempo = useSongTempo();
  const meter = useSongMeter();
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const [seconds, setSeconds] = useState(30);
  const [typed, setTyped] = useState('');
  const [nudge, setNudge] = useState(true);
  const [error, setError] = useState('');

  const sections = useMemo(() => songSections(clips, markers, meter), [clips, markers, meter]);
  const songBars = sections.length ? sections[sections.length - 1].to - 1 : 0;
  // Planned in seconds through the tempo changes: each section as long as it lasts, in bars of the
  // starting tempo (every tempo scales together when the length is fitted, so this stays exact)
  const timed = useMemo(() => {
    const lengths = sections.map((sec) => (secondsBetween(sec.from, sec.to, tempo) * bpm) / 240);
    const starts = lengths.map((_, i) => 1 + lengths.slice(0, i).reduce((a, b) => a + b, 0));
    return sections.map((sec, i) => ({ ...sec, from: starts[i], to: starts[i] + lengths[i] }));
  }, [sections, tempo, bpm]);
  const typedSeconds = typed.trim() ? (/^\d+(\.\d+)?$/.test(typed.trim()) ? Number(typed.trim()) : parseTimecode(typed, fps, dropFrame)) : null;
  const target = typedSeconds && typedSeconds > 0 ? typedSeconds : seconds;
  const targetBars = (target * bpm) / 240;
  const plan = useMemo(() => planCut(timed, targetBars), [timed, targetBars]);
  const fitted = plan ? exactTempo(plan.bars, target, bpm) : null;
  const useBpm = nudge && fitted !== null ? fitted : bpm;
  const length = plan ? (plan.bars * 240) / useBpm : 0;

  const apply = () => {
    if (!plan) return setError('Nothing to cut: the timeline is empty.');
    const message = useTimelineStore.getState().cutToLength(plan.order, nudge && fitted !== null ? fitted : null);
    if (message) setError(message);
    else onClose();
  };

  return (
    <Modal title="Cut to length" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 text-xs text-forge-muted">
        {!sections.length ? (
          <p>The timeline is empty: write or open a song first.</p>
        ) : (
          <>
            <p>
              Make a shorter or longer version of the song, for an ad, a trailer or a social clip. Whole sections (between your markers
              {markers.some((m) => m.anchor === 'bar') ? '' : ', or 8-bar phrases without any'}) are dropped or repeated, and it ends on the song's
              own ending. The song is now {clock(secondsBetween(1, 1 + songBars, tempo))} ({songBars} bars).
            </p>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Length">
              {LENGTHS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={!typedSeconds && seconds === n}
                  onClick={() => {
                    setSeconds(n);
                    setTyped('');
                    setError('');
                  }}
                  className={`h-7 px-2.5 rounded-md border font-mono text-[11px] ${
                    !typedSeconds && seconds === n ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border hover:text-forge-text'
                  }`}
                >
                  {n} s
                </button>
              ))}
              <input
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="0:45:00 or 45"
                aria-label="Length: a timecode or seconds"
                className={`h-7 w-32 bg-forge-bg border rounded-md px-2 font-mono text-[11px] text-forge-text focus:outline-none ${
                  typed.trim() && !typedSeconds ? 'border-red-500' : 'border-forge-border focus:border-cyan-500'
                }`}
              />
            </div>
            {plan && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1" aria-label="The cut, in order">
                  {plan.order.map((i, k) => (
                    <span key={k} className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-400/40 text-violet-100 font-mono text-[10px]">
                      {sections[i].name} · {sections[i].to - sections[i].from}
                    </span>
                  ))}
                </div>
                <p>
                  {plan.bars} bars: <span className="font-mono text-forge-text">{clock(length)}</span> at {formatBpm(useBpm)} BPM
                  {Math.abs(length - target) > 0.01 && ` (${length > target ? '+' : '-'}${Math.abs(length - target).toFixed(2)} s from ${clock(target)})`}.
                  {sections.length - new Set(plan.order).size > 0 && ` Leaves out ${sections.length - new Set(plan.order).size} section${sections.length - new Set(plan.order).size === 1 ? '' : 's'}.`}
                </p>
                <label className={`flex items-center gap-2 ${fitted === null ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={nudge && fitted !== null} disabled={fitted === null} onChange={(e) => setNudge(e.target.checked)} />
                  {fitted === null
                    ? `Can't hit ${clock(target)} exactly without changing the tempo by more than ${Math.round(MAX_TEMPO_NUDGE * 100)}%.`
                    : `Nudge the tempo to ${formatBpm(fitted)} BPM so it lasts exactly ${clock(target)}`}
                </label>
              </div>
            )}
            <p className="text-[11px]">It replaces the song on the timeline. Ctrl+Z brings the whole song back (a nudged tempo stays: set it back by hand). Save a copy first if you want both.</p>
            {error && <p className="text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-8 px-3 rounded-md border border-forge-border hover:text-forge-text">
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!plan}
                className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25 disabled:opacity-40"
              >
                <Scissors className="w-3.5 h-3.5" /> Cut to {clock(target)}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
