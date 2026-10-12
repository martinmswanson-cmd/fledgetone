import React, { useMemo, useState } from 'react';
import { TOTAL_BARS, useTimelineStore } from '../store/timelineStore';
import { formatBarCount, formatBpm, frameRateLabel } from '../store/timelineTypes';
import { barToSeconds, formatBarsBeats, formatSmpte, parseTimecode, secondsToBar } from '../audio/transport';
import { findTempos, HIT_GRIDS, scoreTempo, type HitGrid, type TempoSuggestion } from '../store/tempoFinder';
import { formatFrameTimecode, secondsToFrames } from '../audio/timecode';
import { Popover } from './Popover';

/** Read a typed tempo: up to 3 digits and 2 decimals (a comma works as the point), 40 to 240. */
function parseBpm(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return null;
  const bpm = Number(t);
  return bpm >= 40 && bpm <= 240 ? bpm : null;
}

/** The header's tempo readout: click it, type a tempo, Enter sets it (Esc cancels). */
export const TempoField: React.FC = () => {
  const bpm = useTimelineStore((s) => s.bpm);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const close = () => {
    setDraft(null);
    setInvalid(false);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        className="text-lg leading-7 font-bold font-mono text-white tracking-wider tabular-nums text-left rounded-sm hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        onClick={() => setDraft(formatBpm(bpm))}
        title="Click to type a tempo (40 to 240 BPM, up to 2 decimals)"
        aria-label={`Tempo ${formatBpm(bpm)} BPM, click to type a tempo`}
      >
        {formatBpm(bpm)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      inputMode="decimal"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        if (e.key !== 'Enter') return;
        const typed = parseBpm(draft);
        if (typed === null) {
          setInvalid(true);
          return;
        }
        useTimelineStore.getState().setBpm(typed);
        close();
      }}
      onBlur={close}
      className={`w-[4.75rem] h-7 text-lg font-bold font-mono leading-none tabular-nums bg-black/60 rounded-sm px-0.5 border focus:outline-none ${
        invalid ? 'border-red-500 text-red-300' : 'border-cyan-500 text-white'
      }`}
      aria-label="Tempo in BPM (40 to 240, up to 2 decimals)"
      aria-invalid={invalid}
      title={invalid ? 'Not a tempo: type 40 to 240, with up to 2 decimals (e.g. 115.25)' : 'Enter sets the tempo, Esc cancels'}
    />
  );
};

type FitRange = 'loop' | 'song' | 'bars' | 'hits';

/** A typed positive number ("8", "7.5", "7,5"), or null. */
function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

/**
 * The tempo, to 0.01 BPM, at which `bars` last `seconds`. Rounding to the nearest hundredth ends
 * the bars a hair early about half the time, and timecode then reads one frame short of what was
 * typed. So of the two hundredths either side, prefer one that ends in the same frame as the
 * target; otherwise (a long stretch, where 0.01 BPM moves the end by more than a frame) the closer.
 */
function fitBpm(bars: number, seconds: number, fps: number): number {
  const exact = (bars * 240) / seconds;
  const lengthAt = (bpm: number) => barToSeconds(1 + bars, bpm);
  const targetFrame = secondsToFrames(seconds, fps);
  const either = [Math.floor(exact * 100) / 100, Math.ceil(exact * 100) / 100];
  const inFrame = either.filter((bpm) => secondsToFrames(lengthAt(bpm), fps) === targetFrame);
  return (inFrame.length ? inFrame : either).reduce((best, bpm) =>
    Math.abs(lengthAt(bpm) - seconds) < Math.abs(lengthAt(best) - seconds) ? bpm : best
  );
}

const fieldClass = (invalid: boolean) =>
  `h-8 bg-forge-bg border rounded-md px-2 font-mono text-sm text-forge-text tabular-nums focus:outline-none ${
    invalid ? 'border-red-500 text-red-300' : 'border-forge-border focus:border-cyan-500'
  }`;

/**
 * Fit to time: pick a stretch of the song (the loop, the whole song or a number of bars), type how
 * long it should last, and set the tempo that makes it so.
 */
export const FitTempoPopover: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void }> = ({
  anchorRef,
  onClose,
}) => {
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const loopBars = useTimelineStore((s) => s.loopRegion.outBar - s.loopRegion.inBar);
  const loopIn = useTimelineStore((s) => s.loopRegion.inBar);
  const tempoPoints = useTimelineStore((s) => s.tempoPoints);
  const songBars = useTimelineStore((s) => s.clips.reduce((end, c) => Math.max(end, c.startBar + c.lengthBars), 1) - 1);
  const [range, setRange] = useState<FitRange>('loop');
  const [barsText, setBarsText] = useState('8');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');

  const typedBars = parseDecimal(barsText);
  const bars = range === 'loop' ? loopBars : range === 'song' ? songBars : typedBars !== null && typedBars <= TOTAL_BARS ? typedBars : null;
  // Plain numbers are seconds ("25.5"); anything else is a timecode at the project's rate
  const seconds = parseDecimal(target) ?? parseTimecode(target, fps, dropFrame);
  // With tempo changes, every tempo is scaled together (the changes keep their shape): the length
  // is measured through them, from where the stretch starts
  const mapped = tempoPoints.length > 0;
  const from = range === 'loop' ? loopIn : 1;
  const scaledMap = (to: number) => ({ bpm: to, points: tempoPoints.map((p) => ({ ...p, bpm: (p.bpm * to) / bpm })) });
  const secondsAt = (b: number, to: number) => (mapped ? barToSeconds(from + b, scaledMap(to)) - barToSeconds(from, scaledMap(to)) : barToSeconds(1 + b, to));
  const newBpm = bars && seconds ? (mapped ? Math.round(((bpm * secondsAt(bars, bpm)) / seconds) * 100) / 100 : fitBpm(bars, seconds, fps)) : null;
  const lengthOf = (b: number, to: number) => {
    const sec = secondsAt(b, to);
    return `${formatFrameTimecode(secondsToFrames(sec, fps), fps, dropFrame)} (${sec.toFixed(3)} s)`;
  };

  const apply = () => {
    if (!bars) return setError(range === 'song' ? 'The timeline is empty.' : `Type a number of bars, up to ${TOTAL_BARS}.`);
    if (!seconds || newBpm === null) return setError('Type a length: a timecode like 0:25:00 or seconds like 25.5.');
    if (newBpm < 40 || newBpm > 240) return setError(`That needs ${formatBpm(newBpm)} BPM. The tempo must be 40 to 240.`);
    if (mapped) {
      const message = useTimelineStore.getState().scaleTempo(newBpm / bpm);
      if (message) return setError(message);
    } else useTimelineStore.getState().setBpm(newBpm);
    onClose();
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') apply();
  };

  const choices: Array<{ value: FitRange; label: string; disabled?: boolean }> = [
    { value: 'loop', label: 'Loop In→Out' },
    { value: 'song', label: 'Whole song', disabled: songBars <= 0 },
    { value: 'bars', label: 'Bars' },
    { value: 'hits', label: 'Hit points' },
  ];

  return (
    <Popover label="Fit tempo to a length" onClose={onClose} anchorRef={anchorRef} className="left-0">
      <div className="text-sm font-semibold text-forge-text">Fit tempo to a length</div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="What to fit">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={c.disabled}
            aria-pressed={range === c.value}
            onClick={() => {
              setRange(c.value);
              setError('');
            }}
            title={c.disabled ? 'The timeline is empty' : undefined}
            className={`h-7 px-2 rounded-md border font-mono text-[11px] disabled:opacity-40 ${
              range === c.value ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border text-forge-muted hover:text-forge-text'
            }`}
          >
            {c.label}
          </button>
        ))}
        {range === 'bars' && (
          <input
            value={barsText}
            inputMode="decimal"
            onChange={(e) => {
              setBarsText(e.target.value);
              setError('');
            }}
            onKeyDown={onEnter}
            className={`${fieldClass(typedBars === null || typedBars > TOTAL_BARS)} !h-7 w-16`}
            aria-label="Number of bars to fit"
          />
        )}
      </div>
      {range === 'hits' ? (
        <HitFinder onClose={onClose} />
      ) : (
      <>
      <p>
        {bars ? (
          <>
            {formatBarCount(bars)} bar{bars === 1 ? '' : 's'} now last <span className="font-mono text-forge-text">{lengthOf(bars, bpm)}</span>
          </>
        ) : range === 'song' ? (
          'The timeline is empty.'
        ) : (
          `Type a number of bars, up to ${TOTAL_BARS}.`
        )}
      </p>
      <label className="flex flex-col gap-1">
        <span>Target length</span>
        <input
          data-autofocus
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setError('');
          }}
          onKeyDown={onEnter}
          placeholder="0:25:00 or 25.5"
          className={fieldClass(target.trim() !== '' && !seconds)}
          aria-label={`Target length: a timecode at ${frameRateLabel(fps, dropFrame)} or seconds`}
        />
        <span className="text-[11px]">
          A timecode at {frameRateLabel(fps, dropFrame)} (like 0:25:00) or plain seconds (25.5).
        </span>
      </label>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-forge-text">
          {newBpm === null ? '—' : <span className={newBpm < 40 || newBpm > 240 ? 'text-red-300' : 'text-cyan-200'}>{formatBpm(newBpm)} BPM</span>}
        </div>
        <button
          type="button"
          onClick={apply}
          className="h-8 px-3 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-200 font-mono text-xs hover:bg-cyan-500/25"
        >
          Apply
        </button>
      </div>
      {newBpm !== null && bars !== null && newBpm >= 40 && newBpm <= 240 && (
        <p className="text-[11px]">
          At {formatBpm(newBpm)} BPM, {formatBarCount(bars)} bar{bars === 1 ? '' : 's'} last <span className="font-mono">{lengthOf(bars, newBpm)}</span>.
        </p>
      )}
      {error && <p className="text-red-400">{error}</p>}
      </>
      )}
    </Popover>
  );
};

/**
 * The tempo finder: the markers locked to time are the hit points (moments in the video the music
 * must hit), and it lists the tempos that put the most of them on a bar, beat or 1/8. A hit counts
 * when it's within a frame. Applying one sets the tempo; the hits keep their times, so they then
 * sit on the grid.
 */
const HitFinder: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const markers = useTimelineStore((s) => s.markers);
  const hits = useMemo(() => markers.filter((m) => m.anchor === 'time' && m.seconds > 0), [markers]);
  const [grid, setGrid] = useState<HitGrid>('beat');
  const [minText, setMinText] = useState('70');
  const [maxText, setMaxText] = useState('180');
  const [picked, setPicked] = useState(0);
  const min = parseDecimal(minText);
  const max = parseDecimal(maxText);
  const rangeOk = min !== null && max !== null && min >= 40 && max <= 240 && min <= max;
  const tolerance = 1 / fps;
  const seconds = useMemo(() => hits.map((h) => h.seconds), [hits]);
  const suggestions = useMemo(
    () => (rangeOk ? findTempos(seconds, { grid, min: min!, max: max!, tolerance, near: bpm }) : []),
    [seconds, grid, min, max, rangeOk, tolerance, bpm]
  );
  const now = scoreTempo(seconds, bpm, grid, tolerance);
  const gridWord = grid === 'bar' ? 'a bar line' : grid === 'beat' ? 'the beat' : 'an 1/8';
  const shown: TempoSuggestion | undefined = suggestions[Math.min(picked, suggestions.length - 1)];
  const offText = (off: number) => {
    const frames = Math.abs(off) * fps;
    if (Math.abs(off) < 0.0005) return 'exact';
    return `${off < 0 ? 'early' : 'late'} ${Math.round(Math.abs(off) * 1000)} ms${frames >= 0.5 ? ` (${frames.toFixed(1)} fr)` : ''}`;
  };

  if (!hits.length) {
    return (
      <div className="flex flex-col gap-2 max-w-[22rem]">
        <p>
          Hit points are moments in the video the music should land on: a door slam, a cut, a logo. Move the playhead to one and press{' '}
          <kbd className="font-mono text-forge-text">Shift+M</kbd> to drop a hit there (or right-click any marker flag and choose <strong>Lock to time</strong>).
        </p>
        <p>Add a few, then come back here: it finds the tempos that put the most of them on the beat.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-[22rem] max-w-full">
      <p>
        {hits.length} hit point{hits.length === 1 ? '' : 's'} (markers locked to time). Land them on:
      </p>
      <div className="flex items-center gap-1.5" role="group" aria-label="Land the hits on">
        {HIT_GRIDS.map((g) => (
          <button
            key={g.value}
            type="button"
            aria-pressed={grid === g.value}
            onClick={() => {
              setGrid(g.value);
              setPicked(0);
            }}
            className={`h-7 px-2 rounded-md border font-mono text-[11px] ${
              grid === g.value ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border text-forge-muted hover:text-forge-text'
            }`}
          >
            {g.label}
          </button>
        ))}
        <span className="ml-auto text-[11px]">BPM</span>
        <input value={minText} onChange={(e) => setMinText(e.target.value)} inputMode="decimal" className={`${fieldClass(!rangeOk)} !h-7 w-14`} aria-label="Slowest tempo to try" />
        <span>to</span>
        <input value={maxText} onChange={(e) => setMaxText(e.target.value)} inputMode="decimal" className={`${fieldClass(!rangeOk)} !h-7 w-14`} aria-label="Fastest tempo to try" />
      </div>
      {!rangeOk && <p className="text-red-400">Type a tempo range between 40 and 240.</p>}
      <p className="text-[11px]">
        Now, at {formatBpm(bpm)} BPM: {now.onGrid} of {hits.length} on {gridWord} (within a frame).
      </p>
      <ul className="flex flex-col gap-1" aria-label="Suggested tempos">
        {suggestions.map((sg, i) => (
          <li key={sg.bpm} className={`flex items-center gap-2 rounded-md border px-2 py-1 ${i === picked ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-forge-border'}`}>
            <button type="button" onClick={() => setPicked(i)} className="flex-1 min-w-0 text-left" title="Show where each hit lands">
              <span className="font-mono text-forge-text">{formatBpm(sg.bpm)} BPM</span>{' '}
              <span className={sg.onGrid === hits.length ? 'text-emerald-300' : ''}>
                {sg.onGrid}/{hits.length} on {gridWord}
              </span>
              <span className="text-[11px]"> · avg {Math.round(sg.meanOff * 1000)} ms</span>
            </button>
            <button
              type="button"
              onClick={() => {
                useTimelineStore.getState().setBpm(sg.bpm);
                onClose();
              }}
              className="h-6 px-2 rounded border border-cyan-400/60 bg-cyan-500/15 text-cyan-200 font-mono text-[11px] hover:bg-cyan-500/25"
              aria-label={`Set the tempo to ${formatBpm(sg.bpm)} BPM`}
            >
              Apply
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <table className="text-[11px] font-mono">
          <caption className="text-left text-forge-muted pb-0.5">At {formatBpm(shown.bpm)} BPM:</caption>
          <tbody>
            {shown.hits.map((h, i) => (
              <tr key={hits[i].id}>
                <td className="pr-2 truncate max-w-[7rem] text-forge-text">{hits[i].name}</td>
                <td className="pr-2">{formatSmpte(secondsToBar(h.seconds, shown.bpm), shown.bpm, fps, dropFrame)}</td>
                <td className="pr-2">{formatBarsBeats(h.bar)}</td>
                <td className={Math.abs(h.off) <= tolerance ? 'text-emerald-300' : 'text-amber-300'}>{offText(-h.off)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
