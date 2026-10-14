import { uid } from './timelineTypes';

/**
 * Game parameters: named numbers, 0 to 1, that the game sets as things change ("danger" as an
 * enemy gets closer, "health", "depth" under water), each moving several things in the music at
 * once: the intensity, a low-pass filter, the reverb, the music's volume, a stem group's level.
 * The way FMOD and Wwise games drive their music, without the game knowing how it's mixed.
 *
 * A target acts over a window of its parameter (`from` to `to`): below the window it holds its
 * `start` value, above it its `end`, and in between it goes from one to the other (a filter
 * evenly in pitch, the rest in a straight line). When several parameters move the same thing, the
 * one asking for most wins: the highest intensity and reverb, the lowest filter; volumes and a
 * group's levels multiply.
 *
 * The game kit's players (web, Godot, Unity) do the same sums; keep them in step. No audio or
 * store here, so Node can unit-test it.
 */

export type ParamTargetKind = 'intensity' | 'filter' | 'reverb' | 'volume' | 'layer';

export interface ParamTarget {
  kind: ParamTargetKind;
  /** A 'layer' target's stem group */
  group?: string;
  /** The window of the parameter it acts over, 0 to 1 */
  from: number;
  to: number;
  /** Its value at and below `from`, and at and above `to` (Hz for a filter, else 0 to 1) */
  start: number;
  end: number;
}

export interface GameParam {
  id: string;
  /** Its name in the game: what setParameter() takes ("danger") */
  name: string;
  /** Where it starts in the game, and where the Game tab's slider has it */
  value: number;
  targets: ParamTarget[];
}

export const MAX_GAME_PARAMS = 8;
export const MAX_PARAM_TARGETS = 8;
export const OPEN_FILTER = 20000;
const MIN_FILTER = 60;

export const TARGET_SPECS: Record<ParamTargetKind, { name: string; detail: string; start: number; end: number }> = {
  intensity: { name: 'Intensity', detail: 'The stem groups fade in and out along their intensity curves', start: 0, end: 1 },
  filter: { name: 'Filter', detail: 'A low-pass on the music (Hz): lower is more muffled', start: OPEN_FILTER, end: 800 },
  reverb: { name: 'Reverb', detail: 'How much of the music goes to a room reverb', start: 0, end: 0.5 },
  volume: { name: 'Volume', detail: "The music's level", start: 1, end: 0.5 },
  layer: { name: 'Layer', detail: "One stem group's level, on top of its intensity curve", start: 0, end: 1 },
};

export const PARAM_KINDS = Object.keys(TARGET_SPECS) as ParamTargetKind[];

export type ParamPreset = 'danger' | 'health' | 'depth' | 'distance' | 'tension' | 'empty';
export const PARAM_PRESETS: ReadonlyArray<{ id: ParamPreset; name: string; detail: string }> = [
  { id: 'danger', name: 'danger', detail: 'Enemies near: the intensity rises and the music gets a little brighter' },
  { id: 'health', name: 'health', detail: '1 is full health: under half, the music muffles and dips as it runs out' },
  { id: 'depth', name: 'depth', detail: 'Under water: deeper is more muffled and roomy' },
  { id: 'distance', name: 'distance', detail: 'Far from where the music plays (a radio, a stage): quieter, duller, roomier' },
  { id: 'tension', name: 'tension', detail: 'The stem groups come in one after another as it rises' },
  { id: 'empty', name: 'parameter', detail: 'Nothing moved yet: add what it should change' },
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const target = (kind: ParamTargetKind, start: number, end: number, from = 0, to = 1, group?: string): ParamTarget => ({ kind, ...(group ? { group } : {}), from, to, start, end });

/** A parameter from a preset, for a song with these stem groups. */
export function paramFromPreset(preset: ParamPreset, groups: readonly string[], taken: readonly Pick<GameParam, 'name'>[] = []): GameParam {
  let targets: ParamTarget[] = [];
  let value = 0;
  if (preset === 'danger') targets = [target('intensity', 0.15, 1), target('filter', 7000, OPEN_FILTER, 0, 0.5)];
  else if (preset === 'health') {
    value = 1;
    targets = [target('filter', 1200, OPEN_FILTER, 0, 0.5), target('volume', 0.75, 1, 0, 0.5)];
  } else if (preset === 'depth') targets = [target('filter', OPEN_FILTER, 600), target('reverb', 0, 0.55)];
  else if (preset === 'distance') targets = [target('volume', 1, 0.3), target('filter', OPEN_FILTER, 2500), target('reverb', 0.05, 0.45)];
  else if (preset === 'tension') {
    // Each group (but the one that always plays) comes in over its own stretch
    const layers = groups.filter((g) => g.toLowerCase() !== 'main' && g.toLowerCase() !== 'ambient');
    if (!layers.length) targets = [target('intensity', 0, 1)];
    else targets = layers.slice(0, MAX_PARAM_TARGETS).map((g, i) => target('layer', 0, 1, round(i / layers.length), round((i + 1) / layers.length), g));
  }
  const name = PARAM_PRESETS.find((p) => p.id === preset)!.name;
  return { id: uid('param'), name: freeParamName(name, taken), value, targets };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** A name the game can use and no other parameter has: "danger", then "danger_2"... */
export function freeParamName(name: string, taken: readonly Pick<GameParam, 'name'>[]): string {
  const base =
    name
      .trim()
      .replace(/[^A-Za-z0-9_ -]+/g, '')
      .replace(/[\s-]+/g, '_')
      .slice(0, 32) || 'parameter';
  const names = new Set(taken.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** What a target asks for with its parameter at `x`. */
export function targetValue(t: ParamTarget, x: number): number {
  const v = clamp01(x);
  const lo = Math.min(t.from, t.to);
  const hi = Math.max(t.from, t.to);
  const f = hi - lo < 1e-6 ? (v >= hi ? 1 : 0) : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  if (t.kind === 'filter') {
    const a = Math.max(MIN_FILTER, t.start);
    const b = Math.max(MIN_FILTER, t.end);
    return a * Math.pow(b / a, f);
  }
  return t.start + (t.end - t.start) * f;
}

export interface ParamMix {
  /** The intensity the parameters ask for (null: none of them moves it) */
  intensity: number | null;
  /** The lowest filter asked for (Hz; OPEN_FILTER when none) */
  filter: number;
  /** The most reverb asked for (0 to 1) */
  reverb: number;
  /** The music's level (1: as it is) */
  volume: number;
  /** Each moved stem group's level, by group (1 when not listed) */
  layers: Record<string, number>;
}

/** Everything the parameters ask for together, each at its value. */
export function paramMix(params: ReadonlyArray<Pick<GameParam, 'targets'> & { value: number }>): ParamMix {
  const mix: ParamMix = { intensity: null, filter: OPEN_FILTER, reverb: 0, volume: 1, layers: {} };
  for (const p of params) {
    for (const t of p.targets) {
      const v = targetValue(t, p.value);
      if (t.kind === 'intensity') mix.intensity = Math.max(mix.intensity ?? 0, clamp01(v));
      else if (t.kind === 'filter') mix.filter = Math.min(mix.filter, Math.max(MIN_FILTER, Math.min(OPEN_FILTER, v)));
      else if (t.kind === 'reverb') mix.reverb = Math.max(mix.reverb, clamp01(v));
      else if (t.kind === 'volume') mix.volume *= clamp01(v);
      else if (t.kind === 'layer' && t.group) mix.layers[t.group] = (mix.layers[t.group] ?? 1) * clamp01(v);
    }
  }
  return mix;
}

/** A target with its numbers in range (a filter's in Hz, the rest 0 to 1). */
export function cleanTarget(t: ParamTarget): ParamTarget {
  const value = (x: number) => (t.kind === 'filter' ? Math.max(MIN_FILTER, Math.min(OPEN_FILTER, Math.round(x))) : clamp01(x));
  return target(t.kind, value(t.start), value(t.end), clamp01(t.from), clamp01(t.to), t.kind === 'layer' ? t.group || undefined : undefined);
}

/** Parameters from a project file, keeping the readable ones. */
export function parseGameParams(raw: unknown): GameParam[] {
  if (!Array.isArray(raw)) return [];
  const out: GameParam[] = [];
  for (const v of raw.slice(0, MAX_GAME_PARAMS)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    const targets: ParamTarget[] = [];
    for (const r of Array.isArray(o.targets) ? o.targets.slice(0, MAX_PARAM_TARGETS) : []) {
      if (!r || typeof r !== 'object') continue;
      const t = r as Record<string, unknown>;
      if (typeof t.kind !== 'string' || !(PARAM_KINDS as string[]).includes(t.kind)) continue;
      const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
      const kind = t.kind as ParamTargetKind;
      if (kind === 'layer' && typeof t.group !== 'string') continue;
      targets.push(cleanTarget({ kind, group: typeof t.group === 'string' ? t.group : undefined, from: num(t.from, 0), to: num(t.to, 1), start: num(t.start, TARGET_SPECS[kind].start), end: num(t.end, TARGET_SPECS[kind].end) }));
    }
    out.push({ id: typeof o.id === 'string' && o.id ? o.id : uid('param'), name: freeParamName(o.name, out), value: clamp01(typeof o.value === 'number' ? o.value : 0), targets });
  }
  return out;
}

/** A parameter as the game kit's manifest has it. */
export const manifestParam = (p: GameParam) => ({
  name: p.name,
  default: p.value,
  targets: p.targets.map((t) => ({ target: t.kind, ...(t.group ? { group: t.group } : {}), from: t.from, to: t.to, start: t.start, end: t.end })),
});
