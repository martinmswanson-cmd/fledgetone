import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { frameRateLabel } from '../../store/timelineTypes';
import {
  formatBarsBeats,
  formatBarsBeatsLength,
  formatSmpte,
  parseBarsBeats,
  parseBarsBeatsLength,
  parseTimecode,
  secondsToBar,
} from '../../audio/transport';
import { Popover } from '../Popover';

interface LoopFieldProps {
  label: string;
  /** The value as shown in the ruler's units */
  value: string;
  /** The same value in the other units, shown beside the field */
  other: string;
  /** Apply typed text; false if it can't be read or doesn't make a valid loop */
  apply: (text: string) => boolean;
  /** Focus this field when the panel opens */
  autoFocus?: boolean;
}

/**
 * A loop field: shows the current value; Enter, or Tab to the next field, applies what's typed.
 * Leaving it any other way (a click elsewhere, Esc) drops the edit.
 */
const LoopField: React.FC<LoopFieldProps> = ({ label, value, other, apply, autoFocus }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  /** Apply the draft if it changed; false (and red) if it can't be applied. */
  const commit = () => {
    if (draft === null || draft === value) return true;
    if (!apply(draft)) {
      setInvalid(true);
      return false;
    }
    setDraft(null);
    setInvalid(false);
    return true;
  };

  return (
    <label className="grid grid-cols-[3.5rem_1fr] items-center gap-x-2 gap-y-0.5">
      <span className="font-mono uppercase tracking-wider text-[10px]">{label}</span>
      <input
        data-autofocus={autoFocus || undefined}
        value={draft ?? value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const input = e.currentTarget;
            // Ready to type over again
            if (commit()) requestAnimationFrame(() => input.select());
          } else if (e.key === 'Tab' && !commit()) {
            e.preventDefault();
          }
        }}
        onBlur={() => {
          setDraft(null);
          setInvalid(false);
        }}
        className={`h-8 min-w-0 bg-forge-bg border rounded-md px-2 font-mono text-sm tabular-nums focus:outline-none ${
          invalid ? 'border-red-500 text-red-300' : 'border-forge-border text-forge-text focus:border-cyan-500'
        }`}
        aria-label={`Loop ${label}`}
        aria-invalid={invalid}
      />
      <span className="col-start-2 font-mono text-[10px] text-forge-muted/80 tabular-nums">{other}</span>
    </label>
  );
};

/**
 * Exact loop range: In, Out and Length as typed numbers, in the ruler's units (bars or timecode).
 * Either form is accepted in every field, and typed values are used as they are (no snapping).
 */
const LoopRangePopover: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void }> = ({
  anchorRef,
  onClose,
}) => {
  const inBar = useTimelineStore((s) => s.loopRegion.inBar);
  const outBar = useTimelineStore((s) => s.loopRegion.outBar);
  const units = useTimelineStore((s) => s.rulerUnits);
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const timecode = (bar: number) => formatSmpte(bar, bpm, fps, dropFrame);
  const position = (bar: number) => ({ bars: formatBarsBeats(bar), timecode: timecode(bar) });
  const length = { bars: formatBarsBeatsLength(outBar - inBar), timecode: timecode(1 + outBar - inBar) };
  const shown = (v: { bars: string; timecode: string }) => (units === 'bars' ? v.bars : v.timecode);
  const hidden = (v: { bars: string; timecode: string }) => (units === 'bars' ? v.timecode : v.bars);

  // Text with : or ; is a timecode; anything else counts in bars
  const isTimecode = (text: string) => /[:;]/.test(text);
  const readPosition = (text: string): number | null => {
    if (!isTimecode(text)) return parseBarsBeats(text);
    const seconds = parseTimecode(text, fps, dropFrame);
    return seconds === null ? null : secondsToBar(seconds, bpm);
  };
  const readLength = (text: string): number | null => {
    if (!isTimecode(text)) return parseBarsBeatsLength(text);
    const seconds = parseTimecode(text, fps, dropFrame);
    return seconds === null ? null : secondsToBar(seconds, bpm) - 1;
  };
  const inSong = (bar: number | null) => bar !== null && bar <= TOTAL_BARS + 1;
  const { setLoopRange } = useTimelineStore.getState();

  return (
    <Popover label="Loop range" onClose={onClose} anchorRef={anchorRef} className="left-0">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-forge-text">Loop range</span>
        <span className="font-mono text-[10px]">{units === 'bars' ? 'bar.beat.hundredths' : `timecode, ${frameRateLabel(fps, dropFrame)}`}</span>
      </div>
      <LoopField
        label="In"
        value={shown(position(inBar))}
        other={hidden(position(inBar))}
        autoFocus
        apply={(text) => {
          const bar = readPosition(text);
          if (bar === null) return false;
          const loop = useTimelineStore.getState().loopRegion;
          // An In at or past Out moves the whole loop there, keeping its length
          const out = bar < loop.outBar ? loop.outBar : bar + loop.outBar - loop.inBar;
          return inSong(out) && setLoopRange(bar, out);
        }}
      />
      <LoopField
        label="Out"
        value={shown(position(outBar))}
        other={hidden(position(outBar))}
        apply={(text) => {
          const bar = readPosition(text);
          if (bar === null || !inSong(bar)) return false;
          const loop = useTimelineStore.getState().loopRegion;
          // An Out at or before In moves the whole loop back to end there, keeping its length
          const start = bar > loop.inBar ? loop.inBar : bar - (loop.outBar - loop.inBar);
          return start >= 1 && setLoopRange(start, bar);
        }}
      />
      <LoopField
        label="Length"
        value={shown(length)}
        other={hidden(length)}
        apply={(text) => {
          const bars = readLength(text);
          const start = useTimelineStore.getState().loopRegion.inBar;
          return bars !== null && inSong(start + bars) && setLoopRange(start, start + bars);
        }}
      />
      <p className="text-[11px] leading-snug">
        Type a bar position (17.3.50) or a timecode with : or ; (00:00:12:15). Length takes bars.beats (8, or 2.2 for two bars and
        two beats) or a timecode. Enter applies. Typed values don't snap; the loop is at least a 16th long. An In past Out (or an
        Out before In) moves the whole loop.
      </p>
    </Popover>
  );
};

/** The small chevron beside the Loop button that opens the exact loop range editor. */
export const LoopRangeButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Loop In, Out and Length: type exact values"
        className={`h-8 w-5 -ml-1 flex items-center justify-center rounded-md border text-xs transition-colors ${
          open ? 'bg-amber-500/15 border-amber-400/70 text-amber-300' : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
        }`}
      >
        <ChevronDown className="w-3.5 h-3.5" />
        <span className="sr-only">Loop range</span>
      </button>
      {open && <LoopRangePopover anchorRef={anchorRef} onClose={close} />}
    </>
  );
};
