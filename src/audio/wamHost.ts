import * as Tone from 'tone';
import { initializeWamHost } from '@webaudiomodules/sdk';
import type { WamPlugin } from '../store/timelineTypes';

/**
 * Hosting Web Audio Modules (WAM 2.0): third-party instruments and effects, each an ES module at
 * a URL whose default export is a WebAudioModule. A plugin runs in the native audio context (the
 * live one, or an export's offline one) and is wired into Tone's graph through the native nodes
 * Tone's wrappers keep. Plugins are code from elsewhere, so one named by an opened project only
 * loads once the person has allowed its URL (adding a plugin yourself allows it).
 */

/** The parts of a WAM instance the host uses. */
export interface WamInstance {
  audioNode: AudioNode & {
    scheduleEvents?: (...events: unknown[]) => void;
    clearEvents?: () => void;
    getState?: () => Promise<unknown>;
    setState?: (state: unknown) => Promise<void>;
    destroy?: () => void;
  };
  descriptor?: { name?: string; vendor?: string; isInstrument?: boolean; hasMidiInput?: boolean; hasAudioInput?: boolean };
  createGui?: () => Promise<Element>;
  destroyGui?: (gui: Element) => void;
}

/** How long a plugin may take to load before it's given up on. */
const LOAD_TIMEOUT_MS = 30_000;

type WithNative = { _nativeAudioContext?: BaseAudioContext; _nativeOfflineAudioContext?: BaseAudioContext; _nativeContext?: BaseAudioContext };

/** The native context under a Tone context (live or offline). */
export function nativeContextOf(context: Tone.BaseContext): BaseAudioContext {
  const raw = context.rawContext as unknown as WithNative;
  return raw._nativeAudioContext ?? raw._nativeOfflineAudioContext ?? raw._nativeContext ?? (raw as unknown as BaseAudioContext);
}

/** The native node a Tone node (or wrapped node) takes its input at. */
export function nativeInputOf(node: Tone.InputNode): AudioNode {
  let n: unknown = node;
  while (n instanceof Tone.ToneAudioNode) n = n.input;
  return ((n as { _nativeAudioNode?: AudioNode })._nativeAudioNode ?? n) as AudioNode;
}

/** The native node a Tone node's sound comes out of. */
export function nativeOutputOf(node: Tone.ToneAudioNode): AudioNode {
  let n: unknown = node;
  while (n instanceof Tone.ToneAudioNode) n = n.output;
  return ((n as { _nativeAudioNode?: AudioNode })._nativeAudioNode ?? n) as AudioNode;
}

/**
 * Keep a node of Tone's graph sounding when only native nodes (a plugin) play into it. Tone's nodes
 * are standardized-audio-context's wrappers, which take a node with no input they know of out of
 * the native graph to save work ("passive"); a silent constant source playing into it, which they
 * do know of, keeps it in. Returns what undoes it.
 */
export function keepActive(node: Tone.ToneAudioNode): () => void {
  const source = node.context.createConstantSource();
  source.offset.value = 0;
  source.start();
  Tone.connect(source, node);
  return () => {
    try {
      source.stop();
      source.disconnect();
    } catch {
      // Already stopped
    }
  };
}

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
  for (const u of urls) set.add(u);
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify([...set]));
  } catch {
    // Storage blocked: allowed for this page
  }
  epoch++;
  blocked.clear();
  notify();
}

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
export async function loadWam(ctx: BaseAudioContext, url: string, state?: unknown): Promise<WamInstance> {
  if (!isPluginUrlAllowed(url)) {
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
    timer = window.setTimeout(() => reject(new Error(`the plugin at ${url} took too long to load`)), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** What a plugin says it is, read by loading it once in `ctx` (then let go). */
export async function describeWam(ctx: BaseAudioContext, url: string): Promise<{ name: string; isInstrument: boolean }> {
  const inst = await loadWam(ctx, url);
  const d = inst.descriptor ?? {};
  try {
    inst.audioNode.disconnect();
    inst.audioNode.destroy?.();
  } catch {
    // Already gone
  }
  return { name: (d.name || url.split('/').filter(Boolean).slice(-2, -1)[0] || 'Plugin').slice(0, 40), isInstrument: !!d.isInstrument || d.hasAudioInput === false };
}

// --- Live instances: their windows, and their settings saved with the project ---

const live = new Map<string, WamInstance>();
/** Latest settings read from each live plugin, by plugin id */
const states = new Map<string, string>();

export const liveWam = (pluginId: string): WamInstance | undefined => live.get(pluginId);

export function registerLiveWam(pluginId: string, inst: WamInstance): void {
  live.set(pluginId, inst);
  notify();
}

export function unregisterLiveWam(pluginId: string, inst: WamInstance): void {
  if (live.get(pluginId) === inst) live.delete(pluginId);
  notify();
}

/** The settings a plugin should start with: as last read live, else as saved. */
export function startingState(plugin: WamPlugin): unknown {
  const s = states.get(plugin.id);
  return s !== undefined ? JSON.parse(s) : plugin.state;
}

type StateListener = (changed: Map<string, unknown>) => void;
const stateListeners = new Set<StateListener>();
/** Called with the plugins whose settings changed when they're read (see captureWamStates). */
export function onWamStates(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Read every live plugin's settings; the ones that changed go to the listeners (to be saved). */
export async function captureWamStates(): Promise<void> {
  const changed = new Map<string, unknown>();
  await Promise.all(
    [...live].map(async ([id, inst]) => {
      try {
        const state = await inst.audioNode.getState?.();
        if (state === undefined) return;
        const json = JSON.stringify(state);
        if (json.length > 2_000_000 || states.get(id) === json) return;
        states.set(id, json);
        changed.set(id, JSON.parse(json));
      } catch {
        // A plugin that can't say: keep what was saved
      }
    })
  );
  if (changed.size) stateListeners.forEach((l) => l(changed));
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
