/**
 * Pocket's Sound tool for a Fledge Synth track (the app's own synth): its presets by category
 * (with Hear it: a phrase of the sound on the track, see fledgePreview.ts),
 * the preset's macros as big sliders under their plain names (Growl, Grit, Squelch...), the
 * wobble's rate in time with the song (1/1 to 1/32, triplets too) when the sound has one, and the
 * sound as a file to send (Share this sound, Open a sound file). Every move is an undo step, as
 * a turn of the studio panel's knobs is (pluginEdits.ts). Other instruments are a tap away.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Play, Share2, Square } from 'lucide-react';
import type { BuiltinControls, BuiltinParam } from '../audio/plugins/builtinHost';
import { choiceValue, FLEDGE_SYNC, lfoControls } from '../audio/plugins/fledgeLayout';
import { macroLabel, macroTargets, WOBBLE_DIVISIONS, wobbleOf } from '../audio/plugins/fledgeMacros';
import { liveWam, subscribeWam, wamVersion } from '../audio/wamHost';
import { initAudio } from '../audio/engine';
import { editPluginParam, editPluginProgram } from '../store/pluginEdits';
import { choosePresetHeard, fledgePreviewState, hearOnChange, setHearOnChange, subscribeFledgePreview, toggleHearPreset } from '../audio/fledgePreview';
import type { Track } from '../store/timelineTypes';
import { pickSoundFile, shareTrackSound } from '../components/mySoundsFile';
import { pill, pillOn, TouchRange } from './pocketUi';
import { onBack } from '../native/backButton';

/** "Bass/Wobble" → groups of [category, [{ name, i }]], each category once (where it first comes in the engine's order). */
function grouped(programs: string[]): Array<[string, Array<{ name: string; i: number }>]> {
  const groups = new Map<string, Array<{ name: string; i: number }>>();
  programs.forEach((p, i) => {
    const cut = p.indexOf('/');
    const [group, name] = cut < 0 ? ['', p] : [p.slice(0, cut), p.slice(cut + 1)];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ name, i });
  });
  return [...groups];
}

const NO_PARAMS: BuiltinParam[] = [];

const Controls: React.FC<{ controls: BuiltinControls; pluginId: string; trackId: string; color: string }> = ({ controls, pluginId, trackId, color }) => {
  const params = useSyncExternalStore(controls.subscribe, controls.params, () => NO_PARAMS);
  const preview = useSyncExternalStore(subscribeFledgePreview, fledgePreviewState);
  const [autoHear, setAutoHear] = useState(hearOnChange);
  const [mute, setMute] = useState(false);
  const names = params.map((p) => p.name).join('\n');
  const index = useMemo(() => new Map(names.split('\n').map((n, i) => [n, i])), [names]);
  const val = (name: string) => params[index.get(name) ?? -1]?.value ?? 0;
  const put = (name: string, v: number) => {
    const i = index.get(name);
    if (i !== undefined) editPluginParam(controls, i, v, pluginId);
  };
  const program = controls.program();
  const preset = controls.programs[program];
  /** Choose preset `i` (the one playing stops; "Hear on change" plays the new one) */
  const choose = (i: number) => choosePresetHeard(trackId, controls.programs[i], editPluginProgram(controls, i, pluginId));
  const step = (d: number) => {
    const n = controls.programs.length;
    if (n) choose(((program < 0 ? (d > 0 ? -1 : 0) : program) + d + n) % n);
  };
  const hearing = preview?.kind === 'track' && preview.trackId === trackId;
  if (!index.has('Macro 1')) return <p className="text-sm text-forge-muted">Starting the synth…</p>;

  const macros = [1, 2, 3, 4].map((k) => ({ k, targets: macroTargets(val, k) })).filter((m) => m.targets.length);
  const wobble = wobbleOf(val);
  const division = wobble && lfoControls(wobble.lfo).division;
  const divisions = wobble && !WOBBLE_DIVISIONS.some((d) => d.index === wobble.division) ? [...WOBBLE_DIVISIONS, { index: wobble.division, label: FLEDGE_SYNC[wobble.division] }].sort((a, b) => a.index - b.index) : WOBBLE_DIVISIONS;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Previous preset" className={`${pill} !px-3`} onClick={() => step(-1)}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <select aria-label="Preset" className="flex-1 min-w-0 h-11 rounded-xl border border-forge-border bg-forge-panel px-2 text-sm font-semibold" value={program} onChange={(e) => choose(Number(e.target.value))}>
          {program < 0 && <option value={-1}>(your own sound)</option>}
          {grouped(controls.programs).map(([group, list]) =>
            group ? (
              <optgroup key={group} label={group}>
                {list.map(({ name, i }) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ) : (
              list.map(({ name, i }) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))
            )
          )}
        </select>
        <button type="button" aria-label="Next preset" className={`${pill} !px-3`} onClick={() => step(1)}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={hearing}
          className={`${pill} flex-1 ${hearing ? pillOn : ''}`}
          onClick={() => void toggleHearPreset(trackId, preset).then((ok) => setMute(!ok))}
        >
          {hearing ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4" />} {hearing ? 'Stop' : 'Hear it'}
        </button>
        <label className="flex items-center gap-2 text-xs text-forge-muted">
          <input
            type="checkbox"
            className="w-5 h-5"
            checked={autoHear}
            onChange={(e) => {
              setAutoHear(e.target.checked);
              setHearOnChange(e.target.checked);
            }}
          />
          Hear on change
        </label>
      </div>
      {mute && <p className="text-xs text-forge-muted">This track can't sound now: unmute it first.</p>}
      {macros.length === 0 && <p className="text-xs text-forge-muted">This sound has no macros: pick a Bass or Lead preset for sliders that shape it.</p>}
      {macros.map(({ k, targets }) => {
        const label = macroLabel(preset, k, targets);
        const v = val(`Macro ${k}`);
        return (
          <label key={k} className="flex flex-col gap-1">
            <span className="flex items-baseline gap-2 text-sm">
              <span className="font-semibold">{label}</span>
              <span className="text-[11px] text-forge-muted truncate flex-1">{targets.join(', ')}</span>
              <span className="font-mono text-xs tabular-nums">{Math.round(v * 100)}%</span>
            </span>
            <TouchRange label={label} min={0} max={1} step={0.005} value={v} onChange={(x) => put(`Macro ${k}`, x)} className="w-full h-11" style={{ accentColor: color }} />
          </label>
        );
      })}
      {wobble && division && division.kind === 'choice' && (
        <div>
          <p className="text-sm font-semibold mb-1.5">
            {wobble.label} <span className="text-[11px] font-normal text-forge-muted">in time with the song</span>
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={wobble.label}>
            {divisions.map((d) => (
              <button
                key={d.index}
                type="button"
                aria-pressed={d.index === wobble.division}
                className={`h-11 min-w-[52px] px-2 rounded-xl border border-forge-border bg-forge-panel font-mono text-[13px] ${d.index === wobble.division ? pillOn : ''}`}
                onClick={() => put(division.p, choiceValue(d.index, division.cap))}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** The Sound tool of a Fledge Synth track; `others` shows the list of other instruments. */
export const PocketSynth: React.FC<{ track: Track; others: React.ReactNode }> = ({ track, others }) => {
  useSyncExternalStore(subscribeWam, wamVersion);
  const [list, setList] = useState(false);
  const [starting, setStarting] = useState(false);
  // (The phone's Back goes back to the synth from the list)
  useEffect(() => {
    if (!list) return;
    return onBack(() => {
      setList(false);
      return true;
    });
  }, [list]);
  const pluginId = track.plugin?.id ?? '';
  const controls = liveWam(pluginId)?.controls;
  if (list)
    return (
      <div className="pk-scroll">
        <button type="button" className={`${pill} w-full mb-2`} onClick={() => setList(false)}>
          <ChevronLeft className="w-4 h-4" /> Back to Fledge Synth
        </button>
        {others}
      </div>
    );
  return (
    <div className="pk-scroll flex flex-col gap-3">
      {controls ? (
        <Controls controls={controls} pluginId={pluginId} trackId={track.id} color={track.color} />
      ) : track.frozen ? (
        <p className="text-sm text-forge-muted">This track is frozen (it plays its recording): unfreeze it on a computer to change its sound.</p>
      ) : (
        <button
          type="button"
          className={`${pill} w-full`}
          disabled={starting}
          onClick={() => {
            setStarting(true);
            void initAudio().finally(() => setStarting(false));
          }}
        >
          {starting ? 'Starting the synth…' : 'Start the sound to shape it'}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={pill} onClick={() => void shareTrackSound(track.id)}>
          <Share2 className="w-4 h-4" /> Share this sound
        </button>
        <button type="button" className={pill} onClick={() => pickSoundFile(track.id)}>
          <FolderOpen className="w-4 h-4" /> Open a sound file
        </button>
      </div>
      <button type="button" className={`${pill} w-full`} onClick={() => setList(true)}>
        Another instrument…
      </button>
    </div>
  );
};
