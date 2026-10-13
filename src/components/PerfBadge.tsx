/**
 * The performance badge in the header: how smoothly playback is going (perfMonitor.ts), with Clear
 * memory, and a warning with tips while playback lags.
 */
import React, { useRef, useState } from 'react';
import { Gauge, MemoryStick, TriangleAlert, X } from 'lucide-react';
import { clearMemory, usePerfStore } from '../audio/perfMonitor';
import { chosenPlaybackMode, choosePlaybackMode, PLAYBACK_MODE } from '../audio/playbackMode';
import { Popover } from './Popover';
import { showToast } from './timeline/toastStore';

/** The audio engine is behind when its clock runs under this share of real time (see perfMonitor.ts). */
const audioBehind = (speed: number | null) => speed !== null && speed < 0.97;

/** Stable playback (a bigger audio buffer) from the next start; a button while it's off. */
const StableButton: React.FC = () => {
  const [chosen, setChosen] = useState(chosenPlaybackMode());
  if (PLAYBACK_MODE === 'stable') return null;
  if (chosen === 'stable') return <span className="text-emerald-300">Stable playback is on from the next reload.</span>;
  return (
    <button
      type="button"
      onClick={() => {
        choosePlaybackMode('stable');
        setChosen('stable');
        showToast('Stable playback is on from the next reload (your song is kept)');
      }}
      className="h-8 px-3 rounded-md border border-amber-400/70 bg-amber-500/15 text-amber-100 font-semibold hover:bg-amber-500/25"
    >
      Use Stable playback
    </button>
  );
};

const runClear = (history: boolean) => {
  const mb = clearMemory({ history });
  showToast(`Memory cleared${mb > 0 ? `: about ${mb} MB of sound let go` : ''}${history ? ', undo history emptied' : ''}`);
};

/** What to try when it lags, beyond clearing memory. */
const Tips: React.FC = () => (
  <ul className="list-disc pl-4 space-y-0.5 text-forge-muted">
    <li>
      <b className="text-forge-text">Freeze</b> your busiest tracks (the snowflake on a track header): they then play as audio, far lighter.
    </li>
    <li>
      Turn on <b className="text-forge-text">Stable playback</b> (Inspector › Master › Playback): a bigger audio buffer.
    </li>
    <li>Close other browser tabs and programs, and keep this tab in front while it plays.</li>
  </ul>
);

/**
 * In the header: how smoothly playback is going (from perfMonitor.ts), with a Clear memory button;
 * while playback lags, a warning offers the same.
 */
export const PerfBadge: React.FC = () => {
  const lagging = usePerfStore((s) => s.lagging);
  const late = usePerfStore((s) => s.lateNotes);
  const hitches = usePerfStore((s) => s.hitches);
  const worst = usePerfStore((s) => s.worstFrame);
  const audioSpeed = usePerfStore((s) => s.audioSpeed);
  const behind = audioBehind(audioSpeed);
  const memory = usePerfStore((s) => s.memoryMB);
  const dismissed = usePerfStore((s) => s.dismissed);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-mono border transition ${
          lagging ? 'border-amber-400 bg-amber-500/15 text-amber-200' : 'border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text'
        }`}
        title={lagging ? 'Playback is lagging: click for help' : 'Performance and memory'}
      >
        {lagging ? <TriangleAlert className="w-4 h-4" /> : <Gauge className="w-4 h-4" />}
        {lagging ? 'LAG' : memory !== null ? `${memory} MB` : 'PERF'}
      </button>
      {open && (
        <Popover label="Performance" onClose={() => setOpen(false)} anchorRef={anchor} className="right-0">
          <span className="text-sm font-semibold text-forge-text">Performance</span>
          <p className={lagging ? 'text-amber-200' : 'text-emerald-300'}>{lagging ? 'Playback is lagging.' : 'Playback is keeping up.'}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <span className="text-forge-muted">Late notes (4 s)</span>
            <span className="text-forge-text tabular-nums">{late}</span>
            <span className="text-forge-muted">Page freezes (4 s)</span>
            <span className="text-forge-text tabular-nums">{hitches}{worst ? `, longest ${worst} ms` : ''}</span>
            <span className="text-forge-muted">Audio engine speed</span>
            <span className={`tabular-nums ${behind ? 'text-amber-200' : 'text-forge-text'}`}>{audioSpeed === null ? 'measured while playing' : `${Math.round(audioSpeed * 100)}% of real time`}</span>
            <span className="text-forge-muted">Memory in use</span>
            <span className="text-forge-text tabular-nums">{memory !== null ? `${memory} MB` : 'not shown by this browser'}</span>
          </div>
          <label className="flex items-start gap-2 text-forge-text">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="mt-0.5 accent-amber-400" />
            <span>
              Also empty the undo history
              <span className="block text-forge-muted text-[11px]">Frees the most on long sessions, but earlier edits can't be undone.</span>
            </span>
          </label>
          <button
            type="button"
            onClick={() => runClear(history)}
            className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 text-xs font-semibold hover:bg-cyan-500/25"
          >
            <MemoryStick className="w-4 h-4" /> Clear memory
          </button>
          <Tips />
        </Popover>
      )}
      {lagging && !dismissed && !open && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,460px)] rounded-lg border border-amber-400/70 bg-forge-panel shadow-2xl p-3 text-xs flex flex-col gap-2" role="alert">
          <div className="flex items-center gap-2 text-amber-200 font-semibold">
            <TriangleAlert className="w-4 h-4" /> Playback is lagging
            <button type="button" onClick={() => usePerfStore.getState().dismiss()} className="ml-auto text-forge-muted hover:text-forge-text" title="Hide until playback starts again">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-forge-muted">
            {behind
              ? `The audio engine can't keep up (it ran at ${Math.round((audioSpeed ?? 0) * 100)}% of real time), so the sound may crackle. Freeze your busiest tracks, or use Stable playback.`
              : `${late > 0 ? `${late} notes played late` : 'The page froze'}${hitches > 0 && late > 0 ? ` and the page froze ${hitches} times` : ''} in the last few seconds.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {behind && <StableButton />}
            <button type="button" onClick={() => runClear(false)} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25">
              <MemoryStick className="w-4 h-4" /> Clear memory
            </button>
            <button type="button" onClick={() => setOpen(true)} className="h-8 px-3 rounded-md border border-forge-border text-forge-text hover:border-forge-borderLight">
              More help
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
