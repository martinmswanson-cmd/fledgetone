import React, { useState } from 'react';
import { TOTAL_BARS, useTimelineStore } from '../store/timelineStore';
import { formatBarCount, formatBpm, frameRateLabel } from '../store/timelineTypes';
import { barToSeconds, formatSmpte, parseTimecode } from '../audio/transport';
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

type FitRange = 'loop' | 'song' | 'bars';

/** A typed positive number ("8", "7.5", "7,5"), or null. */
function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? Number(t) : null;
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
  const songBars = useTimelineStore((s) => s.clips.reduce((end, c) => Math.max(end, c.startBar + c.lengthBars), 1) - 1);
  const [range, setRange] = useState<FitRange>('loop');
  const [barsText, setBarsText] = useState('8');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');

  const typedBars = parseDecimal(barsText);
  const bars = range === 'loop' ? loopBars : range === 'song' ? songBars : typedBars !== null && typedBars <= TOTAL_BARS ? typedBars : null;
  // Plain numbers are seconds ("25.5"); anything else is a timecode at the project's rate
  const seconds = parseDecimal(target) ?? parseTimecode(target, fps, dropFrame);
  const newBpm = bars && seconds ? Math.round(((bars * 240) / seconds) * 100) / 100 : null;
  const timecodeOf = (b: number, tempo: number) => formatSmpte(1 + b, tempo, fps, dropFrame);
  const lengthOf = (b: number, tempo: number) => `${timecodeOf(b, tempo)} (${barToSeconds(1 + b, tempo).toFixed(3)} s)`;

  const apply = () => {
    if (!bars) return setError(range === 'song' ? 'The timeline is empty.' : `Type a number of bars, up to ${TOTAL_BARS}.`);
    if (!seconds || newBpm === null) return setError('Type a length: a timecode like 0:25:00 or seconds like 25.5.');
    if (newBpm < 40 || newBpm > 240) return setError(`That needs ${formatBpm(newBpm)} BPM. The tempo must be 40 to 240.`);
    useTimelineStore.getState().setBpm(newBpm);
    onClose();
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') apply();
  };

  const choices: Array<{ value: FitRange; label: string; disabled?: boolean }> = [
    { value: 'loop', label: 'Loop In→Out' },
    { value: 'song', label: 'Whole song', disabled: songBars <= 0 },
    { value: 'bars', label: 'Bars' },
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
          autoFocus
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
    </Popover>
  );
};
