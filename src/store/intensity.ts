import type { Track } from './timelineTypes';

/**
 * Intensity: one number, 0 to 1, that a game turns up as things get exciting. Tracks belong to
 * stem groups (Ambient, Percussion, Tension, Climax, or any name), and each group has a curve:
 * how loud its tracks play (0 to 1) at each intensity. Turning the intensity up crossfades the
 * groups in and out along their curves, the way an adaptive music system mixes layers. Tracks
 * without a group always play at full level. No audio or store here, so Node can unit-test it.
 */

/** A curve: [intensity, level] points, both 0 to 1, in intensity order. */
export type IntensityCurve = Array<[number, number]>;

export const STEM_GROUP_PRESETS = ['Ambient', 'Percussion', 'Tension', 'Climax'] as const;

/** Where a new group's curve starts: each preset comes in at its own point; any other name fades in through the middle. */
export function defaultCurve(group: string): IntensityCurve {
  switch (group.toLowerCase()) {
    case 'ambient':
      return [[0, 1], [0.7, 1], [1, 0.6]];
    case 'percussion':
      return [[0, 0], [0.2, 0], [0.45, 1], [1, 1]];
    case 'tension':
      return [[0, 0], [0.4, 0], [0.7, 1], [1, 1]];
    case 'climax':
      return [[0, 0], [0.75, 0], [1, 1]];
    default:
      return [[0, 0], [0.5, 1], [1, 1]];
  }
}

/** The level a curve gives at intensity `x` (straight lines between its points). */
export function curveLevel(curve: IntensityCurve, x: number): number {
  if (!curve.length) return 1;
  const t = Math.max(0, Math.min(1, x));
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (t <= x1) {
      const [x0, y0] = curve[i - 1];
      return x1 - x0 < 1e-9 ? y1 : y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1][1];
}

/** A track's level at intensity `x`: its group's curve, or full level without a group. */
export function trackIntensityLevel(track: Pick<Track, 'stemGroup'> & { instrumentKey?: Track['instrumentKey'] }, curves: Record<string, IntensityCurve>, x: number): number {
  // A bus isn't a stem of its own (its tracks' stems carry its sound), so it follows no curve
  if (!track.stemGroup || track.instrumentKey === 'bus' || track.instrumentKey === 'return') return 1;
  return curveLevel(curves[track.stemGroup] ?? defaultCurve(track.stemGroup), x);
}

/** Tidy a curve: points clamped to 0..1, sorted by intensity, at least one. */
export function normalizeCurve(raw: unknown): IntensityCurve | null {
  if (!Array.isArray(raw)) return null;
  const points = raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  return points.length ? points : null;
}

/** Curves from a project file, by group name. */
export function parseCurves(raw: unknown): Record<string, IntensityCurve> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, IntensityCurve> = {};
  for (const [group, curve] of Object.entries(raw)) {
    const c = normalizeCurve(curve);
    if (c && group.trim()) out[group.slice(0, 40)] = c;
  }
  return out;
}

/** The stem groups the tracks use, in track order. */
export const groupsInUse = (tracks: ReadonlyArray<Pick<Track, 'stemGroup'>>): string[] => [...new Set(tracks.map((t) => t.stemGroup).filter((g): g is string => !!g))];
