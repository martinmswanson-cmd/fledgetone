import { rootFromName } from './sampleKits';
import { RACK_PADS } from './timelineTypes';

/**
 * Sorting a sample pack (a folder of sound files, as it comes from a download) into what the app
 * plays: drum one-shots into Drum Rack kits, pad by pad (kick, snare, clap, hats...); notes of one
 * instrument (files named by their note, "Keys C3.wav") into a Multi Sampler each; loops and
 * other one-shots as below.
 * Read from the file names and the folders they're in, as packs name them. Plain logic, so Node can
 * unit-test it; loading the files and making the tracks is samplePackImport.ts's.
 *
 * Loops go onto an Audio track (end to end, to audition and drag where they belong); one-shots
 * that are neither drums nor an instrument's notes (a vocal "hey", a single synth stab) onto
 * Drum Rack pads of their own, so every sound loaded can be played.
 */

/** A file of the pack: its path inside the dropped folder ("Pack/Drums/Kicks/Kick 01.wav") and size. */
export interface PackFile {
  path: string;
  size: number;
}

export type DrumRole = 'kick' | 'snare' | 'clap' | 'rim' | 'closedHat' | 'openHat' | 'tomLow' | 'tomMid' | 'tomHigh' | 'crash' | 'ride' | 'perc' | 'shaker' | 'bass808' | 'snap' | 'fx';

/** The pads of a kit, in order: pad 1 (C2) is the kick, pads 5 and 6 the hats (drawn as x noteheads in notation). */
export const KIT_LAYOUT: ReadonlyArray<{ role: DrumRole; label: string }> = [
  { role: 'kick', label: 'Kick' },
  { role: 'snare', label: 'Snare' },
  { role: 'clap', label: 'Clap' },
  { role: 'rim', label: 'Rim' },
  { role: 'closedHat', label: 'Closed hat' },
  { role: 'openHat', label: 'Open hat' },
  { role: 'tomLow', label: 'Tom low' },
  { role: 'tomMid', label: 'Tom mid' },
  { role: 'tomHigh', label: 'Tom high' },
  { role: 'crash', label: 'Crash' },
  { role: 'ride', label: 'Ride' },
  { role: 'perc', label: 'Perc' },
  { role: 'shaker', label: 'Shaker' },
  { role: 'bass808', label: '808' },
  { role: 'snap', label: 'Snap' },
  { role: 'fx', label: 'FX' },
];

/** The roles whose second-best sounds fill the pads a kit has nothing for, most useful first. */
const SPARE_ORDER: DrumRole[] = ['kick', 'snare', 'closedHat', 'clap', 'perc', 'openHat', 'bass808', 'rim', 'shaker', 'snap', 'crash', 'ride', 'fx', 'tomLow', 'tomMid', 'tomHigh'];

/** Most other one-shots put on pads (two racks) */
export const ONE_SHOT_PADS = 2 * RACK_PADS;

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'webm'];
const extOf = (path: string) => /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1].toLowerCase() ?? '';
export const isAudioPath = (path: string): boolean => AUDIO_EXTENSIONS.includes(extOf(path));

/** The file's name without its folders and extension. */
export const baseName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[A-Za-z0-9]{1,5}$/, '');
/** The folder a file is in ('' at the top). */
export const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/');

/** Lower-case words of a name, split at anything not a letter or digit and between letters and digits ("Kick01" → kick, 01). */
function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Words that name a drum, by role. Checked on the file name first, then on its folders (a "Kicks"
// folder holds kicks even when the files are "BD_01"), so the file's own word wins.
const ROLE_WORDS: Array<[DrumRole, string[]]> = [
  ['openHat', ['openhat', 'ohat', 'oh', 'ohh', 'openhh', 'opnhat']],
  ['closedHat', ['closedhat', 'chat', 'ch', 'chh', 'closedhh', 'hihat', 'hihats', 'hat', 'hats', 'hh', 'hhat']],
  ['bass808', ['808', '808s', 'sub', 'subs']],
  ['kick', ['kick', 'kicks', 'kik', 'kck', 'bd', 'bassdrum', 'bassdrums']],
  ['snare', ['snare', 'snares', 'snr', 'sd', 'snre']],
  ['clap', ['clap', 'claps', 'clp', 'handclap', 'handclaps']],
  ['rim', ['rim', 'rims', 'rimshot', 'rimshots', 'sidestick', 'stick', 'sticks']],
  ['crash', ['crash', 'crashes', 'cymbal', 'cymbals', 'cym', 'china', 'splash']],
  ['ride', ['ride', 'rides', 'bell']],
  ['shaker', ['shaker', 'shakers', 'shk', 'tamb', 'tambourine', 'tambourines', 'maraca', 'maracas', 'cabasa']],
  ['snap', ['snap', 'snaps', 'fingersnap', 'fingersnaps']],
  ['perc', ['perc', 'percs', 'percussion', 'conga', 'congas', 'bongo', 'bongos', 'cowbell', 'cowbells', 'block', 'clave', 'claves', 'timbale', 'timbales', 'tabla', 'woodblock', 'triangle', 'agogo', 'guiro']],
  ['fx', ['fx', 'sfx', 'riser', 'risers', 'impact', 'impacts', 'sweep', 'sweeps', 'downlifter', 'uplifter', 'reverse', 'rev', 'noise', 'whoosh']],
];
const TOM_WORDS = ['tom', 'toms', 'floortom', 'racktom'];
/**
 * Short names that are also ordinary words or abbreviations of other things ("Oh Yeah", "Bell C4",
 * "Sub Bass"): a drum only in a name of their own, with nothing but numbers beside them ("OH_02", "BD 1").
 */
const AMBIGUOUS = new Set(['oh', 'ch', 'sd', 'bd', 'sub', 'subs', 'rev', 'stick', 'sticks', 'block', 'bell', 'noise']);

/** Words joined two at a time too ("hi hat" → hihat, "open hat" → openhat, "bass drum" → bassdrum). */
function withPairs(ws: string[]): string[] {
  const pairs = ws.slice(1).map((w, i) => ws[i] + w);
  return [...ws, ...pairs];
}

function roleOfWords(ws: string[]): DrumRole | null {
  const alone = ws.every((w) => AMBIGUOUS.has(w) || /^\d+$/.test(w));
  const set = new Set(withPairs(ws).filter((w) => alone || !AMBIGUOUS.has(w)));
  for (const w of TOM_WORDS) {
    if (!set.has(w)) continue;
    if (set.has('low') || set.has('lo') || set.has('floor') || set.has('floortom')) return 'tomLow';
    if (set.has('high') || set.has('hi')) return 'tomHigh';
    return 'tomMid';
  }
  for (const [role, names] of ROLE_WORDS) if (names.some((n) => set.has(n))) return role;
  return null;
}

/** Folders that hold melodic sounds, not drums, even with a drum-like word nearby ("Bass", "Keys"...). */
const MELODIC_WORDS = ['keys', 'piano', 'pad', 'pads', 'lead', 'leads', 'pluck', 'plucks', 'synth', 'synths', 'bass', 'basses', 'strings', 'string', 'brass', 'guitar', 'guitars', 'bells', 'choir', 'vox', 'vocal', 'vocals', 'chord', 'chords', 'organ', 'flute', 'horn', 'horns', 'sax', 'mallet', 'mallets', 'arp', 'arps'];
// (The folder the file is in, not the ones above it: a "Trap Bass Kit" pack's "Kicks" folder holds kicks)
const isMelodicFolder = (folder: string) => words(folder.split('/').pop() ?? '').some((w) => MELODIC_WORDS.includes(w));

/** The drum a file is, from its name, else from its folders (nearest first); null if neither says. */
export function drumRole(path: string): DrumRole | null {
  // (An instrument's folder holds notes, whatever their names: "Keys/Bell C4", "Vox/Oh Yeah")
  if (isMelodicFolder(folderOf(path))) return null;
  const own = roleOfWords(words(baseName(path)));
  if (own) return own;
  const folders = folderOf(path).split('/').filter(Boolean).reverse();
  for (const f of folders) {
    const role = roleOfWords(words(f));
    if (role) return role;
  }
  return null;
}

/** A loop (a bar or more of music at a tempo), not a one-shot: said by its name or folder, or a tempo in its name. */
export function isLoop(path: string): boolean {
  const ws = words(path);
  if (ws.some((w) => w === 'loop' || w === 'loops' || w === 'break' || w === 'breaks' || w === 'bpm' || w === 'groove' || w === 'grooves' || w === 'stem' || w === 'stems')) return true;
  return /(^|[^0-9])(6[0-9]|[7-9][0-9]|1[0-9][0-9]|2[0-0][0-9])\s*bpm/i.test(path);
}


export interface PackPlan {
  /** Drum Rack kits: each pad's file (an index into the pack's files) and its name; a pad with no file stays empty */
  kits: Array<{ name: string; pads: Array<{ file: number; name: string } | null> }>;
  /** Multi Samplers: one per folder of an instrument's notes, each file with its root key */
  instruments: Array<{ name: string; files: Array<{ file: number; root: number }> }>;
  /** Loops (a bar or more of music): onto an Audio track */
  loops: number[];
  /** Other one-shots (vocals, stabs, effects with no drum word): onto pads of their own, 16 a rack */
  oneShots: number[];
  /** Files left out, and why */
  skipped: Array<{ file: number; reason: 'not audio' | 'too big' | 'too many' }>;
}

export interface PlanOptions {
  /** Largest file (bytes) that can be loaded */
  maxBytes: number;
  /** Most kits made from one pack (each a track) */
  maxKits?: number;
  /** Most sounds loaded from one pack */
  maxFiles?: number;
}

/** The pack's name: the dropped folder's (the first folder all its files share), else "Sample pack". */
export function packName(files: readonly PackFile[]): string {
  const first = files.find((f) => f.path.includes('/'))?.path.split('/')[0];
  return first && files.every((f) => f.path.startsWith(`${first}/`)) ? first : 'Sample pack';
}

/**
 * Sort a pack. Drum one-shots (a drum word in their name or folders, and not a loop) go into kits:
 * each kit takes the next unused sound of every role, in KIT_LAYOUT's order, and fills the pads it
 * has nothing for with spare kicks, snares, hats... A folder of one instrument's notes (at least
 * three files named by different notes) becomes a Multi Sampler. Loops and other one-shots are listed apart.
 */
export function planPack(files: readonly PackFile[], opts: PlanOptions): PackPlan {
  const maxKits = opts.maxKits ?? 4;
  const maxFiles = opts.maxFiles ?? 400;
  const plan: PackPlan = { kits: [], instruments: [], loops: [], oneShots: [], skipped: [] };
  const usable: number[] = [];
  files.forEach((f, i) => {
    if (!isAudioPath(f.path)) plan.skipped.push({ file: i, reason: 'not audio' });
    else if (f.size > opts.maxBytes) plan.skipped.push({ file: i, reason: 'too big' });
    else usable.push(i);
  });
  // In name order (as the pack lists them: "Kick 01" before "Kick 02")
  const byName = (a: number, b: number) => files[a].path.localeCompare(files[b].path, undefined, { numeric: true, sensitivity: 'base' });
  usable.sort(byName);

  // An instrument's notes: by folder, files whose names give their note
  const used = new Set<number>();
  const byFolder = new Map<string, number[]>();
  for (const i of usable) {
    if (isLoop(files[i].path)) continue;
    const role = drumRole(files[i].path);
    // (An 808 named by its note is still a drum pad; other drum names aren't notes either)
    if (role && !isMelodicFolder(folderOf(files[i].path))) continue;
    if (!Number.isFinite(rootFromName(baseName(files[i].path)))) continue;
    const folder = folderOf(files[i].path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), i]);
  }
  for (const [folder, list] of byFolder) {
    const roots = new Set(list.map((i) => rootFromName(baseName(files[i].path))));
    if (roots.size < 3) continue;
    plan.instruments.push({ name: (folder.split('/').pop() || packName(files)).slice(0, 40), files: list.map((i) => ({ file: i, root: rootFromName(baseName(files[i].path)) })) });
    list.forEach((i) => used.add(i));
  }

  // Drum one-shots, by role, in name order
  const pools = new Map<DrumRole, number[]>();
  for (const i of usable) {
    if (used.has(i) || isLoop(files[i].path) || isMelodicFolder(folderOf(files[i].path))) continue;
    const role = drumRole(files[i].path);
    if (!role) continue;
    pools.set(role, [...(pools.get(role) ?? []), i]);
    used.add(i);
  }
  const name = packName(files);
  const take = (role: DrumRole) => pools.get(role)?.shift();
  const left = () => [...pools.values()].some((p) => p.length);
  for (let k = 0; k < maxKits && left(); k++) {
    const pads: PackPlan['kits'][number]['pads'] = KIT_LAYOUT.map(({ role }) => {
      const file = take(role);
      return file === undefined ? null : { file, name: baseName(files[file].path).slice(0, 40) };
    });
    // Empty pads: spare sounds of the most useful roles, so no pad of a kit is wasted
    for (let p = 0; p < RACK_PADS; p++) {
      if (pads[p]) continue;
      const role = SPARE_ORDER.find((r) => pools.get(r)?.length);
      if (!role) break;
      const file = take(role)!;
      pads[p] = { file, name: baseName(files[file].path).slice(0, 40) };
    }
    const kitName = /\bkit\b/i.test(name) ? name : `${name} kit`;
    plan.kits.push({ name: `${kitName}${k ? ` ${k + 1}` : ''}`.slice(0, 40), pads });
  }
  // Drums no kit had room for, and everything else: loops, or one-shots of their own
  const rest = [...[...pools.values()].flat(), ...usable.filter((i) => !used.has(i))].sort(byName);
  for (const i of rest) (isLoop(files[i].path) ? plan.loops : plan.oneShots).push(i);
  // (At most two racks of them: more is a library to browse, not a kit)
  for (const i of plan.oneShots.slice(ONE_SHOT_PADS)) plan.skipped.push({ file: i, reason: 'too many' });
  plan.oneShots = plan.oneShots.slice(0, ONE_SHOT_PADS);

  // At most maxFiles sounds in all: kits first, then instruments, loops and other one-shots
  let budget = maxFiles;
  for (const kit of plan.kits) {
    kit.pads = kit.pads.map((pad) => (pad && budget-- > 0 ? pad : (pad && plan.skipped.push({ file: pad.file, reason: 'too many' }), null)));
  }
  plan.kits = plan.kits.filter((k) => k.pads.some(Boolean));
  for (const inst of plan.instruments) {
    const keep = inst.files.slice(0, Math.max(0, budget));
    for (const f of inst.files.slice(keep.length)) plan.skipped.push({ file: f.file, reason: 'too many' });
    inst.files = keep;
    budget -= keep.length;
  }
  // (One note left is no instrument: skipped with the rest of its notes)
  for (const inst of plan.instruments) if (inst.files.length === 1) plan.skipped.push({ file: inst.files[0].file, reason: 'too many' });
  plan.instruments = plan.instruments.filter((i) => i.files.length >= 2);
  for (const key of ['loops', 'oneShots'] as const) {
    const keep = plan[key].slice(0, Math.max(0, budget));
    for (const f of plan[key].slice(keep.length)) plan.skipped.push({ file: f, reason: 'too many' });
    plan[key] = keep;
    budget -= keep.length;
  }
  return plan;
}
