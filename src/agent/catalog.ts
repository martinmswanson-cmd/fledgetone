/**
 * What an agent can choose from, read from the app's own tables: the instruments (keys, names,
 * ranges, whether a suggestion may add one), the Synth Designer presets, the starters, the
 * automatable settings and the inserts with their settings, defaults and ranges. The ranges are
 * found by asking the project file's own checks (normalizeTrackFx, normalizeMasterSettings) what
 * they'd make of a far too small and a far too big value, so they can't drift from what the app
 * keeps. Plain logic, for the command line's `list` and the agent tools' list_* tools.
 */
import { INSTRUMENTS, INSTRUMENT_KEYS, type InstrumentKey } from '../audio/instrumentCatalog';
import { AUTOMATION, FX_AUTOMATION } from '../audio/automation';
import { nameOf } from '../store/noteTools';
import { SYNTH_PRESETS } from '../store/synthPatch';
import { STARTERS } from '../store/starters';
import { AUTOMATION_PARAMS, ECHO_TIMES, FILTER_SLOPES, FILTER_TYPES, FX_AUTOMATION_KEYS, GATE_RATES, LOUD_TARGET_IDS, normalizeMasterSettings, normalizeTrackFx, PUMP_TRIGGERS } from '../store/timelineTypes';
import { INSERT_NAMES, insertDefaults, opInstrumentAllowed } from './ops';

const matches = (query: string | undefined, ...texts: string[]) => !query || texts.some((t) => t.toLowerCase().includes(query.toLowerCase()));

/** The instruments (the retro ones only when asked), optionally those whose key, name, category or description has `query`. */
export function listInstruments(query?: string, opts: { retro?: boolean } = {}) {
  return (INSTRUMENT_KEYS as readonly InstrumentKey[])
    .map((k) => INSTRUMENTS[k])
    .filter((d) => d && (opts.retro || !d.retro) && d.category !== 'Your Sounds')
    .filter((d) => matches(query, d.key, d.name, d.category, d.blurb))
    .map((d) => ({ key: d.key, name: d.name, category: d.category, description: d.blurb, range: `${nameOf(d.range[0])}-${nameOf(d.range[1])}`, canAdd: opInstrumentAllowed(d.key) }));
}

/** The Synth Designer's presets, for set_synth_preset. */
export const listPresets = (query?: string) => SYNTH_PRESETS.filter((p) => matches(query, p.name)).map((p) => p.name);

/** The starter songs, for `fledgetone new --starter`. */
export const listStarters = (query?: string) => STARTERS.filter((s) => matches(query, s.id, s.name, s.detail)).map((s) => ({ id: s.id, name: s.name, group: s.group, description: s.detail }));

/** The settings an automation lane can drive (send:<return id> for a send to a return track). */
export function listParams(query?: string) {
  const out: Array<{ param: string; label: string }> = [
    ...AUTOMATION_PARAMS.map((p) => ({ param: p as string, label: AUTOMATION[p].label })),
    ...FX_AUTOMATION_KEYS.map((k) => ({ param: `fx:${k}`, label: `${FX_AUTOMATION[k].label} (turns its insert on)` })),
    { param: 'send:<return track id>', label: 'The level of the track’s send to that return' },
  ];
  return out.filter((p) => matches(query, p.param, p.label));
}

/** The choices of the settings that take one of a list. */
const CHOICES: Record<string, readonly (string | number)[]> = {
  'filter.type': FILTER_TYPES,
  'filter.slope': FILTER_SLOPES,
  'pump.trigger': PUMP_TRIGGERS,
  'gate.rate': GATE_RATES,
  'echo.time': ECHO_TIMES,
};

export interface SettingInfo {
  default: unknown;
  min?: number;
  max?: number;
  choices?: readonly (string | number)[];
}

/** Each insert's settings, with their defaults and ranges (asked of normalizeTrackFx). */
export function listInserts(query?: string) {
  return INSERT_NAMES.filter((i) => matches(query, i)).map((insert) => {
    const d = insertDefaults(insert);
    const settings: Record<string, SettingInfo> = {};
    for (const [k, v] of Object.entries(d)) {
      const info: SettingInfo = { default: v };
      if (typeof v === 'number') {
        const probe = (x: number) => (normalizeTrackFx({ [insert]: { ...d, [k]: x } }) as unknown as Record<string, Record<string, number>>)[insert][k];
        info.min = probe(-1e9);
        info.max = probe(1e9);
      }
      const choices = CHOICES[`${insert}.${k}`];
      if (choices) info.choices = choices;
      settings[k] = info;
    }
    return { insert, settings };
  });
}

/** The master section's settings for set_master, with defaults and ranges (asked of normalizeMasterSettings). */
export function listMaster() {
  const d = normalizeMasterSettings({ loud: {}, clipper: {} });
  const part = (key: 'ott' | 'width' | 'loud' | 'clipper') => {
    const out: Record<string, SettingInfo> = {};
    for (const [k, v] of Object.entries(d[key] as unknown as Record<string, unknown>)) {
      const info: SettingInfo = { default: v };
      if (typeof v === 'number') {
        const probe = (x: number) => (normalizeMasterSettings({ ...d, [key]: { ...(d[key] as object), [k]: x } })[key] as unknown as Record<string, number>)[k];
        info.min = probe(-1e9);
        info.max = probe(1e9);
      }
      if (key === 'loud' && k === 'target') info.choices = LOUD_TARGET_IDS;
      out[k] = info;
    }
    return out;
  };
  return {
    levelDb: { default: 0, min: -24, max: 12 },
    glue: { default: 'standard', choices: ['standard', 'gentle', 'punchy', 'tight', 'off'] },
    ott: part('ott'),
    width: part('width'),
    loud: part('loud'),
    clipper: part('clipper'),
  };
}
