/**
 * The Track Inspector's heavy bass panels: the 808 designer (an 808 Bass track's drive, punch,
 * slide, decay, top layer and tune-to-key, with presets), the kick clash check with its one-click
 * duck, legato Glide for monophonic synths, the Sub enhancer, and the Bass Drive insert. Sliders
 * are one undo step per drag (they checkpoint); switches and picks one step each.
 */
import React, { useMemo } from 'react';
import { Bomb, Drum, Speaker, Spline, TriangleAlert, Zap } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { FxSlider, InsertPanel } from './InsertFx';
import type { Bass808Settings } from '../../store/bass808';
import { BASS808_PRESETS, BASS808_TONE_MAX, BASS808_TONE_MIN, bass808Preset, defaultBass808 } from '../../store/bass808';
import type { BassDriveFx, SubLayer } from '../../store/bassTools';
import { BASS_DRIVE_CROSSOVER_MAX, BASS_DRIVE_CROSSOVER_MIN, BASS_DRIVE_TONE_MAX, BASS_DRIVE_TONE_MIN, defaultBassDrive, defaultSubLayer, GLIDE_KEYS, GLIDE_MAX } from '../../store/bassTools';
import { DRIVE_CHARACTER_LABELS, DRIVE_CHARACTERS, type DriveCharacter } from '../../audio/driveCurves';
import { ROOT_NAMES, SCALES, type ScaleId } from '../../store/noteTools';
import { detectKey } from '../../store/songKey';
import { findKickClash, KICK_DUCK } from '../../store/kickClash';
import { INSTRUMENTS } from '../../audio/instrumentCatalog';
import { isPitched } from '../../store/keyChange';

const select = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text focus:outline-none focus:border-red-500';
const toLog = (v: number, lo: number, hi: number) => Math.log(v / lo) / Math.log(hi / lo);
const fromLog = (x: number, lo: number, hi: number) => lo * (hi / lo) ** x;
const secs = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hz = (v: number) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const st = useTimelineStore.getState;

/** A slider over a range best felt in ratios (Hz, seconds): 0..1 on a log scale. */
export function LogSlider(props: { label: string; value: number; lo: number; hi: number; format: (v: number) => string; onChange: (v: number) => void; reset: number; accent: string; disabled?: boolean }) {
  const { label, value, lo, hi, format, onChange, reset, accent, disabled = false } = props;
  return (
    <FxSlider
      label={label}
      value={toLog(Math.max(lo, value), lo, hi)}
      min={0}
      max={1}
      step={0.001}
      format={(x) => format(fromLog(x, lo, hi))}
      onChange={(x) => onChange(+fromLog(x, lo, hi).toPrecision(4))}
      reset={toLog(reset, lo, hi)}
      accent={accent}
      disabled={disabled}
    />
  );
}

function CharacterPick({ value, onChange, disabled }: { value: DriveCharacter; onChange: (c: DriveCharacter) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-[10px] font-mono ${disabled ? 'opacity-45' : ''}`}>
      <span className="w-16 text-forge-muted uppercase">Character</span>
      <select className={`${select} flex-1`} value={value} disabled={disabled} aria-label="Distortion character" onChange={(e) => onChange(e.target.value as DriveCharacter)}>
        {DRIVE_CHARACTERS.map((c) => (
          <option key={c} value={c}>{DRIVE_CHARACTER_LABELS[c]}</option>
        ))}
      </select>
    </label>
  );
}

const ACCENT_808 = '#ef4444';

/** The key the 808 snaps to when tune-to-key is first switched on: the song's, from its other parts. */
function songScale(trackId: string): { root: number; scale: ScaleId } {
  const { clips, tracks } = st();
  const key = detectKey(clips, tracks.filter((t) => t.id !== trackId));
  return key ? { root: key.root, scale: key.mode } : { root: 0, scale: 'minor' };
}

/** The 808 designer: every setting of an 808 Bass track's sound (absent settings: the original 808). */
export const Bass808Panel: React.FC<{ track: Track }> = ({ track }) => {
  const on = !!track.bass808;
  const s = track.bass808 ?? defaultBass808();
  const d = defaultBass808();
  const set = (edit: Partial<Bass808Settings>, record = false) => st().setTrackBass(track.id, { bass808: { ...s, ...edit } }, record);
  const accent = ACCENT_808;
  const off = !on;
  return (
    <InsertPanel title="808 designer" icon={<Zap className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => st().setTrackBass(track.id, { bass808: on ? undefined : defaultBass808() }, false)} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${off ? 'opacity-70' : ''}`}>
        {on ? 'Shape the 808: from a clean sub to clipped and blown out. Overlapping notes slide.' : 'Off: the original 808. Switch on to shape its drive, punch, slides and tail.'}
      </p>
      <div className={`flex items-center gap-2 ${off ? 'opacity-45' : ''}`}>
        <select
          className={`${select} flex-1`}
          aria-label="808 preset"
          value=""
          disabled={off}
          onChange={(e) => e.target.value && st().setTrackBass(track.id, { bass808: { ...bass808Preset(e.target.value), ...(s.tuneToKey ? { tuneToKey: s.tuneToKey } : {}) } }, true)}
        >
          <option value="">Load preset…</option>
          {BASS808_PRESETS.map((p) => (
            <option key={p.name} value={p.name} title={p.blurb}>{p.name}</option>
          ))}
        </select>
      </div>
      <FxSlider label="Drive" value={s.drive} min={0} max={1} step={0.01} format={pct} onChange={(drive) => set({ drive })} reset={d.drive} accent={accent} disabled={off} />
      <CharacterPick value={s.character} onChange={(character) => set({ character }, true)} disabled={off || s.drive === 0} />
      <LogSlider label="Tone" value={s.tone} lo={BASS808_TONE_MIN} hi={BASS808_TONE_MAX} format={hz} onChange={(tone) => set({ tone })} reset={d.tone} accent={accent} disabled={off || s.drive === 0} />
      <FxSlider label="Top layer" value={s.top} min={0} max={1} step={0.01} format={pct} onChange={(top) => set({ top })} reset={d.top} accent={accent} disabled={off} />
      <FxSlider label="Punch" value={s.punch} min={0} max={36} step={1} format={(v) => `${Math.round(v)} st`} onChange={(punch) => set({ punch })} reset={d.punch} accent={accent} disabled={off} />
      <LogSlider label="Punch time" value={s.punchTime} lo={0.005} hi={0.3} format={secs} onChange={(punchTime) => set({ punchTime })} reset={d.punchTime} accent={accent} disabled={off || s.punch === 0} />
      <LogSlider label="Glide" value={s.glide} lo={0.01} hi={0.6} format={secs} onChange={(glide) => set({ glide })} reset={d.glide} accent={accent} disabled={off} />
      <LogSlider label="Decay" value={s.decay} lo={0.1} hi={8} format={secs} onChange={(decay) => set({ decay })} reset={d.decay} accent={accent} disabled={off} />
      <FxSlider label="Level" value={s.level} min={-12} max={6} step={0.5} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(level) => set({ level })} reset={d.level} accent={accent} disabled={off} />
      <div className={`flex flex-wrap items-center gap-2 text-[10px] font-mono ${off ? 'opacity-45' : ''}`}>
        <label className="flex items-center gap-1.5 cursor-pointer" title="Every note plays as the nearest note of the key (the notes in the clip don't change)">
          <input
            type="checkbox"
            className="accent-red-500"
            disabled={off}
            checked={!!s.tuneToKey}
            onChange={(e) => {
              const { tuneToKey: _was, ...rest } = s;
              st().setTrackBass(track.id, { bass808: e.target.checked ? { ...rest, tuneToKey: songScale(track.id) } : rest }, true);
            }}
          />
          <span className="text-forge-muted uppercase">Tune to key</span>
        </label>
        {s.tuneToKey && (
          <>
            <select className={select} aria-label="Key" value={s.tuneToKey.root} disabled={off} onChange={(e) => set({ tuneToKey: { ...s.tuneToKey!, root: Number(e.target.value) } }, true)}>
              {ROOT_NAMES.map((n, i) => (
                <option key={n} value={i}>{n}</option>
              ))}
            </select>
            <select className={select} aria-label="Scale" value={s.tuneToKey.scale} disabled={off} onChange={(e) => set({ tuneToKey: { ...s.tuneToKey!, scale: e.target.value as ScaleId } }, true)}>
              {(Object.keys(SCALES) as ScaleId[]).map((id) => (
                <option key={id} value={id}>{SCALES[id].name}</option>
              ))}
            </select>
          </>
        )}
      </div>
    </InsertPanel>
  );
};

/** For bass tracks: do the kicks land on the bass's low notes, and one click to duck it under them. */
export const KickClashPanel: React.FC<{ track: Track }> = ({ track }) => {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const clash = useMemo(() => findKickClash(tracks, clips, track.id), [tracks, clips, track.id]);
  if (!clash.kicks) return null;
  const accent = '#f59e0b';
  const clashing = clash.together > 0 && !clash.ducked;
  return (
    <div data-search="kick clash duck 808" className="flex flex-col gap-1.5 bg-forge-bg p-2.5 rounded-lg border shadow-md" style={{ borderColor: clashing ? `${accent}99` : undefined }}>
      <div className="flex items-center gap-1.5">
        {clashing ? <TriangleAlert className="w-3.5 h-3.5" style={{ color: accent }} /> : <Drum className="w-3.5 h-3.5 text-forge-muted" />}
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Kick and bass</span>
      </div>
      <p className="text-[10px] text-forge-muted leading-snug">
        {clash.ducked
          ? 'Ducking under the kick (the Pump below follows it): the kick punches through.'
          : clash.together
            ? `${clash.together} of ${clash.kicks} kicks land on a low note of this track: its low end hides the kick's punch.`
            : clash.under
              ? `${clash.under} of ${clash.kicks} kicks land while a low note of this track rings: a duck keeps them clear.`
              : 'No kick lands on a low note of this track.'}
      </p>
      {!clash.ducked && (clash.together > 0 || clash.under > 0) && (
        <button
          type="button"
          className="self-start px-2 py-0.5 rounded text-[10px] font-mono font-bold border text-black"
          style={{ backgroundColor: accent, borderColor: accent }}
          title="Turn on this track's Pump, following the kick: the bass dips for a moment at every kick and swells back"
          onClick={() => {
            st().checkpoint();
            st().setTrackFx(track.id, 'pump', KICK_DUCK);
          }}
        >
          Duck under the kick
        </button>
      )}
    </div>
  );
};

/** Legato glide on a monophonic synth: overlapping notes slide from one pitch to the next. */
export const GlidePanel: React.FC<{ track: Track }> = ({ track }) => {
  if (!GLIDE_KEYS.has(track.instrumentKey)) return null;
  const accent = '#a78bfa';
  const on = track.glide !== undefined;
  return (
    <InsertPanel title="Glide" icon={<Spline className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => st().setTrackBass(track.id, { glide: on ? undefined : 0.08 }, false)} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${on ? '' : 'opacity-70'}`}>
        {on ? 'Notes that overlap or touch slide into each other; leave a gap to hit a note again.' : "Off: the instrument's own slide."}
      </p>
      <LogSlider label="Time" value={Math.max(0.005, track.glide ?? 0.08)} lo={0.005} hi={GLIDE_MAX} format={secs} onChange={(glide) => st().setTrackBass(track.id, { glide }, false)} reset={0.08} accent={accent} disabled={!on} />
    </InsertPanel>
  );
};

/** Pitched tracks that get the Sub enhancer: basses, and the instruments a bass is often made on. */
const takesSubLayer = (track: Track): boolean => {
  const key = track.instrumentKey;
  return isPitched(key) && (INSTRUMENTS[key].category === 'Bass' || ['synthDesigner', 'sampler', 'multiSampler', 'plugin'].includes(key));
};

/** The Sub enhancer: a clean sine under the notes, mono. */
export const SubLayerPanel: React.FC<{ track: Track }> = ({ track }) => {
  if (!takesSubLayer(track)) return null;
  const accent = '#38bdf8';
  const on = !!track.subLayer;
  const s = track.subLayer ?? defaultSubLayer();
  const set = (edit: Partial<SubLayer>, record = false) => st().setTrackBass(track.id, { subLayer: { ...s, ...edit } }, record);
  return (
    <InsertPanel title="Sub enhancer" icon={<Speaker className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => st().setTrackBass(track.id, { subLayer: on ? undefined : defaultSubLayer() }, false)} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${on ? '' : 'opacity-70'}`}>A clean sine under every note, centred: weight for a thin bass.</p>
      <label className={`flex items-center gap-2 text-[10px] font-mono ${on ? '' : 'opacity-45'}`}>
        <span className="w-16 text-forge-muted uppercase">Where</span>
        <select className={`${select} flex-1`} aria-label="Sub enhancer pitch" value={s.mode} disabled={!on} onChange={(e) => set({ mode: e.target.value as SubLayer['mode'] }, true)}>
          <option value="octave">An octave below</option>
          <option value="fundamental">On the note (reinforce)</option>
        </select>
      </label>
      <FxSlider label="Level" value={s.level} min={0} max={1} step={0.01} format={pct} onChange={(level) => set({ level })} reset={defaultSubLayer().level} accent={accent} disabled={!on} />
      <FxSlider label="Decay" value={s.decay} min={0} max={8} step={0.05} format={(v) => (v === 0 ? 'Hold' : secs(v))} onChange={(decay) => set({ decay })} reset={0} accent={accent} disabled={!on} />
    </InsertPanel>
  );
};

/** The Bass Drive insert: distortion on the mids and highs, the sub kept clean and mono. */
export const BassDrivePanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = track.fx.bassDrive ?? defaultBassDrive();
  const d = defaultBassDrive();
  const set = (patch: Partial<BassDriveFx>) => st().setTrackFx(track.id, 'bassDrive', { ...fx, ...patch });
  const accent = '#dc2626';
  const off = !fx.on;
  return (
    <InsertPanel title="Bass Drive" icon={<Bomb className="w-3.5 h-3.5" style={{ color: accent }} />} on={fx.on} onToggle={() => set({ on: !fx.on })} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${off ? 'opacity-70' : ''}`}>Distorts only above the crossover: the sub stays clean and centred, the grit cuts through.</p>
      <LogSlider label="Crossover" value={fx.crossover} lo={BASS_DRIVE_CROSSOVER_MIN} hi={BASS_DRIVE_CROSSOVER_MAX} format={hz} onChange={(crossover) => set({ crossover })} reset={d.crossover} accent={accent} disabled={off} />
      <FxSlider label="Drive" value={fx.drive} min={0} max={1} step={0.01} format={pct} onChange={(drive) => set({ drive })} reset={d.drive} accent={accent} disabled={off} />
      <CharacterPick value={fx.character} onChange={(character) => {
        st().checkpoint();
        set({ character });
      }} disabled={off} />
      <LogSlider label="Tone" value={fx.tone} lo={BASS_DRIVE_TONE_MIN} hi={BASS_DRIVE_TONE_MAX} format={hz} onChange={(tone) => set({ tone })} reset={d.tone} accent={accent} disabled={off} />
      <FxSlider label="Mix" value={fx.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => set({ mix })} reset={d.mix} accent={accent} disabled={off} />
    </InsertPanel>
  );
};
