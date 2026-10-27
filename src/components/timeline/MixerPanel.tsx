import { GLUE_BUS_STYLES, GLUE_BUS_STYLE_IDS } from '../../store/glueMix';
import type { GlueBusStyle } from '../../store/timelineTypes';
import { showToast } from './toastStore';
import React, { useEffect, useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { useAudioStore } from '../../store/audioStore';
import type { Track } from '../../store/timelineTypes';
import { REVERB_SEND_KNOB_MAX, REVERB_SEND_MAX } from '../../store/timelineTypes';
import { liveTrackPeak } from '../../audio/liveTracks';
import { isOffscreen, useSkipOffscreen } from '../offscreen';
import { UndoableRange } from '../UndoableRange';
import { busTargets, isBus, isReturn, sendTargets } from '../../store/buses';
import { SpectrumView } from './SpectrumView';
import { onFrame } from '../frameTicker';
import { useMixStudio } from '../../audio/mixStudio';
import { DUCK_STYLE_SETTINGS, DUCK_STYLES, duckStyleFor, type DuckStyle } from '../../store/duckToKick';

/**
 * Every track side by side as a mixing-desk strip: a level meter, a fader, pan, the reverb and
 * delay sends, mute and solo, and which inserts are on. The same settings as the track headers and
 * the Inspector, so a change here is a change there (and one undo step per drag).
 */

const vertical: React.CSSProperties = { writingMode: 'vertical-lr', direction: 'rtl' };
const db = (v: number) => (v <= -60 ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

/**
 * A meter that reads the live peaks itself, 30 times a second on the shared frame loop, without
 * re-rendering the dialog; the page is only touched when the bar has moved.
 */
const Meter: React.FC<{ trackId: string | null }> = ({ trackId }) => {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let held = 0;
    let shown = '';
    return onFrame(() => {
      // A strip scrolled out of sight isn't drawn: its meter needn't be read
      if (isOffscreen(bar.current)) return;
      // Its own analyser only: reading every track's for every meter was N² work a frame
      const p = trackId ? liveTrackPeak(trackId) : 0;
      // Falls back at about 20 dB a second
      held = Math.max(p, held * 0.85);
      const dbfs = held > 0 ? 20 * Math.log10(held) : -90;
      const h = Math.round(Math.max(0, Math.min(1, (dbfs + 60) / 60)) * 200) / 2;
      const color = dbfs > -1 ? '#ef4444' : dbfs > -9 ? '#f59e0b' : '#22c55e';
      const look = `${h}${color}`;
      if (bar.current && look !== shown) {
        shown = look;
        // Scaled on a layer of its own, not resized: a height change repaints the page's main
        // layer, a transform only moves pixels the compositor already has
        bar.current.style.transform = `scaleY(${h / 100})`;
        bar.current.style.background = color;
      }
    });
  }, [trackId]);
  return (
    <div className="relative w-2 h-36 rounded-sm bg-black/60 overflow-hidden" aria-hidden>
      <div ref={bar} className="absolute inset-0 origin-bottom" style={{ transform: 'scaleY(0)', willChange: 'transform' }} />
    </div>
  );
};

const Strip: React.FC<{ track: Track; tracks: Track[] }> = ({ track, tracks }) => {
  const s = useTimelineStore.getState();
  const bus = isBus(track);
  const ret = isReturn(track);
  const targets = busTargets(track, tracks);
  const returns = sendTargets(track, tracks);
  const selected = useTimelineStore((st) => st.selectedTrackId === track.id);
  const inserts = (['human', 'distortion', 'bassDrive', 'peq', 'compressor', 'mbc', 'chorus', 'lofi', 'filter', 'echo', 'reverb', 'gate', 'pump'] as const).filter((k) => track.fx[k]?.on);
  const root = useRef<HTMLDivElement>(null);
  useSkipOffscreen(root);
  return (
    <div ref={root} className={`flex flex-col items-center gap-2 w-24 shrink-0 rounded-lg border p-2 ${bus ? 'bg-slate-500/10' : ret ? 'bg-sky-500/10' : 'bg-forge-bg'} ${selected ? 'border-cyan-500/70' : 'border-forge-border'}`} aria-label={`${track.name} ${bus ? 'bus' : ret ? 'return' : 'channel'}`}>
      <div className="w-full h-1 rounded" style={{ background: track.color }} />
      <button
        type="button"
        onClick={() => {
          s.selectTrack(track.id);
          s.toggleInspector(true);
        }}
        className="w-full truncate text-[11px] font-semibold text-forge-text hover:text-cyan-300"
        title={`${track.name}: open in the Inspector`}
      >
        {track.name}
      </button>
      <div className="min-h-[28px] flex flex-wrap justify-center gap-0.5">
        {bus && <span className="px-1 rounded bg-slate-400/25 text-[8px] font-mono uppercase text-slate-100" title="A bus: tracks routed here play through its strip">bus</span>}
        {ret && <span className="px-1 rounded bg-sky-400/25 text-[8px] font-mono uppercase text-sky-100" title="A return: tracks send to it, it plays its effects back">return</span>}
        {track.duckProxy && <span className="px-1 rounded bg-sky-500/20 text-[8px] font-mono uppercase text-sky-200" title="The other tracks duck under this one">proxy</span>}
        {/* The effects: a click opens them in the Inspector (where they're switched on and set) */}
        <button
          type="button"
          onClick={() => {
            const s = useTimelineStore.getState();
            s.selectTrack(track.id);
            s.toggleInspector(true);
            useUiStore.getState().setInspectorTab('track');
          }}
          title={inserts.length ? `Effects: ${inserts.join(', ')}. Click to change them in the Inspector` : 'Add effects to this track (in the Inspector)'}
          className="flex flex-wrap justify-center gap-0.5 rounded hover:bg-white/5"
        >
          {inserts.length ? inserts.map((k) => (
            <span key={k} className="px-1 rounded bg-cyan-500/15 text-[8px] font-mono uppercase text-cyan-200">{k.slice(0, 4)}</span>
          )) : <span className="px-1 text-[9px] font-mono text-forge-muted hover:text-cyan-200">+ Effects</span>}
        </button>
      </div>
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        REV {Math.round(track.reverbSend * 100)}%
        <UndoableRange min={0} max={track.reverbSend > REVERB_SEND_KNOB_MAX ? REVERB_SEND_MAX : REVERB_SEND_KNOB_MAX} step={0.01} value={track.reverbSend} onValue={(v) => s.setTrackReverbSend(track.id, v)} resetValue={0} className="w-full h-1 accent-cyan-400" aria-label={`${track.name} reverb send`} />
      </label>
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        DLY {Math.round(track.delaySend * 100)}%
        <UndoableRange min={0} max={1} step={0.01} value={track.delaySend} onValue={(v) => s.setTrackDelaySend(track.id, v)} resetValue={0} className="w-full h-1 accent-violet-400" aria-label={`${track.name} delay send`} />
      </label>
      {returns.map((r) => {
        const send = track.sends?.find((x) => x.to === r.id);
        return (
          <label key={r.id} className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted" title={`Send to the return ${r.name}${send?.pre ? ' (before the fader)' : ''}`}>
            <span className="flex items-center justify-between gap-1">
              <span className="truncate" style={{ color: r.color }}>→ {r.name}</span>
              <span>{send ? `${Math.round(send.level * 100)}%${send.pre ? ' pre' : ''}` : 'off'}</span>
            </span>
            <UndoableRange
              min={0}
              max={1}
              step={0.01}
              value={send?.level ?? 0}
              onValue={(v) => s.setTrackSend(track.id, r.id, v, false)}
              resetValue={0}
              className="w-full h-1 accent-sky-400"
              aria-label={`${track.name} send to ${r.name}`}
            />
          </label>
        );
      })}
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        PAN {track.pan === 0 ? 'C' : `${track.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan) * 100)}`}
        <UndoableRange min={-1} max={1} step={0.01} value={track.pan} onValue={(v) => s.setTrackPan(track.id, v)} resetValue={0} className="w-full h-1 accent-amber-400" aria-label={`${track.name} pan`} />
      </label>
      <div className="flex items-end gap-2">
        <Meter trackId={track.id} />
        <UndoableRange
          min={-60}
          max={6}
          step={0.5}
          value={track.volume}
          onValue={(v) => s.setTrackVolume(track.id, v)}
          resetValue={0}
          className="h-36 w-4 cursor-pointer"
          style={{ ...vertical, accentColor: track.color }}
          aria-label={`${track.name} volume`}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-forge-text">{db(track.volume)} dB</span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={track.isMuted}
          onClick={() => s.toggleMute(track.id)}
          className={`w-7 h-6 rounded text-[10px] font-bold border ${track.isMuted ? 'bg-amber-500/30 border-amber-400 text-amber-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
          title="Mute"
        >
          M
        </button>
        <button
          type="button"
          aria-pressed={track.isSoloed}
          onClick={() => s.toggleSolo(track.id)}
          className={`w-7 h-6 rounded text-[10px] font-bold border ${track.isSoloed ? 'bg-emerald-500/30 border-emerald-400 text-emerald-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
          title="Solo"
        >
          S
        </button>
      </div>
      <select
        value={track.output ?? ''}
        onChange={(e) => s.setTrackOutput(track.id, e.target.value || null)}
        className="w-full h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] font-mono text-forge-text"
        aria-label={`${track.name} output`}
        title="Where this channel plays: the master, or a bus"
      >
        <option value="">→ Master</option>
        {targets.map((b) => (
          <option key={b.id} value={b.id}>
            → {b.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export const MixerPanel: React.FC = () => {
  const tracks = useTimelineStore((st) => st.tracks);
  const glued = useTimelineStore((st) => !!st.master.glueMix);
  const gluedStyle = useTimelineStore((st) => st.master.glueMix?.style ?? 'bass');
  const [pickedStyle, setGlueStyle] = React.useState<GlueBusStyle>('bass');
  const glueStyle = glued ? gluedStyle : pickedStyle;
  const masterVolume = useAudioStore((st) => st.masterVolume);
  return (
    <div className="flex flex-col gap-2 p-3 text-xs text-forge-muted" role="region" aria-label="Mixer">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tracks.map((t) => (
          <Strip key={t.id} track={t} tracks={tracks} />
        ))}
        <div className="flex flex-col items-center gap-2 w-24 shrink-0 rounded-lg border border-cyan-500/50 bg-cyan-950/20 p-2" aria-label="Master channel">
          <div className="w-full h-1 rounded bg-cyan-400" />
          <span className="text-[11px] font-bold text-cyan-200" title="The listening volume: how loud you hear it. It never changes an export.">LISTEN</span>
          <div className="flex-1" />
          <UndoableRange
            min={-40}
            max={6}
            step={0.5}
            value={masterVolume}
            onValue={(v) => useAudioStore.getState().setMasterVolume(v)}
            resetValue={0}
            undoable={false}
            className="h-36 w-4 cursor-pointer accent-cyan-400"
            style={vertical}
            aria-label="Listening volume"
          />
          <span className="text-[10px] font-mono tabular-nums text-forge-text">{db(masterVolume)} dB</span>
        </div>
        <SpectrumView className="w-[28rem] shrink-0 rounded-lg border border-cyan-500/30 bg-forge-bg/50 p-2" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const made = useTimelineStore.getState().makeSpace();
            showToast(made ? `Made space on ${made} track${made === 1 ? '' : 's'}: low cuts under each part, and room for the bass and the lead. Undo to take it back.` : 'Nothing to make space for: the parts don\u2019t overlap, or their EQs are already set.');
          }}
          className="px-2 py-1 rounded border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/15 text-[11px]"
          title="Small EQ moves so the parts stop covering each other: each part loses the rumble under its lowest note, and parts in the lead's range give way to it"
        >
          Make space
        </button>
        <span className="text-[11px]">EQ moves that stop the parts covering each other (one undo step).</span>
      </div>
      <div className="flex items-center gap-2" data-search="glue">
        <button
          type="button"
          role="switch"
          aria-checked={glued}
          onClick={() => {
            const s = useTimelineStore.getState();
            if (glued) {
              s.setGlueMix(false);
              showToast('Glue off: what it changed is back as it was (anything you changed since stays).');
            } else {
              const made = s.setGlueMix(true, glueStyle);
              showToast(made ? `Glue on: ${made} change${made === 1 ? '' : 's'} so the parts sound like one song. Switch it off any time to compare.` : 'Glue on, but there was nothing to change: the mix is already tied together.');
            }
          }}
          className={`px-2 py-1 rounded border text-[11px] ${glued ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200' : 'border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/15'}`}
          title="Ties the parts into one mix: room for each part, a drum bus and a music bus with gentle glue, the bass ducking under the kick, one shared room, and the parts spread a little apart. Switch it off to put it all back."
        >
          Glue {glued ? 'on' : 'off'}
        </button>
        <select
          className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text"
          value={glueStyle}
          disabled={glued}
          onChange={(e) => setGlueStyle(e.target.value as GlueBusStyle)}
          aria-label="Glue style"
          title={glued ? 'Switch Glue off to change its style' : GLUE_BUS_STYLES[glueStyle].about}
        >
          {GLUE_BUS_STYLE_IDS.map((id) => (
            <option key={id} value={id}>{GLUE_BUS_STYLES[id].label}</option>
          ))}
        </select>
        <span className="text-[11px]">Makes the parts sound like one song instead of instruments side by side, at the same loudness. Switch it off any time to compare.</span>
      </div>
      <DuckToKickRow />
      <p className="text-[11px]">Double-click a fader or knob to reset it. Each drag is one undo step. Click a track's name to open it in the Inspector (inserts, EQ, automation).</p>
    </div>
  );
};

/** Duck to kick, in a chosen style (it starts on the one the "Does it hit?" check is set to). */
const DuckToKickRow: React.FC = () => {
  const hitStyle = useMixStudio((s) => s.hitStyle);
  const [style, setStyle] = React.useState<DuckStyle | null>(null);
  const chosen = style ?? duckStyleFor(hitStyle);
  return (
    <div className="flex items-center gap-2 flex-wrap" data-search="duck kick">
      <button
        type="button"
        onClick={() => {
          const made = useTimelineStore.getState().duckToKick(chosen);
          showToast(made < 0 ? 'No kick to duck to: add a drum track first.' : made ? `Ducked ${made} track${made === 1 ? '' : 's'}: the bass makes a hole for each kick and snare, the chords, pads and leads pump on the kick. Undo to take it back.` : 'Everything already ducks this way.');
        }}
        className="px-2 py-1 rounded border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/15 text-[11px]"
        title="Puts a Pump on the bass, chords, pads and leads: the bass dips out of the way of every kick and snare, the rest pump on the kick and swell back in time with the tempo"
      >
        Duck to kick
      </button>
      <select
        value={chosen}
        onChange={(e) => setStyle(e.target.value as DuckStyle)}
        aria-label="Duck to kick style"
        className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px]"
        title={DUCK_STYLE_SETTINGS[chosen].about}
      >
        {DUCK_STYLES.map((id) => (
          <option key={id} value={id}>
            {DUCK_STYLE_SETTINGS[id].label}
          </option>
        ))}
      </select>
      <span className="text-[11px]">{DUCK_STYLE_SETTINGS[chosen].about} One undo step.</span>
    </div>
  );
};
