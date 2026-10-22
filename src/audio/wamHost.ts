import { initializeWamHost } from '@webaudiomodules/sdk';
import type { WamPlugin } from '../store/timelineTypes';
import { createBuiltinInstance, isBuiltinUrl, type BuiltinControls } from './plugins/builtinHost';
import { createStartStates } from './pluginStartState';

/**
 * Hosting Web Audio Modules (WAM 2.0): third-party instruments and effects, each an ES module at
 * a URL whose default export is a WebAudioModule. A plugin runs in the native audio context (the
 * live one, or an export's offline one) and is wired into Tone's graph through the native nodes
 * Tone's wrappers keep. Plugins are code from elsewhere, so one named by an opened project only
 * loads once the person has allowed its URL (adding a plugin yourself allows it). The app's own
 * built-in plugins (`builtin:` addresses) are made by plugins/builtinHost.ts instead.
 */

/** The parts of a WAM instance the host uses. */
export interface WamInstance {
  audioNode: AudioNode & {
    getParameterInfo?: (...ids: string[]) => Promise<Record<string, { id?: string; label?: string; type?: string; minValue?: number; maxValue?: number; defaultValue?: number }>>;
    getParameterValues?: (normalized?: boolean, ...ids: string[]) => Promise<Record<string, { id: string; value: number; normalized?: boolean }>>;
    scheduleEvents?: (...events: unknown[]) => void;
    clearEvents?: () => void;
    getState?: () => Promise<unknown>;
    /** The settings at once (the built-in plugins can say without asking the audio thread) */
    getStateNow?: () => unknown;
    /** Move parameter `id` (0 to 1) and keep it, as a turn of its knob (the built-in plugins) */
    setParamNow?: (id: string, value: number) => void;
    /** Put parameter `id` back to the plugin's own setting (after automation moved it) */
    resetParam?: (id: string) => void;
    setState?: (state: unknown) => Promise<void>;
    destroy?: () => void;
  };
  descriptor?: { name?: string; vendor?: string; isInstrument?: boolean; hasMidiInput?: boolean; hasAudioInput?: boolean };
  /** A built-in plugin's controls, as its panel has them (Pocket's Sound tool works them too) */
  controls?: BuiltinControls;
  createGui?: () => Promise<Element>;
  destroyGui?: (gui: Element) => void;
}

/** How long a plugin may take to load before it's given up on. */
const LOAD_TIMEOUT_MS = 30_000;

export { nativeContextOf, nativeInputOf, nativeOutputOf, keepActive } from './nativeNodes';

// --- Allowed URLs (kept per browser) ---

const TRUST_KEY = 'bosBeatbox.pluginUrls';
let trusted: Set<string> | null = null;
const trustedUrls = (): Set<string> => {
  if (trusted) return trusted;
  try {
    const raw = JSON.parse(localStorage.getItem(TRUST_KEY) ?? '[]');
    trusted = new Set(Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : []);
  } catch {
    trusted = new Set();
  }
  return trusted;
};

export const isPluginUrlAllowed = (url: string): boolean => trustedUrls().has(url);

/** Allow these URLs to load (and remember it). Bumps the epoch, so plugins waiting on them rebuild. */
export function allowPluginUrls(urls: Iterable<string>): void {
  const set = trustedUrls();
  const fresh = [...urls].filter((u) => !set.has(u));
  // Nothing new: nothing to rebuild (a rebuild drops every plugin's sound for a moment)
  if (!fresh.length) return;
  for (const u of fresh) set.add(u);
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify([...set]));
  } catch {
    // Storage blocked: allowed for this page
  }
  epoch++;
  for (const u of fresh) blocked.delete(u);
  notify();
}

/**
 * A project is being replaced: forget the plugin settings read from the old one and the URLs it
 * asked for, and rebuild every plugin, so each starts from the settings its project saved.
 */
export function resetWamSession(): void {
  // The old project's instances still answer while they're let go: what they say is theirs, not
  // the new project's
  for (const inst of live.values()) stale.add(inst);
  session++;
  states.clear();
  starts.clear();
  keptRead.clear();
  blocked.clear();
  epoch++;
  notify();
}

/** Instances that belong to a project already replaced (their settings are never kept). */
const stale = new WeakSet<WamInstance>();
/** Instances whose last settings read hasn't answered yet (see captureWamStates). */
const unanswered = new WeakSet<WamInstance>();
const SLOW = Symbol('slow');
/** Bumped when a project is replaced: a read begun before then doesn't count. */
let session = 0;

/** Plugin URLs a project asked for that haven't been allowed yet. */
const blocked = new Set<string>();
export const blockedPluginUrls = (): string[] => [...blocked];

/** Changes when allowed URLs change (live plugins rebuild on it). */
let epoch = 0;
export const pluginEpoch = (): number => epoch;

// --- Loading ---

const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
const hostGroup = (ctx: BaseAudioContext): Promise<string> => {
  let host = hosts.get(ctx);
  if (!host) {
    host = initializeWamHost(ctx as AudioContext).then(([groupId]) => groupId);
    hosts.set(ctx, host);
  }
  return host;
};

/** A plugin URL as typed: trimmed, and must be http(s) (or relative to this page). */
export function normalizePluginUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u, location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export class PluginBlockedError extends Error {}

/** Load the plugin at `url` into `ctx` with `state`. Rejects for a URL not yet allowed, a load error, or a timeout. */
export async function loadWam(ctx: BaseAudioContext, url: string, state?: unknown, checkAllowed = true): Promise<WamInstance> {
  // The app's own plugins (plugins/builtinHost.ts): nothing to allow
  if (isBuiltinUrl(url)) return createBuiltinInstance(ctx, url, state);
  if (checkAllowed && !isPluginUrlAllowed(url)) {
    if (!blocked.has(url)) {
      blocked.add(url);
      notify();
    }
    throw new PluginBlockedError(`the plugin at ${url} hasn't been allowed to load`);
  }
  const load = (async () => {
    const groupId = await hostGroup(ctx);
    const mod = (await import(/* @vite-ignore */ url)) as { default?: { isWebAudioModuleConstructor?: boolean; createInstance: (g: string, c: BaseAudioContext, s?: unknown) => Promise<WamInstance> } };
    const Wam = mod.default;
    if (!Wam?.isWebAudioModuleConstructor) throw new Error(`${url} isn't a Web Audio Module (its default export should be a WebAudioModule)`);
    const inst = await Wam.createInstance(groupId, ctx, state ?? undefined);
    // Not every plugin applies the state it's created with (the SDK's base class doesn't): set it again
    if (state !== undefined && state !== null) await inst.audioNode.setState?.(state);
    return inst;
  })();
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`the plugin at ${url} took too long to load`));
      // Given up on: if it does arrive, let it go
      load.then(destroyInstance, () => {});
    }, LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Take an instance out of the graph and let it go. */
export function destroyInstance(inst: WamInstance): void {
  try {
    inst.audioNode.disconnect();
  } catch {
    // Not connected
  }
  try {
    inst.audioNode.destroy?.();
  } catch {
    // Already destroyed
  }
}

/** What a plugin says it is, read by loading it once in `ctx` (then let go). It needn't be allowed yet: this is the person trying it. */
export async function describeWam(ctx: BaseAudioContext, url: string): Promise<{ name: string; isInstrument: boolean }> {
  const inst = await loadWam(ctx, url, undefined, false);
  const d = inst.descriptor ?? {};
  destroyInstance(inst);
  return { name: (d.name || url.split('/').filter(Boolean).slice(-2, -1)[0] || 'Plugin').slice(0, 40), isInstrument: !!d.isInstrument || d.hasAudioInput === false };
}

// --- Live instances: their windows, and their settings saved with the project ---

const live = new Map<string, WamInstance>();
/** Latest settings read from each live plugin, by plugin id */
const states = new Map<string, string>();
/** The settings each plugin is known to have had (read live, or built from): see startingState */
const starts = createStartStates();

export const liveWam = (pluginId: string): WamInstance | undefined => live.get(pluginId);

/** The live plugin a built-in panel's controls belong to (its id), if it's live. */
export function pluginIdOfControls(controls: BuiltinControls): string | undefined {
  for (const [id, inst] of live) if (inst.controls === controls) return id;
  return undefined;
}

export function registerLiveWam(pluginId: string, inst: WamInstance): void {
  live.set(pluginId, inst);
  notify();
}

export function unregisterLiveWam(pluginId: string, inst: WamInstance): void {
  if (live.get(pluginId) === inst) live.delete(pluginId);
  notify();
}

/** Plugins being let go, by id: their settings are read first, so the one built next starts from them. */
const retiring = new Map<string, Promise<void>>();

/**
 * Let a live instance go after reading its settings (the last poll may be up to 3 s old), so a
 * rebuild (bypass, another effect added) keeps what was just turned.
 */
export function retireLiveWam(pluginId: string, inst: WamInstance): void {
  unregisterLiveWam(pluginId, inst);
  inst.audioNode.disconnect();
  const n = ++reads;
  const began = session;
  const read = Promise.race([
    Promise.resolve(inst.audioNode.getState?.()).then((state) => {
      // (Another song opened while it answered: these settings are the old song's)
      if (state === undefined || began !== session || stale.has(inst)) return;
      const json = JSON.stringify(state);
      if (json.length > 2_000_000 || !newestRead(pluginId, n) || states.get(pluginId) === json) return;
      states.set(pluginId, json);
  starts.seen(pluginId, json);
      const changed = new Map<string, unknown>([[pluginId, JSON.parse(json)]]);
      stateListeners.forEach((l) => l(changed));
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  ]).catch(() => {});
  const done = read.then(() => destroyInstance(inst));
  retiring.set(pluginId, done);
  void done.then(() => {
    if (retiring.get(pluginId) === done) retiring.delete(pluginId);
  });
}

/** Resolves once the instance of `pluginId` being let go has had its settings read. */
export const whenRetired = (pluginId: string): Promise<void> => retiring.get(pluginId) ?? Promise.resolve();

/** Every plugin's settings as last read live (to put back on the tracks after an undo). */
export function liveStates(): Map<string, unknown> {
  return new Map([...states].map(([id, json]) => [id, JSON.parse(json)]));
}

/**
 * The settings a plugin should start with: as last read live, else as saved. Settings put on its
 * track from outside since the live read (never read live nor built from: see pluginStartState.ts)
 * are newer, and win: the live read is dropped.
 */
export function startingState(plugin: WamPlugin): unknown {
  const s = states.get(plugin.id);
  const saved = plugin.state === undefined ? undefined : JSON.stringify(plugin.state);
  const from = starts.choose(plugin.id, saved, s);
  if (saved !== undefined) starts.seen(plugin.id, saved);
  if (from === 'saved') {
    states.delete(plugin.id);
    return plugin.state;
  }
  return JSON.parse(s!);
}

type StateListener = (changed: Map<string, unknown>) => void;
const stateListeners = new Set<StateListener>();
/** Called with the plugins whose settings changed when they're read (see captureWamStates). */
export function onWamStates(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Read every live plugin's settings; the ones that changed go to the listeners (to be saved). */
const movedListeners = new Set<(pluginId: string) => void>();
/** Say a plugin's parameter was moved from outside its window (MIDI learn), for the lanes' readouts. */
export function paramMoved(pluginId: string): void {
  movedListeners.forEach((l) => l(pluginId));
}
export function onParamMoved(listener: (pluginId: string) => void): () => void {
  movedListeners.add(listener);
  return () => movedListeners.delete(listener);
}

/** Each settings read is numbered when asked; per plugin, the newest read kept so far. */
let reads = 0;
const keptRead = new Map<string, number>();
/** Whether read `n` of plugin `id` is newer than any kept (and if so, it's the newest now). */
function newestRead(id: string, n: number): boolean {
  if (n <= (keptRead.get(id) ?? 0)) return false;
  keptRead.set(id, n);
  return true;
}

/**
 * Keep a plugin's answer to read `n` (into `changed`): unless it's empty, the song changed since
 * the read began, or a read asked later has already answered (a slow answer never undoes a newer
 * one, as the read taken when the plugin is let go).
 */
function keepAnswer(id: string, inst: WamInstance, state: unknown, began: number, n: number, changed: Map<string, unknown>): void {
  // (A song opened while it answered: the answer belongs to the one before)
  if (state === undefined || began !== session || stale.has(inst)) return;
  const json = JSON.stringify(state);
  if (json.length > 2_000_000 || !newestRead(id, n) || states.get(id) === json) return;
  states.set(id, json);
  starts.seen(id, json);
  changed.set(id, JSON.parse(json));
}

export async function captureWamStates(): Promise<void> {
  // A plugin just bypassed or removed has its last settings read as it goes: those first (at
  // most a second), so a save made at once has them
  await Promise.all([...retiring.values()]);
  const changed = new Map<string, unknown>();
  const began = session;
  await Promise.all(
    [...live].map(async ([id, inst]) => {
      // (An instance of a song already replaced, waiting to be let go: not this song's)
      if (stale.has(inst)) return;
      try {
        // (A plugin that never answers, crashed say, is skipped after a second, keeping what
        // was saved: saving, exporting and freezing never wait on it for ever)
        // (One that already kept a read waiting is skipped until it answers that one: a run of
        // renders, stem by stem, doesn't wait a second each)
        if (unanswered.has(inst)) return;
        const n = ++reads;
        const asked = inst.audioNode.getState?.();
        const state = await Promise.race([asked, new Promise<typeof SLOW>((r) => setTimeout(() => r(SLOW), 1000))]);
        if (state === SLOW) {
          unanswered.add(inst);
          // (A late answer still counts: a plugin that's always slow gets its settings saved)
          void Promise.resolve(asked).then(
            (late) => {
              unanswered.delete(inst);
              const one = new Map<string, unknown>();
              keepAnswer(id, inst, late, began, n, one);
              if (one.size) stateListeners.forEach((l) => l(one));
            },
            () => unanswered.delete(inst)
          );
          return;
        }
        keepAnswer(id, inst, state, began, n, changed);
      } catch {
        // A plugin that can't say: keep what was saved
      }
    })
  );
  // (A project replaced meanwhile: these were the old one's)
  if (changed.size && began === session) stateListeners.forEach((l) => l(changed));
}

/**
 * Read at once the plugins that can say without waiting (the built-in ones), so a song set aside
 * this instant (New, Open: the Restore banner's copy) has their latest settings. Others keep the
 * settings last read (at most a few seconds old).
 */
export function captureWamStatesNow(): void {
  const changed = new Map<string, unknown>();
  for (const [id, inst] of live) {
    if (stale.has(inst)) continue;
    const state = inst.audioNode.getStateNow?.();
    if (state === undefined) continue;
    const json = JSON.stringify(state);
    if (json.length > 2_000_000 || !newestRead(id, ++reads) || states.get(id) === json) continue;
    states.set(id, json);
  starts.seen(id, json);
    changed.set(id, JSON.parse(json));
  }
  if (changed.size) stateListeners.forEach((l) => l(changed));
}

/** Read one built-in plugin's settings at once (after a turn of its knobs), as captureWamStatesNow does. */
export function captureWamStateNow(pluginId: string): void {
  const inst = live.get(pluginId);
  const state = inst && !stale.has(inst) ? inst.audioNode.getStateNow?.() : undefined;
  if (state === undefined) return;
  const json = JSON.stringify(state);
  if (json.length > 2_000_000 || !newestRead(pluginId, ++reads) || states.get(pluginId) === json) return;
  states.set(pluginId, json);
  starts.seen(pluginId, json);
  const changed = new Map<string, unknown>([[pluginId, JSON.parse(json)]]);
  stateListeners.forEach((l) => l(changed));
}

/**
 * Put a plugin back to `state` (an undo of a turn of its knobs): kept as its latest settings, and
 * set on it now if it's live (else it starts from them when it's built).
 */
export function restoreWamState(pluginId: string, state: unknown): void {
  if (state === undefined) return;
  const json = JSON.stringify(state);
  // (A read already on its way is older than this)
  newestRead(pluginId, ++reads);
  states.set(pluginId, json);
  starts.seen(pluginId, json);
  const inst = live.get(pluginId);
  if (inst && !stale.has(inst)) void inst.audioNode.setState?.(JSON.parse(json));
}

// Settings are read every few seconds while any plugin is live, so autosave and exports have them
let polling = 0;
const poll = () => {
  if (live.size && !polling) {
    polling = window.setInterval(() => {
      if (!live.size) {
        clearInterval(polling);
        polling = 0;
        return;
      }
      void captureWamStates();
    }, 3000);
  }
};

// --- Change notifications (for the UI) ---

const listeners = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  poll();
  listeners.forEach((l) => l());
}
export function subscribeWam(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const wamVersion = (): number => version;

/** MIDI bytes for a note at `time` (audio seconds) to a plugin's node. */
export function sendMidi(inst: WamInstance, bytes: [number, number, number], time: number): void {
  inst.audioNode.scheduleEvents?.({ type: 'wam-midi', time, data: { bytes } });
}

/**
 * The song's tempo from `time` (audio seconds), for plugins with tempo-synced parts; with `beat`,
 * where in the song that is (quarter notes from its start), for plugins that follow the song
 * (Fledge Synth: its free LFOs and random values, so live playback and an export match).
 */
export function sendTempo(inst: WamInstance, bpm: number, time: number, beat?: number): void {
  inst.audioNode.scheduleEvents?.({ type: 'wam-transport', time, data: { tempo: bpm, playing: true, ...(beat !== undefined && Number.isFinite(beat) ? { beat } : {}) } });
}

/**
 * Set a plugin parameter to `value` (0 to 1 of its range) at `time` (audio seconds), as an
 * automation lane does.
 */
export function setWamParam(inst: WamInstance, id: string, value: number, time: number): void {
  // (NaN: the lane is gone, back to the plugin's own setting, where the plugin keeps one)
  if (Number.isNaN(value)) {
    inst.audioNode.resetParam?.(id);
    return;
  }
  inst.audioNode.scheduleEvents?.({ type: 'wam-automation', time, data: { id, value: Math.max(0, Math.min(1, value)), normalized: true } });
}

/**
 * Read a live plugin's parameters (names, ranges, values now) into pluginParamInfo, for the lane
 * picker and the lanes' readouts. Resolves to how many it has (0 if it isn't loaded).
 */
export async function readWamParams(pluginId: string, info: Map<string, { label: string; minValue: number; maxValue: number; defaultValue: number; value?: number }>): Promise<number> {
  const inst = live.get(pluginId);
  const node = inst?.audioNode;
  if (!node?.getParameterInfo) return 0;
  try {
    const params = await node.getParameterInfo();
    const values = (await node.getParameterValues?.(false).catch(() => ({}))) ?? {};
    let count = 0;
    for (const [id, p] of Object.entries(params)) {
      // (Only numbers can be drawn on a lane)
      if (p.type && !['float', 'int', 'boolean', 'choice'].includes(p.type)) continue;
      const v = (values as Record<string, { value: number }>)[id]?.value;
      info.set(`${pluginId}:${id}`, { label: p.label || id, minValue: p.minValue ?? 0, maxValue: p.maxValue ?? 1, defaultValue: p.defaultValue ?? 0, ...(Number.isFinite(v) ? { value: v } : {}) });
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}
