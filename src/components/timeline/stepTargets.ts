/**
 * What a track's step lanes can move (store/stepLanes.ts), named for the menus of the studio's
 * piano roll (StepLanes.tsx) and Pocket's roll: a Fledge Synth's macros by what they do ("Growl",
 * "Grit"), the instrument plugin's other parameters by name, and the track's own settings
 * (Filter cutoff and resonance, volume, pan, EQ, the inserts' settings).
 */
import { useSyncExternalStore } from 'react';
import { AUTOMATION_PARAMS, FX_AUTOMATION_KEYS, type AutomationParam, type Clip, type StepTarget, type Track } from '../../store/timelineTypes';
import { specOf } from '../../audio/automation';
import { liveWam, subscribeWam, wamVersion } from '../../audio/wamHost';
import { isFledgeUrl, macroLabel, macroTargets } from '../../audio/plugins/fledgeMacros';
import type { BuiltinParam } from '../../audio/plugins/builtinHost';
import { instParamName, instTarget } from '../../store/stepLanes';

export const STEP_LANE_H = 40;
export const STEP_BAR_H = 26;
/** The height a clip's step lanes take under the piano roll's notes (`open`: shown though it has none). */
export const stepLanesHeight = (clip: Pick<Clip, 'stepLanes'>, open: boolean): number => (clip.stepLanes?.length || open ? STEP_BAR_H + (clip.stepLanes?.length ?? 0) * STEP_LANE_H : 0);

/** For each step, the value it holds from the steps before it (null: none yet). */
export function heldBefore(values: ReadonlyArray<number | null>): Array<number | null> {
  const out: Array<number | null> = [];
  let held: number | null = null;
  for (const v of values) {
    out.push(held);
    if (v !== null) held = v;
  }
  return out;
}

export interface StepTargetOption {
  target: StepTarget;
  label: string;
  group: string;
}

const NO_PARAMS: BuiltinParam[] = [];

/** The live instrument plugin's parameters (names and values), following its changes. */
export function useInstrumentParams(track: Pick<Track, 'plugin'> | undefined): BuiltinParam[] {
  const id = track?.plugin?.id;
  useSyncExternalStore(subscribeWam, wamVersion);
  const controls = id ? liveWam(id)?.controls : undefined;
  return useSyncExternalStore(controls?.subscribe ?? noSubscribe, controls?.params ?? noParams, noParams);
}
const noSubscribe = () => () => {};
const noParams = () => NO_PARAMS;

/** Fledge Synth's macros that move something, named as its panel names them (all four if it hasn't started yet). */
export function fledgeMacros(track: Pick<Track, 'plugin'> | undefined, params: BuiltinParam[]): Array<{ k: number; label: string; moves: string[] }> {
  const controls = track?.plugin ? liveWam(track.plugin.id)?.controls : undefined;
  const index = new Map(params.map((p, i) => [p.name, i]));
  if (!index.has('Macro 1')) return [1, 2, 3, 4].map((k) => ({ k, label: `Macro ${k}`, moves: [] }));
  const val = (name: string) => params[index.get(name) ?? -1]?.value ?? 0;
  const preset = controls ? controls.programs[controls.program()] : undefined;
  return [1, 2, 3, 4].map((k) => {
    const moves = macroTargets(val, k);
    return { k, label: macroLabel(preset, k, moves), moves };
  });
}

/** The track settings a step lane can move (sends aside: a lane on a clip shouldn't name another track). */
const TRACK_TARGETS: StepTarget[] = [
  'filterCutoff',
  'filterResonance',
  ...FX_AUTOMATION_KEYS.filter((k) => !k.startsWith('compressor.') && !k.startsWith('pump.')).map((k) => `fx:${k}` as StepTarget),
  ...AUTOMATION_PARAMS.filter((p) => p !== 'filterCutoff' && p !== 'filterResonance'),
];

/** Every target a step lane on `track` can have, for a menu (`params`: useInstrumentParams). */
export function stepTargetOptions(track: Track | undefined, params: BuiltinParam[]): StepTargetOption[] {
  const out: StepTargetOption[] = [];
  if (track?.plugin) {
    const fledge = isFledgeUrl(track.plugin.url);
    if (fledge) for (const m of fledgeMacros(track, params)) out.push({ target: instTarget(`Macro ${m.k}`), label: m.label === `Macro ${m.k}` ? m.label : `${m.label} (macro ${m.k})`, group: 'Macros' });
    for (const p of params) {
      if (fledge && /^Macro [1-4]$/.test(p.name)) continue;
      out.push({ target: instTarget(p.name), label: p.name, group: track.plugin.name });
    }
  }
  for (const t of TRACK_TARGETS) out.push({ target: t, label: specOf(t as AutomationParam).label, group: 'Track' });
  return out;
}

/** A target's name, as the menus give it. */
export function stepTargetLabel(target: StepTarget, options: StepTargetOption[]): string {
  return options.find((o) => o.target === target)?.label ?? instParamName(target) ?? specOf(target as AutomationParam).label;
}

/** A lane value as the setting shows it ("1.2 kHz", "-6.0 dB"; a plugin's parameter as a share of its range). */
export function formatStepValue(target: StepTarget, v: number): string {
  if (target.startsWith('inst:')) return `${Math.round(v * 100)}%`;
  const spec = specOf(target as AutomationParam);
  return spec.format(spec.toReal(v));
}

/** The lane a new step lane on `track` starts with: its first macro that moves something, else the Filter's cutoff. */
export function defaultStepTarget(track: Track | undefined, params: BuiltinParam[], taken: ReadonlySet<StepTarget>): StepTarget {
  const options = stepTargetOptions(track, params);
  const macros = track?.plugin && isFledgeUrl(track.plugin.url) ? fledgeMacros(track, params) : [];
  const moving = macros.filter((m) => m.moves.length).map((m) => instTarget(`Macro ${m.k}`));
  const pick = [...moving, ...options.map((o) => o.target)].find((t) => !taken.has(t));
  return pick ?? 'filterCutoff';
}
