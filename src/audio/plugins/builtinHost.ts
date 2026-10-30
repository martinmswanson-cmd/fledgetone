import type { WamInstance } from '../wamHost';
import { isNamedParam, NAMED_PARAM, rememberParamNames } from './paramNames';
import { recordingBytes } from '../recordingStore';
import { GPL_FAMILY_NAMES } from './pluginCatalog';
import type { BuiltinPluginInfo, PluginFamily } from './pluginTypes';
import { presetFilePath } from '../runtimePlugins';
import { BUILTIN_PROCESSOR, BUILTIN_PROCESSOR_SOURCE } from './processor';
import { GPL_PLUGINS, pluginFamilies, pluginSource } from './pluginSources';
import { normalizeUserTable, unpackUserTable, USER_CYCLE, type UserTable } from './userTable';
import { OUTPUT_TRIMS_DB, ownMemoryFor, PARAM_LIMITS } from './paramLimits';

/**
 * Built-in plugins: open-source effects and instruments compiled to WebAssembly (see
 * scripts/plugins/), hosted next to the page in fledgetone-plugins/ and downloaded the first
 * time one of their family is used (then kept in this browser, like the instruments' recordings).
 *
 * On a track they're Web Audio Module plugins with a `builtin:<family>/<name>` address: wamHost's
 * loadWam hands those here, and this makes an instance that looks like a WAM to the rest of the
 * app (parameters, timed MIDI and automation events, settings), so plugin tracks, effect chains,
 * automation lanes, saving, freezing and exports all work as they do for any WAM. Each runs in an
 * AudioWorklet (processor.ts).
 *
 * GPL-licensed families are only offered by builds made with VITE_GPL_PLUGINS=1 (the website and
 * the dev server, whose source is published with them, as the GPL asks); a project naming one in
 * a build without it (the one-file build) loads it as missing (the track plays on without it).
 */


/** Effects whose point is to sound on with nothing going in (infinite, freezing reverbs): never faded. */
const HOLDS_FOREVER = new Set(['Infinity', 'Infinity2']);
export const BUILTIN_PREFIX = 'builtin:';
export { GPL_PLUGINS, pluginFamilies };

export interface BuiltinRef {
  family: PluginFamily;
  index: number;
  info: BuiltinPluginInfo;
}

/** The address a built-in plugin goes by on a track. */
export const builtinUrl = (family: string, name: string): string => `${BUILTIN_PREFIX}${family}/${name}`;
export const isBuiltinUrl = (url: string): boolean => url.startsWith(BUILTIN_PREFIX);

/** The built-in plugin at a `builtin:` address, if this build has it. */
export function findBuiltin(url: string): BuiltinRef | null {
  if (!isBuiltinUrl(url)) return null;
  const [familyName, ...rest] = url.slice(BUILTIN_PREFIX.length).split('/');
  const family = pluginFamilies().find((f) => f.family === familyName);
  const name = rest.join('/');
  const index = family ? family.plugins.findIndex((p) => p.name === name) : -1;
  return family && index >= 0 ? { family, index, info: family.plugins[index] } : null;
}

// --- The families' WebAssembly, compiled once per page ---

const modules = new Map<string, Promise<WebAssembly.Module>>();
function familyModule(family: PluginFamily): Promise<WebAssembly.Module> {
  let m = modules.get(family.family);
  if (!m) {
    m = recordingBytes(pluginSource(family), family.file).then((bytes) => WebAssembly.compile(bytes));
    modules.set(family.family, m);
    // A failed download is tried again next time
    m.catch(() => modules.delete(family.family));
  }
  return m;
}

/** Download (or read the kept copy of) a family's WebAssembly ahead of use. */
export const preloadFamily = (family: PluginFamily): Promise<unknown> => familyModule(family);

/** A family's compiled WebAssembly (for a panel that draws with the plugin's own code). */
export const builtinModule = (family: PluginFamily): Promise<WebAssembly.Module> => familyModule(family);

// --- The processor, added once per audio context ---

const added = new WeakMap<BaseAudioContext, Promise<void>>();
let processorUrl: string | null = null;
function addProcessor(ctx: BaseAudioContext): Promise<void> {
  let p = added.get(ctx);
  if (!p) {
    if (!ctx.audioWorklet) return Promise.reject(new Error('plugins need a secure page (https or localhost)'));
    processorUrl ??= URL.createObjectURL(new Blob([BUILTIN_PROCESSOR_SOURCE], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(processorUrl);
    added.set(ctx, p);
    p.catch(() => added.delete(ctx));
  }
  return p;
}

// --- Keeping exports in step ---

/**
 * Every built-in plugin's sync in each context. An export renders a step at a time, scheduling
 * the next step's notes while the render is suspended; messages to a plugin's processor can
 * arrive after the render has moved on, so a note would be late or lost. syncBuiltinPlugins
 * resolves once every plugin in the context has received everything sent to it so far.
 */
const syncers = new WeakMap<BaseAudioContext, Set<() => Promise<void>>>();

export function syncBuiltinPlugins(ctx: BaseAudioContext): Promise<void> {
  const set = syncers.get(ctx);
  if (!set?.size) return Promise.resolve();
  // (Never holding up a render for long: a plugin that doesn't answer is skipped after 2 s)
  return Promise.all([...set].map((sync) => Promise.race([sync(), new Promise<void>((r) => setTimeout(r, 2000))]))).then(() => {});
}

// --- An instance ---

/** A built-in plugin's settings, as saved with the project: its parameters, 0 to 1. */
interface BuiltinState {
  builtin: 1;
  /** The preset chosen (for plugins with presets), before `values` */
  program?: number;
  /** The preset file chosen (plugins whose presets are files, like Surge's patches), before `values` */
  preset?: string;
  values: number[];
  /** Fledge Synth's user table, a sound made into a wavetable (see userTable.ts) */
  table?: UserTable;
}
const valuesOf = (state: unknown): number[] | undefined => {
  const v = (state as Partial<BuiltinState> | null | undefined)?.values;
  return Array.isArray(v) ? v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : NaN)) : undefined;
};

export interface BuiltinParam {
  name: string;
  value: number;
  /** As the plugin shows it ("-3.0 dB") */
  text: string;
  defaultValue: number;
  /** Held by an automation lane: it shows the lane, and its control waits until the lane goes */
  held?: boolean;
}

/** What the built-in panel (BuiltinPluginPanel.tsx) works with. */
export interface BuiltinControls {
  ref: BuiltinRef;
  params: () => BuiltinParam[];
  /** The plugin's presets (none for most; "Category/Name" for preset files), and the one chosen (-1: none) */
  programs: string[];
  program: () => number;
  setProgram: (index: number) => Promise<void>;
  /** Set parameter `index` now (0 to 1) */
  set: (index: number, value: number) => void;
  /** Called when a parameter's value or text changes (returns a function that stops it) */
  subscribe: (listener: () => void) => () => void;
  /** Fledge Synth's user table, if it has one (plugins that can't take one: always null) */
  userTable: () => UserTable | null;
  /** Give it a user table, or take it away (null): resolves once it plays (false if it couldn't be read) */
  setUserTable: (table: UserTable | null) => Promise<boolean>;
}

type GuiFactory = (controls: BuiltinControls) => { element: Element; destroy: () => void };
let guiFactory: GuiFactory | null = null;
/** How a built-in plugin's window is drawn (set by the UI, so audio code needn't import React). */
export function setBuiltinGui(factory: GuiFactory): void {
  guiFactory = factory;
}

/** A preset file's bytes (downloaded once, then kept like the plugins). */
function presetBytes(ref: BuiltinRef, name: string): Promise<ArrayBuffer> {
  return recordingBytes(pluginSource(ref.family), presetFilePath(ref.info.presetFiles!, name).url);
}

/** How long making an instance may take (after its family has downloaded). */
const READY_TIMEOUT_MS = 10_000;

/** Make the built-in plugin at `url` in `ctx`, with `state`. */
export async function createBuiltinInstance(ctx: BaseAudioContext, url: string, state?: unknown): Promise<WamInstance> {
  const ref = findBuiltin(url);
  if (!ref) {
    const missing = url.slice(BUILTIN_PREFIX.length);
    throw new Error(GPL_FAMILY_NAMES.includes(missing.split('/')[0]) && !GPL_PLUGINS ? `${missing} is in the full build only (GPL plugins)` : `${missing} isn't in this version`);
  }
  const files = ref.info.presetFiles;
  const savedPreset = (state as Partial<BuiltinState> | undefined)?.preset;
  const startPreset = files && savedPreset && files.names.includes(savedPreset) ? savedPreset : null;
  const savedTable = normalizeUserTable((state as Partial<BuiltinState> | undefined)?.table);
  const [module, , presetData, tableData] = await Promise.all([
    familyModule(ref.family),
    addProcessor(ctx),
    startPreset ? presetBytes(ref, startPreset) : null,
    savedTable ? unpackUserTable(savedTable) : null,
  ]);
  const node = new AudioWorkletNode(ctx, BUILTIN_PROCESSOR, {
    numberOfInputs: ref.info.instrument ? 0 : 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: {
      family: ref.family.family,
      module,
      index: ref.index,
      values: valuesOf(state),
      program: (state as Partial<BuiltinState> | undefined)?.program,
      preset: presetData,
      ...(tableData && savedTable ? { table: tableData, tableFrames: savedTable.frames } : {}),
      // Effects fade out once they go on sounding by themselves after their track has gone quiet
      // (see followInput in processor.ts); the reverbs made to hold a sound forever are left be
      followInput: !ref.info.instrument && !HOLDS_FOREVER.has(ref.info.name),
      // (A family that mustn't share its memory, and parameters kept inside their safe range: paramLimits.ts)
      ...ownMemoryFor(ref.family.family),
      outputGain: 10 ** ((OUTPUT_TRIMS_DB[builtinUrl(ref.family.family, ref.info.name)] ?? 0) / 20),
      limits: PARAM_LIMITS[builtinUrl(ref.family.family, ref.info.name)] ?? null,
    },
  });

  let params: BuiltinParam[] = [];
  /**
   * The plugin's own settings: what its knobs, presets and saved state set. What it plays can
   * differ while an automation lane moves it (the panel shows that); these are what's saved, and
   * what a parameter goes back to when its lane goes
   */
  let own: number[] = [];
  /**
   * Parameters an automation lane holds, with its latest value: the lane has them, as it does in
   * an export (their knobs show the lane and don't move; a preset still sets what they go back to)
   */
  const laneHeld = new Map<number, number>();
  /** Mark the parameters a lane holds (the panels show them as automated). */
  const marked = (list: BuiltinParam[]) => list.map((p, i) => (!!p.held === laneHeld.has(i) ? p : { ...p, held: laneHeld.has(i) }));
  /** Lanes moved held parameters: the panel follows (a few times a second, text included). */
  let following = 0;
  const follow = () => {
    if (following || destroyed) return;
    following = window.setTimeout(() => {
      following = 0;
      if (destroyed) return;
      params = marked(laneShown(params));
      changed();
      if (listeners.size) void refresh();
    }, 120);
  };
  /** Send a value to the processor (its 'display' answer then says what it shows). */
  const post = (index: number, value: number, drop = false) => {
    inFlight.set(index, (inFlight.get(index) ?? 0) + 1);
    node.port.postMessage({ type: 'set', index, value, ...(drop ? { drop: true } : {}) });
  };
  /** Parameter `i`'s value `v` inside its safe range, as the processor plays it (paramLimits.ts) */
  const limits = PARAM_LIMITS[builtinUrl(ref.family.family, ref.info.name)];
  const within = (i: number, v: number) => {
    const range = limits && params[i] ? limits[params[i].name] : undefined;
    return range ? Math.max(range[0], Math.min(range[1], v)) : v;
  };
  /** Held parameters show their lane's value (the processor may not have played it yet), as it's played. */
  const laneShown = (list: BuiltinParam[]) => list.map((p, i) => (laneHeld.has(i) ? { ...p, value: within(i, laneHeld.get(i)!) } : p));
  /**
   * Sets sent per parameter and not yet answered: a late answer to an older one mustn't put the
   * value back (a knob stepped quickly would lose steps)
   */
  const inFlight = new Map<number, number>();
  const keepSent = (fresh: BuiltinParam[]) => fresh.map((p, i) => (inFlight.get(i) ? { ...p, value: params[i]?.value ?? p.value } : p));
  let programs: string[] = [];
  let program = -1;
  /** The user table it plays (kept with its settings) */
  let userTable: UserTable | null = tableData && savedTable ? savedTable : null;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  const replies = new Map<number, (p: BuiltinParam[]) => void>();
  const synced = new Map<number, () => void>();
  let nextReply = 0;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ref.info.name} didn't start`)), READY_TIMEOUT_MS);
    node.onprocessorerror = () => {
      clearTimeout(timer);
      reject(new Error(`${ref.info.name} stopped with an error`));
    };
    node.port.onmessage = (m: MessageEvent) => {
      const d = m.data;
      if (d.type === 'ready') {
        clearTimeout(timer);
        params = d.params.map((p: Omit<BuiltinParam, 'defaultValue'>, i: number) => ({ ...p, defaultValue: d.defaults[i] ?? p.value }));
        own = params.map((p) => p.value);
        rememberParamNames(url, params.map((p) => p.name));
        programs = files ? files.names : (d.programs ?? []);
        program = files ? (startPreset ? files.names.indexOf(startPreset) : -1) : (d.program ?? -1);
        resolve();
      } else if (d.type === 'fault') {
        // (Said once per plugin: it went silent for a moment rather than silencing or blasting the mix)
        console.warn(`${ref.info.name} ${d.message}`);
      } else if (d.type === 'error') {
        clearTimeout(timer);
        reject(new Error(d.message));
      } else if (d.type === 'display') {
        const waiting = (inFlight.get(d.index) ?? 1) - 1;
        if (waiting > 0) {
          // A newer set is on its way: its own answer will say what it shows
          inFlight.set(d.index, waiting);
          return;
        }
        inFlight.delete(d.index);
        // A new array each time: the panel redraws when the array changes
        params = params.map((p, i) => (i === d.index ? { ...p, value: d.value, text: d.text } : p));
        changed();
      } else if (d.type === 'synced') {
        synced.get(d.id)?.();
        synced.delete(d.id);
      } else if (d.type === 'params') {
        if (!files) program = d.program ?? -1;
        const reply = replies.get(d.id);
        replies.delete(d.id);
        if (reply) reply(d.params);
        else {
          // A preset was chosen: every parameter may have moved
          // (A preset file's values are its own defaults: Reset puts the patch back)
          params = keepSent(d.params.map((p: Omit<BuiltinParam, 'defaultValue'>, i: number) => ({ ...p, defaultValue: files ? p.value : (params[i]?.defaultValue ?? p.value) })));
          // (A held parameter's own setting is the preset's, from the reply itself: a re-post
          // still unanswered mustn't keep an older preset's)
          own = params.map((p, i) => (laneHeld.has(i) ? (d.params[i]?.value ?? p.value) : p.value));
          params = marked(laneShown(params));
          // (A lane holding a parameter goes on playing its value over the preset's)
          for (const [i, v] of laneHeld) post(i, v);
          changed();
          // Loads answer in the order they were sent: this reply ends the oldest
          loaded.shift()?.();
        }
      }
    };
  });
  try {
    await ready;
  } catch (err) {
    node.port.close();
    throw err;
  }

  // Timed events go over in one message per task
  let pending: unknown[] = [];
  const flush = () => {
    if (!pending.length) return;
    // (Events queued just before destroy: the processor is gone)
    if (destroyed) {
      pending = [];
      return;
    }
    node.port.postMessage({ type: 'events', events: pending });
    pending = [];
  };
  let destroyed = false;
  const sync = () =>
    new Promise<void>((resolve) => {
      flush();
      const id = nextReply++;
      synced.set(id, resolve);
      node.port.postMessage({ type: 'sync', id });
    });
  let ctxSyncers = syncers.get(ctx);
  if (!ctxSyncers) syncers.set(ctx, (ctxSyncers = new Set()));
  ctxSyncers.add(sync);
  const stateNow = (): BuiltinState => ({
    builtin: 1,
    ...(program >= 0 ? (files ? { preset: files.names[program] } : { program }) : {}),
    values: own.slice(),
    ...(userTable ? { table: userTable } : {}),
  });
  const audioNode = Object.assign(node, {
    getParameterInfo: async () =>
      Object.fromEntries(params.map((p, i) => [String(i), { id: String(i), label: p.name, type: 'float', minValue: 0, maxValue: 1, defaultValue: p.defaultValue }])),
    getParameterValues: async () => Object.fromEntries(own.map((v, i) => [String(i), { id: String(i), value: v, normalized: true }])),
    scheduleEvents: (...raw: unknown[]) => {
      if (destroyed) return;
      // A parameter named rather than numbered ("#Macro 1", from a step lane): its number here
      const events = raw.flatMap((e) => {
        const ev = e as { type?: string; data?: { id?: string; value?: number } };
        if (ev?.type !== 'wam-automation' || !isNamedParam(String(ev.data?.id ?? ''))) return [e];
        const i = indexOfId(String(ev.data!.id));
        return i < 0 ? [] : [{ ...ev, data: { ...ev.data, id: String(i) } }];
      });
      for (const e of events as Array<{ type?: string; data?: { id?: string; value?: number } }>) {
        if (e?.type === 'wam-automation' && Number.isFinite(e.data?.value)) {
          laneHeld.set(Number(e.data!.id), e.data!.value!);
          follow();
        }
      }
      if (!pending.length) queueMicrotask(flush);
      pending.push(...events);
    },
    clearEvents: () => {
      pending = [];
      if (!destroyed) node.port.postMessage({ type: 'clear' });
    },
    getState: async (): Promise<BuiltinState> => stateNow(),
    getStateNow: (): BuiltinState => stateNow(),
    setParamNow: (id: string, value: number) => set(Number(id), value),
    resetParam: (id: string) => {
      const i = indexOfId(id);
      laneHeld.delete(i);
      params = marked(params);
      if (!params[i] || destroyed) return;
      // (Its lane's events not sent yet, or queued in the processor, go too)
      pending = pending.filter((e) => !((e as { type?: string }).type === 'wam-automation' && Number((e as { data?: { id?: string } }).data?.id) === i));
      params = params.map((x, k) => (k === i ? { ...x, value: own[i] } : x));
      flush();
      post(i, own[i], true);
      changed();
    },
    setState: async (s: unknown) => {
      const saved = s as Partial<BuiltinState> | undefined;
      const p = files ? (saved?.preset ? files.names.indexOf(saved.preset) : -1) : saved?.program;
      if (typeof p === 'number' && p >= 0 && p < programs.length && p !== program) await setProgram(p);
      // (The user table as the settings have it: an undo can take one away or bring one back)
      const table = normalizeUserTable(saved?.table) ?? null;
      if (table?.data !== userTable?.data || table?.frames !== userTable?.frames) await setUserTable(table);
      const values = valuesOf(s);
      values?.forEach((v, i) => {
        if (Number.isFinite(v) && params[i]) set(i, v);
      });
      // Saved before the plugin had all its parameters (an older version of it): the ones it
      // didn't have are set as the sound was then, so it sounds as it did
      if (values?.length && values.length < params.length) await legacy(values.length);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // A load still in flight never gets its reply now: let its caller go on
      for (const done of loaded.splice(0)) done();
      // Nor do parameter requests: end them with the values as they are
      for (const reply of [...replies.values()]) reply(params);
      replies.clear();
      ctxSyncers.delete(sync);
      synced.forEach((resolve) => resolve());
      synced.clear();
      node.port.postMessage({ type: 'destroy' });
      listeners.clear();
    },
  });
  /** A parameter's number from its id: the number itself, or `#name` (see paramNames.ts). -1: none. */
  const indexOfId = (id: string) => (isNamedParam(id) ? params.findIndex((p) => p.name === id.slice(NAMED_PARAM.length)) : Number(id));
  const set = (index: number, value: number) => {
    const p = params[index];
    // (Held by an automation lane: the lane has it until it goes)
    if (!p || destroyed || laneHeld.has(index)) return;
    // (Kept as it's played: past a parameter's safe range its knob, the save and a readout say the limit)
    const v = within(index, Math.max(0, Math.min(1, value)));
    params = params.map((x, i) => (i === index ? { ...x, value: v } : x));
    own = own.map((x, i) => (i === index ? v : x));
    post(index, v);
    changed();
  };
  /** Choose preset `index`: a built-in one at once, a file once it's downloaded (resolves then). */
  const setProgram = async (index: number) => {
    if (destroyed || index < 0 || index >= programs.length) return;
    program = index;
    changed();
    if (!files) {
      node.port.postMessage({ type: 'program', index });
      return;
    }
    const data = await presetBytes(ref, files.names[index]);
    // (Another was chosen meanwhile: that one wins)
    if (destroyed || program !== index) return;
    await new Promise<void>((resolve) => {
      loaded.push(resolve);
      node.port.postMessage({ type: 'load', data }, [data]);
    });
  };
  /** Play `table` as the user table (null: none). False if it couldn't be read (nothing changes then). */
  const setUserTable = async (table: UserTable | null): Promise<boolean> => {
    if (destroyed) return false;
    const data = table ? await unpackUserTable(table) : null;
    if (table && !data) return false;
    if (destroyed) return false;
    userTable = table;
    node.port.postMessage({ type: 'table', data, frames: table && data ? Math.min(table.frames, data.length / USER_CYCLE) : 0 });
    changed();
    return true;
  };
  /** Resolves a file preset's load once the plugin has sent its new parameters */
  const loaded: Array<() => void> = [];
  /**
   * An older saved sound with only its first `count` values has gone in: the plugin sets the
   * parameters it didn't have as the sound was then; they become its own settings.
   */
  const legacy = (count: number) =>
    new Promise<void>((resolve) => {
      if (destroyed) return resolve();
      const id = nextReply++;
      replies.set(id, (fresh) => {
        own = own.map((x, i) => (i >= count && fresh[i] && !laneHeld.has(i) ? fresh[i].value : x));
        params = marked(laneShown(keepSent(fresh.map((p, i) => ({ ...p, defaultValue: params[i]?.defaultValue ?? p.value })))));
        changed();
        resolve();
      });
      node.port.postMessage({ type: 'legacy', id, count });
    });
  /** Ask the plugin for every parameter's value and text (after automation moved them). */
  const refresh = () =>
    new Promise<void>((resolve) => {
      const id = nextReply++;
      replies.set(id, (fresh) => {
        params = marked(laneShown(keepSent(fresh.map((p, i) => ({ ...p, defaultValue: params[i]?.defaultValue ?? p.value })))));
        changed();
        resolve();
      });
      node.port.postMessage({ type: 'describe', id });
    });

  const controls: BuiltinControls = {
    ref,
    params: () => params,
    programs,
    program: () => program,
    setProgram,
    set,
    userTable: () => userTable,
    setUserTable,
    subscribe: (l) => {
      listeners.add(l);
      void refresh();
      return () => listeners.delete(l);
    },
  };
  const guis = new Map<Element, () => void>();
  return {
    audioNode,
    controls,
    descriptor: { name: ref.info.name, vendor: ref.family.label, isInstrument: !!ref.info.instrument, hasAudioInput: !ref.info.instrument },
    createGui: async () => {
      if (!guiFactory) throw new Error('no panel for built-in plugins');
      const { element, destroy } = guiFactory(controls);
      guis.set(element, destroy);
      return element;
    },
    destroyGui: (el: Element) => {
      guis.get(el)?.();
      guis.delete(el);
    },
  };
}
