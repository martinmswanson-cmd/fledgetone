import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Circle, KeyboardMusic, Triangle } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { ALL_INPUTS, useMidiStore } from '../../store/midiStore';
import { useMidiLearn } from '../../store/midiLearn';
import { specOf } from '../../audio/automation';
import type { MidiActivity } from '../../store/midiStore';
import { QUANTIZE_GRIDS } from '../../store/recording';
import type { QuantizeGrid } from '../../store/recording';
import { connectMidi } from '../../audio/liveInput';
import { PIANO_OCTAVE_MAX, PIANO_OCTAVE_MIN } from '../../audio/midi';
import { Popover } from '../Popover';
import { showToast } from './toastStore';
import { HEADER_WIDTH, TRACK_HEIGHT } from './layout';
import { laneTops } from './rows';
import { useVideoStore } from '../../store/videoStore';

const toolButton = (active: boolean, activeClass: string) =>
  `h-8 min-w-8 px-2 flex items-center justify-center gap-1.5 rounded-md border text-xs font-mono transition-colors ${
    active ? activeClass : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
  }`;

const chevronButton = (open: boolean, activeClass: string) =>
  `h-8 w-5 -ml-1 flex items-center justify-center rounded-md border text-xs transition-colors ${
    open ? activeClass : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
  }`;

const checkbox = 'accent-red-400 cursor-pointer';

/** Count-in, quantize and the metronome's volume: the settings behind the Record button's chevron. */
const RecordOptionsPopover: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void }> = ({ anchorRef, onClose }) => {
  const options = useTimelineStore((s) => s.recordOptions);
  const punch = useTimelineStore((s) => s.punch);
  const latency = useMidiStore((s) => s.outputLatency);
  const { setRecordOptions, setPunch } = useTimelineStore.getState();
  const barInput = 'h-7 w-16 bg-forge-bg border border-forge-border rounded-md px-1.5 text-xs font-mono text-forge-text focus:outline-none focus:border-cyan-500';
  return (
    <Popover label="Recording" onClose={onClose} anchorRef={anchorRef} className="left-0">
      <span className="text-sm font-semibold text-forge-text">Recording</span>
      <label data-search="count-in" className="flex items-center gap-2 text-forge-text">
        <input type="checkbox" className={checkbox} checked={options.countIn} onChange={(e) => setRecordOptions({ countIn: e.target.checked })} />
        1-bar count-in
      </label>
      <label className="flex items-center justify-between gap-2 text-forge-text">
        Quantize
        <select
          value={options.quantize}
          onChange={(e) => setRecordOptions({ quantize: e.target.value as QuantizeGrid })}
          className="h-7 bg-forge-bg border border-forge-border rounded-md px-2 text-xs font-mono text-forge-text focus:outline-none focus:border-cyan-500"
          aria-label="Quantize recorded notes"
        >
          {QUANTIZE_GRIDS.map((g) => (
            <option key={g} value={g}>
              {g === 'off' ? 'Off' : g}
            </option>
          ))}
        </select>
      </label>
      <label data-search="metronome-while" className="flex items-center gap-2 text-forge-text">
        <input type="checkbox" className={checkbox} checked={options.metronome} onChange={(e) => setRecordOptions({ metronome: e.target.checked })} />
        Metronome while playing
      </label>
      <label data-search="takes" className="flex items-center gap-2 text-forge-text">
        <input type="checkbox" className={checkbox} checked={options.takes} onChange={(e) => setRecordOptions({ takes: e.target.checked })} />
        Loop passes are takes (comp them after)
      </label>
      <div className="flex flex-col gap-1.5 border-t border-forge-border pt-2">
        <label data-search="punch" className="flex items-center gap-2 text-forge-text">
          <input type="checkbox" className={checkbox} checked={punch.enabled} onChange={(e) => setPunch({ enabled: e.target.checked })} />
          Punch in / out
        </label>
        <div className="flex items-center gap-1.5">
          <span className="w-6">In</span>
          <input
            type="number"
            min={1}
            step={0.25}
            value={Math.round(punch.inBar * 1000) / 1000}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setPunch({ inBar: e.target.valueAsNumber })}
            className={barInput}
            aria-label="Punch in bar"
          />
          <span className="w-7 text-right">Out</span>
          <input
            type="number"
            min={1}
            step={0.25}
            value={Math.round(punch.outBar * 1000) / 1000}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setPunch({ outBar: e.target.valueAsNumber })}
            className={barInput}
            aria-label="Punch out bar"
          />
          <button
            type="button"
            onClick={() => {
              const loop = useTimelineStore.getState().loopRegion;
              setPunch({ enabled: true, inBar: loop.inBar, outBar: loop.outBar });
            }}
            className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-forge-text hover:border-red-400/70"
            title="Punch over the loop region"
          >
            = loop
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-forge-text">
        <span className="w-[4.5rem]">Click level</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={options.metronomeVolume}
          onChange={(e) => setRecordOptions({ metronomeVolume: Number(e.target.value) })}
          className="flex-1 min-w-0 accent-amber-400 cursor-pointer"
          aria-label="Metronome volume"
        />
        <span className="w-9 text-right font-mono tabular-nums">{Math.round(options.metronomeVolume * 100)}%</span>
      </label>
      <p className="text-[11px] leading-snug">
        Arm a track (R on its header), switch Record on and press Play: what you play on the MIDI or computer keyboard goes into a new
        clip on that track, from Play to Stop, in whole bars. The count-in clicks a bar first. With the loop on, every pass adds to the
        same take, or with "Loop passes are takes", each pass is a take of its own, and recording over a clip of the same span adds
        takes to it (right-click it, Takes, to comp). Punch keeps only what's played between its In and Out (the red stretch on the
        ruler), so you can play along from earlier and replace just that part. Quantize snaps the notes on Stop; Ctrl+Z puts them
        back where you played them, and again removes the take.
        {latency !== null && ` Notes are placed where you heard them (output latency ${Math.round(latency * 1000)} ms allowed for).`}
      </p>
    </Popover>
  );
};

/**
 * The Record button (record mode), lit while a take is being recorded, with the chevron that
 * opens the recording settings.
 */
export const RecordButton: React.FC = () => {
  const isRecording = useTimelineStore((s) => s.isRecording);
  const taking = useTimelineStore((s) => s.take !== null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = () => {
    const s = useTimelineStore.getState();
    s.toggleRecord();
    if (!s.isRecording && !s.tracks.some((t) => t.isArmed)) showToast('Record is on. Arm a track (R on its header) and press Play to record onto it.');
  };
  return (
    <div className="relative flex items-center">
      <button
        id="btn-record"
        type="button"
        title="Record: with a track armed (R), Play records what you play into a take on it"
        aria-pressed={isRecording}
        onClick={toggle}
        className={toolButton(isRecording, `bg-red-500/20 border-red-500 text-red-300 ${taking ? 'animate-pulse' : ''}`)}
      >
        <Circle className={`w-3.5 h-3.5 ${isRecording ? 'fill-red-500 text-red-500' : 'fill-red-500/60 text-red-500/60'}`} />
        {taking && <span className="text-[10px] font-bold">REC</span>}
      </button>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Recording settings: count-in, quantize, metronome level"
        className={chevronButton(open, 'bg-red-500/15 border-red-400/70 text-red-300')}
      >
        <ChevronDown className="w-3.5 h-3.5" />
        <span className="sr-only">Recording settings</span>
      </button>
      {open && <RecordOptionsPopover anchorRef={anchorRef} onClose={close} />}
    </div>
  );
};

/** Metronome on / off: a click on every beat while playing, the first of each bar accented. */
export const MetronomeButton: React.FC = () => {
  const on = useTimelineStore((s) => s.recordOptions.metronome);
  return (
    <button
      id="btn-metronome"
      type="button"
      title="Metronome: a click on every beat while playing, accented on beat 1 (never in exports)"
      aria-pressed={on}
      onClick={() => useTimelineStore.getState().setRecordOptions({ metronome: !on })}
      className={toolButton(on, 'bg-amber-500/15 border-amber-400/70 text-amber-300')}
    >
      <Triangle className="w-4 h-4" />
      <span className="sr-only">Metronome</span>
    </button>
  );
};

/** True for a moment after each MIDI message (the message is "lit" until its timer marks it seen). */
function useActivityLit(): boolean {
  const activity = useMidiStore((s) => s.activity);
  const [seen, setSeen] = useState<MidiActivity | null>(null);
  useEffect(() => {
    if (!activity) return;
    const timer = window.setTimeout(() => setSeen(activity), 150);
    return () => clearTimeout(timer);
  }, [activity]);
  return activity !== null && activity !== seen;
}

/** Lights for a moment on every MIDI message, with what it was. */
const ActivityLight: React.FC = () => {
  const activity = useMidiStore((s) => s.activity);
  const lit = useActivityLit();
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px]" aria-live="off">
      <span className={`w-2 h-2 rounded-full transition-colors ${lit ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-forge-border'}`} />
      {activity ? activity.text : 'no activity yet'}
    </span>
  );
};

/** Where live notes go: the armed track, else the selected one. */
const PlaysOn: React.FC = () => {
  const name = useTimelineStore((s) => {
    const armed = s.tracks.find((t) => t.isArmed);
    const track = armed ?? s.tracks.find((t) => t.id === s.selectedTrackId);
    return track ? `${track.name} (${armed ? 'armed' : 'selected'})` : 'no track';
  });
  return (
    <p className="text-[11px]">
      Plays on <b className="text-forge-text">{name}</b>, through its channel strip.
    </p>
  );
};

/** MIDI device choice and status, and the computer keyboard piano. */
const MidiPopover: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void }> = ({ anchorRef, onClose }) => {
  const support = useMidiStore((s) => s.support);
  const inputs = useMidiStore((s) => s.inputs);
  const inputId = useMidiStore((s) => s.inputId);
  const keyboardPiano = useMidiStore((s) => s.keyboardPiano);
  const octave = useMidiStore((s) => s.octave);
  const { setInputId, setKeyboardPiano, setOctave } = useMidiStore.getState();
  const select = 'h-7 min-w-0 flex-1 bg-forge-bg border border-forge-border rounded-md px-2 text-xs font-mono text-forge-text focus:outline-none focus:border-cyan-500';
  const button = 'h-7 px-2 rounded-md border border-forge-border bg-forge-bg text-[11px] text-forge-text hover:border-cyan-500/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400';
  const octaveName = `C${octave} to F${octave + 1}`;

  return (
    // Its label is how the keyboard piano tells this dialog from the others (which pause it)
    <Popover label="MIDI input" onClose={onClose} anchorRef={anchorRef} className="left-0">
      <span className="text-sm font-semibold text-forge-text">MIDI input</span>
      {support === 'unsupported' && (
        <p className="leading-snug text-amber-300">
          This browser has no Web MIDI (Safari doesn't). Use Chrome, Edge or Firefox for a MIDI keyboard, or play the computer keyboard
          below.
        </p>
      )}
      {support === 'unknown' && (
        <div className="flex flex-col gap-1.5">
          <button type="button" data-autofocus onClick={() => void connectMidi()} className={button}>
            Connect MIDI devices
          </button>
          <p className="leading-snug">Chrome and Edge connect straight away; Firefox asks you first.</p>
        </div>
      )}
      {support === 'requesting' && <p>Asking the browser for your MIDI devices…</p>}
      {support === 'denied' && (
        <div className="flex flex-col gap-1.5">
          <p className="leading-snug text-amber-300">The browser refused MIDI access. Allow it in the site settings (the icon by the address bar), then try again.</p>
          <button type="button" onClick={() => void connectMidi()} className={button}>
            Try again
          </button>
        </div>
      )}
      {support === 'ready' && (
        <>
          <label className="flex items-center gap-2">
            <span className="w-10 shrink-0 font-mono uppercase tracking-wider text-[10px]">Input</span>
            <select value={inputId} onChange={(e) => setInputId(e.target.value)} className={select} aria-label="MIDI input device" data-autofocus>
              <option value={ALL_INPUTS}>All inputs</option>
              {inputs.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.state === 'disconnected' ? ' (unplugged)' : ''}
                </option>
              ))}
            </select>
          </label>
          {inputs.length === 0 && <p className="leading-snug">No MIDI devices found. Plug one in: it's picked up as soon as it appears.</p>}
          <ActivityLight />
        </>
      )}
      <PlaysOn />
      <MpeToggle />
      <div className="border-t border-forge-border pt-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-forge-text">
          <input type="checkbox" className="accent-cyan-400 cursor-pointer" checked={keyboardPiano} onChange={(e) => setKeyboardPiano(e.target.checked)} />
          Computer keyboard piano
        </label>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0">Octave</span>
          <button type="button" onClick={() => setOctave(octave - 1)} disabled={octave <= PIANO_OCTAVE_MIN} className={`${button} disabled:opacity-40`} title="An octave down (Z)">
            -
          </button>
          <span className="font-mono tabular-nums text-forge-text">{octaveName}</span>
          <button type="button" onClick={() => setOctave(octave + 1)} disabled={octave >= PIANO_OCTAVE_MAX} className={`${button} disabled:opacity-40`} title="An octave up (X)">
            +
          </button>
        </div>
        <p className="text-[11px] leading-snug">
          A S D F G H J K L ; ' are the white keys from C, W E T Y U O P the black ones, Z and X move an octave. While the piano is on,
          those keys play notes instead of their usual jobs (the Audition Deck pads, L loop, O set Out); the rest still work.
        </p>
      </div>
      <MidiMappings />
    </Popover>
  );
};

/** Toolbar button that opens the MIDI popover; it shows "KBD" while the computer keyboard piano is on. */
export const MidiButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const ready = useMidiStore((s) => s.support === 'ready');
  const keyboardPiano = useMidiStore((s) => s.keyboardPiano);
  const lit = useActivityLit();
  return (
    <div className="relative flex items-center">
      <button
        ref={anchorRef}
        id="btn-midi"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="MIDI input: choose a keyboard, see activity, or play the computer keyboard"
        className={toolButton(open || ready || keyboardPiano, 'bg-cyan-500/15 border-cyan-400/70 text-cyan-200')}
      >
        <KeyboardMusic className={`w-4 h-4 ${lit ? 'text-emerald-300' : ''}`} />
        {keyboardPiano && <span className="text-[10px]">KBD</span>}
        <span className="sr-only">MIDI input</span>
      </button>
      {open && <MidiPopover anchorRef={anchorRef} onClose={close} />}
    </div>
  );
};

/** A translucent red block over the armed lane while a take is being recorded, from its start to the playhead. */
export const RecordingMarker: React.FC = () => {
  const take = useTimelineStore((s) => s.take);
  const hasVideo = useVideoStore((s) => !!s.video);
  const rowTop = useTimelineStore((s) => (s.take ? laneTops(s.tracks, hasVideo).tops.get(s.take.trackId) ?? -1 : -1));
  const zoom = useTimelineStore((s) => s.zoom);
  // The playhead is read only while a take runs, so nothing here re-renders per frame otherwise
  const playhead = useTimelineStore((s) => (s.take ? s.playheadPosition : 0));
  if (!take || rowTop < 0) return null;
  const from = Math.min(take.startBar, playhead);
  const to = Math.max(take.startBar, playhead);
  return (
    <div
      className="absolute z-[14] pointer-events-none rounded-sm border border-red-400/70 bg-red-500/15 flex items-start px-1 text-[10px] font-mono font-bold text-red-200"
      style={{
        left: HEADER_WIDTH + (from - 1) * zoom,
        top: rowTop + 2,
        width: Math.max(3, (to - from) * zoom),
        height: TRACK_HEIGHT - 5,
      }}
      aria-hidden
    >
      REC
    </div>
  );
};

/** The controller knobs mapped to settings (MIDI learn), each with a way to forget it, and Write. */
const MidiMappings: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const write = useMidiLearn((m) => m.write);
  const mapped = tracks.flatMap((t) => (t.midiMap ?? []).map((m) => ({ track: t, ...m })));
  return (
    <div className="border-t border-forge-border pt-2 flex flex-col gap-1.5" aria-label="MIDI mappings">
      <span className="text-forge-text font-semibold">Knobs and faders (MIDI learn)</span>
      {mapped.length === 0 ? (
        <p className="text-[11px] leading-snug">
          Open a track's automation (its curve button), pick the setting in LANE, click MIDI beside it and move a knob: that knob then moves the setting.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {mapped.map(({ track, cc, param }) => (
            <li key={`${track.id}-${cc}`} className="flex items-center gap-2 text-[11px]">
              <span className="w-12 shrink-0 font-mono text-cyan-200">CC {cc}</span>
              <span className="flex-1 min-w-0 truncate text-forge-text">
                {track.name}: {specOf(param, track, tracks).label}
              </span>
              <button type="button" onClick={() => useTimelineStore.getState().unmapMidi(track.id, cc)} className="text-forge-muted hover:text-red-300" aria-label={`Forget CC ${cc}`} title="Forget this knob">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-forge-text" title="While the song plays, moving a mapped knob writes its setting's automation lane at the playhead">
        <input type="checkbox" className="accent-red-500 cursor-pointer" checked={write} onChange={(e) => useMidiLearn.getState().setWrite(e.target.checked)} />
        Write automation from knobs while playing
      </label>
    </div>
  );
};

/** MPE: an MPE keyboard plays each note on its own channel, whose bend and pressure move only that note (and are recorded into it). */
const MpeToggle: React.FC = () => {
  const mpe = useMidiStore((m) => m.mpe);
  return (
    <label className="flex items-center gap-2 text-forge-text" title="For MPE keyboards (each note on its own channel): a note's own bend and pressure move only that note, and are recorded into it (draw them under the piano roll: N.bend, N.press)">
      <input type="checkbox" className="accent-cyan-400 cursor-pointer" checked={mpe} onChange={(e) => useMidiStore.getState().setMpe(e.target.checked)} />
      MPE keyboard (per-note bend and pressure)
    </label>
  );
};
