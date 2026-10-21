import { FOUR_FOUR, meterAt, secondsBetween, tempoAt, type Meter, type MeterMap, type MeterPoint, type TempoMap, type TempoPoint } from './tempoMap';
import { renderArrangement, renderGroupStems, audibleTracks, encodeChannels, ditherSeedOf, channelsOf, type SampleRate } from './exportWav';
import { EXPORTED_FILES_LICENCE, EXPORTED_FILES_LICENCE_NAME } from './exportLicence';
import { defaultCurve, groupsInUse, type IntensityCurve } from '../store/intensity';
import { renderStinger } from './stingerPlayer';
import { createZip, type ZipEntry } from './zip';
import { renderSfxStereo, sfxFileName, varySfx } from './sfx/sfxSynth';
import { ensureSfxRecordings } from './sfx/sfxRecordings';
import type { GameSfx } from '../store/gameSfx';
import { applyCostume, type Costume, type StateOptions } from '../store/costumes';
import { manifestParam, type GameParam } from '../store/gameParams';
import { songSections } from '../store/cutToLength';
import { detectKey } from '../store/songKey';
import { ANY_STATE, bridgeNotes, bridgeTarget, transitionCue } from '../store/transitions';
import { INSTRUMENTS, isDropKind, isDrumKind } from './instrumentCatalog';
import { midiOf, nameOf } from '../store/noteTools';
import { stingerKind } from '../store/stingers';
import type { Clip, Marker, MasterFx, MasterSettings, Stinger, Track, TransitionKind, TransitionRule } from '../store/timelineTypes';
import webPlayer from '../gameKit/adaptive-music.js?raw';
import godotPlayer from '../gameKit/godot/AdaptiveMusic.gd?raw';
import unityPlayer from '../gameKit/unity/AdaptiveMusic.cs?raw';
import godotExample from '../gameKit/godot/music_example.gd?raw';
import unityExample from '../gameKit/unity/AdaptiveMusicExample.cs?raw';

/**
 * The game kit: everything a game needs to play the song the way the Game preview does, in one
 * .zip. Every state (section) as a seamless loop (and its stems), the stingers, the transitions, an
 * audio_manifest.json describing them (tempo, bars, the transition rules, the intensity curves), and ready-made
 * players for the web, Godot and Unity that read it and switch on the beat.
 */

export interface GameKitSong {
  name: string;
  /** The tempo at bar 1 */
  bpm: number;
  /** Tempo changes (each state plays at its own tempo) */
  tempoPoints?: TempoPoint[];
  /** The time signature from bar 1 */
  meter?: Meter;
  /** Time signature changes */
  meterPoints?: MeterPoint[];
  swing: number;
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  masterFx: MasterFx;
  master: MasterSettings;
  stingers: Stinger[];
  transitions: Record<string, TransitionRule>;
  /** Intensity now and each stem group's curve (see intensity.ts) */
  intensity: number;
  intensityCurves: Record<string, IntensityCurve>;
  /** Sound effects that go with the music (see gameSfx.ts) */
  sfx?: GameSfx[];
  /** The song played other ways: each state is rendered in each (see costumes.ts) */
  costumes?: Costume[];
  /** Named values the game sets, each moving several things (see gameParams.ts) */
  gameParams?: GameParam[];
  /** How each state plays (shuffled pieces, silences), by section marker id */
  stateOptions?: Record<string, StateOptions>;
}

/** The stem that holds the tracks without a group: always at full level. */
export const MAIN_STEM = 'Main';

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';

/** What the kit holds before it's zipped: the manifest and every file by its path. */
export interface GameKitParts {
  manifest: AudioManifest;
  files: ZipEntry[];
}

export interface AudioManifest {
  format: string;
  version: number;
  name: string;
  bpm: number;
  timeSignature: [number, number];
  beatsPerBar: number;
  /** A beat at the starting tempo, in seconds (each state has its own: see states) */
  beatSeconds: number;
  sampleRate: number;
  key: string | null;
  intensity: { default: number; groups: Array<{ name: string; curve: IntensityCurve }> };
  /** Named values the game sets (setParameter), each moving the intensity, filter, reverb, volume or a group's level over a window of it */
  parameters?: Array<ReturnType<typeof manifestParam>>;
  /** `bpm`: the state's tempo where it starts (the song's when there are no tempo changes) */
  /**
   * `beatSeconds` and `beatsPerBar`: the state's beat (a quarter in 4/4, an eighth in 6/8) at its
   * tempo, and how many make a bar in its time signature, so a player finds its bar lines.
   */
  states: Array<{
    name: string;
    file: string;
    bars: number;
    seconds: number;
    samples: number;
    bpm: number;
    timeSignature: [number, number];
    beatsPerBar: number;
    beatSeconds: number;
    stems: Array<{ group: string; file: string; tracks: string[] }>;
    /**
     * The state in each costume: the same music played another way, lined up with it (same bars;
     * `tempo` times as fast, so `seconds` shorter or longer), for a player to swap mid-loop.
     */
    costumes?: Array<{ name: string; tempo: number; file?: string; seconds: number; stems: Array<{ group: string; file: string }> }>;
    /** Play the state's pieces of this many bars in a shuffled order (no piece twice running) */
    shuffleBars?: number;
    /** Leave a silence between plays, `min` to `max` seconds (picked at random each time) */
    gap?: { min: number; max: number };
  }>;
  /**
   * `quantize` 'phrase': the next `phraseBars` bars counted from the state's start; 'end': where its
   * loop (or piece) ends. A 'bridge' plays `file` on the line and the new state `bridgeSeconds` later.
   */
  transitions: Array<{ from: string; to: string; kind: TransitionKind; quantize: NonNullable<TransitionRule['quantize']>; phraseBars?: number; beats?: number; file?: string; leadInSeconds?: number; stinger?: string; bridgeBars?: number; bridgeSeconds?: number }>;
  /** `bridgeSeconds`: how long a stinger bridging a switch holds the new state back */
  stingers: Array<{ name: string; kind: string; label: string; file: string; quantize: 'beat'; bridgeBars: number; bridgeSeconds: number }>;
  /**
   * Sound effects: each with its variations' files (a player picks a different one each time) and
   * whether it's a seamless loop (an engine, the rain) that plays until stopped.
   */
  sfx?: Array<{ name: string; files: string[]; loop: boolean; seconds: number }>;
}

/**
 * Render everything the game needs and describe it. `onProgress` hears 0 to 1 and what's being
 * made. Used by the export (zipped, with the players) and by the Game preview's audition pads,
 * which play these same sounds with the same web player.
 */
export async function buildGameKitParts(
  song: GameKitSong,
  onProgress?: (fraction: number, detail: string) => void,
  sampleRate: SampleRate = 44100,
  /** Leave out each state's whole mix when it has stems (a player that mixes the stems never needs it) */
  stemsOnly = false
): Promise<GameKitParts> {
  const meterMap: MeterMap = { base: song.meter ?? FOUR_FOUR, points: song.meterPoints ?? [] };
  const sections = songSections(song.clips, song.markers, meterMap);
  if (!sections.length) throw new Error('the timeline is empty');
  const files: ZipEntry[] = [];
  const key = detectKey(song.clips, song.tracks);
  const tempo: TempoMap = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  const secondsPerBar = 240 / song.bpm;
  // Stems: one per stem group in use (tracks without one go in Main), when any track has a group
  // (Buses aren't stems: their sound is in the stems of the tracks that play into them)
  const audible = audibleTracks(song.tracks).filter((t) => t.instrumentKey !== 'bus' && t.instrumentKey !== 'return');
  const groupNames = groupsInUse(audible);
  const stemGroups = groupNames.length
    ? [
        ...groupNames.map((name) => ({ name, tracks: audible.filter((t) => t.stemGroup === name) })),
        ...(audible.some((t) => !t.stemGroup) ? [{ name: MAIN_STEM, tracks: audible.filter((t) => !t.stemGroup) }] : []),
      ]
    : [];
  const skipMix = stemsOnly && stemGroups.length > 0;
  const gameSfx = song.sfx ?? [];
  const costumes = (song.costumes ?? []).map((c) => ({ costume: c, ...applyCostume(song.tracks, song.clips, c) }));
  const steps = sections.length * (stemGroups.length && !skipMix ? 2 : 1) * (1 + costumes.length) + song.stingers.length + gameSfx.length + 4;
  let step = 0;
  let current = '';
  const tick = (detail: string) => {
    current = detail;
    onProgress?.(step++ / steps, detail);
  };
  /** How far through the step just begun (a long state's render moves the bar as it goes). */
  const within = (f: number) => onProgress?.((step - 1 + Math.max(0, Math.min(1, f))) / steps, current);

  // States: each section a seamless loop (and its stems), named after its marker
  const states: AudioManifest['states'] = [];
  const stateOfMarker = new Map<string, string>();
  const sectionOfMarker = new Map<string, (typeof sections)[number]>();
  const usedNames = new Set<string>();
  for (const sec of sections) {
    tick(`state ${sec.name}`);
    // Unique as a file name too: 'Boss/Fight' and 'Boss-Fight' make the same one
    let name = sec.name;
    for (let n = 2; usedNames.has(safe(name)); n++) name = `${sec.name} ${n}`;
    usedNames.add(safe(name));
    // (Sections start on the 16th grid; a marker a hair off it is still this state's)
    const marker = song.markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - sec.from) < 1 / 32);
    if (marker) {
      stateOfMarker.set(marker.id, name);
      sectionOfMarker.set(marker.id, sec);
    }
    const range = { tracks: song.tracks, clips: song.clips, bpm: song.bpm, tempoPoints: song.tempoPoints, swing: song.swing, masterFx: song.masterFx, master: song.master, startBar: sec.from, endBar: sec.to, sampleRate };
    const file = `states/${safe(name)}.wav`;
    const seconds = secondsBetween(sec.from, sec.to, tempo);
    let samples = Math.round(seconds * sampleRate);
    if (!skipMix) {
      const audio = await renderArrangement({ ...range, ending: 'seamless' }, within);
      const channels = channelsOf(audio);
      samples = channels[0].length;
      files.push({ name: file, data: encodeChannels(channels, audio.sampleRate, 16, [], { start: 0, end: channels[0].length }) });
    }
    const stems: AudioManifest['states'][number]['stems'] = [];
    if (stemGroups.length) {
      if (!skipMix) tick(`stems ${name}`);
      const r = await renderGroupStems(range, stemGroups, within);
      for (const [k, stem] of r.stems.entries()) {
        const stemFile = `stems/${safe(name)}/${safe(stem.name)}.wav`;
        files.push({ name: stemFile, data: encodeChannels(stem.channels, r.sampleRate, 16, [], { start: 0, end: stem.channels[0].length }, ditherSeedOf(stem.name)) });
        stems.push({ group: stem.name, file: stemFile, tracks: stemGroups[k].tracks.map((t) => t.name) });
      }
    }
    // The state in each costume: the same bars, other instruments (and maybe another tempo)
    const dressed: NonNullable<AudioManifest['states'][number]['costumes']> = [];
    for (const d of costumes) {
      tick(`state ${name} (${d.costume.name})`);
      const t = d.costume.tempo;
      const byId = new Map(d.tracks.map((x) => [x.id, x]));
      const crange = { ...range, tracks: d.tracks, clips: d.clips, bpm: song.bpm * t, tempoPoints: (song.tempoPoints ?? []).map((p) => ({ ...p, bpm: p.bpm * t })) };
      const base = `${safe(name)} (${safe(d.costume.name)})`;
      let cfile: string | undefined;
      if (!skipMix || !stemGroups.length) {
        const audio = await renderArrangement({ ...crange, ending: 'seamless' }, within);
        const channels = channelsOf(audio);
        cfile = `states/${base}.wav`;
        files.push({ name: cfile, data: encodeChannels(channels, audio.sampleRate, 16, [], { start: 0, end: channels[0].length }) });
      }
      const cstems: Array<{ group: string; file: string }> = [];
      if (stemGroups.length) {
        // Each group's tracks as dressed, without the ones the costume leaves out
        const groups = stemGroups.map((g) => ({ name: g.name, tracks: g.tracks.map((x) => byId.get(x.id) ?? x).filter((x) => !x.isMuted) })).filter((g) => g.tracks.length);
        if (groups.length) {
          const rs = await renderGroupStems(crange, groups);
          for (const stem of rs.stems) {
            const stemFile = `stems/${base}/${safe(stem.name)}.wav`;
            files.push({ name: stemFile, data: encodeChannels(stem.channels, rs.sampleRate, 16, [], { start: 0, end: stem.channels[0].length }, ditherSeedOf(stem.name)) });
            cstems.push({ group: stem.name, file: stemFile });
          }
        }
      }
      dressed.push({ name: d.costume.name, tempo: t, ...(cfile ? { file: cfile } : {}), seconds: +(seconds / t).toFixed(6), stems: cstems });
    }
    const opts = marker ? song.stateOptions?.[marker.id] : undefined;
    const stateBpm = tempoAt(sec.from, tempo);
    const meter = meterAt(sec.from, meterMap);
    states.push({
      name,
      file,
      bars: sec.to - sec.from,
      seconds: +seconds.toFixed(6),
      samples,
      bpm: +stateBpm.toFixed(2),
      timeSignature: [meter.num, meter.den],
      beatsPerBar: meter.num,
      beatSeconds: +((60 / stateBpm) * (4 / meter.den)).toFixed(6),
      stems,
      ...(dressed.length ? { costumes: dressed } : {}),
      ...(opts?.shuffleBars ? { shuffleBars: opts.shuffleBars } : {}),
      ...(opts?.gap ? { gap: opts.gap } : {}),
    });
  }

  // Stingers (some also bridge transitions)
  const stingers: AudioManifest['stingers'] = [];
  const stingerName = new Map<string, string>();
  const stingerFiles = new Set<string>();
  for (const s of song.stingers) {
    tick(`stinger ${s.name}`);
    let base = safe(s.name);
    for (let n = 2; stingerFiles.has(base); n++) base = `${safe(s.name)} ${n}`;
    stingerFiles.add(base);
    const file = `stingers/${base}.wav`;
    files.push({ name: file, data: await renderStinger(s, song, sampleRate) });
    stingers.push({ name: s.name, kind: s.kind, label: stingerKind(s.kind).label, file, quantize: 'beat', bridgeBars: Math.max(1, Math.ceil(s.lengthBars - 1e-6)), bridgeSeconds: +(Math.max(1, Math.ceil(s.lengthBars - 1e-6)) * secondsPerBar).toFixed(6) });
    stingerName.set(s.id, s.name);
  }

  // Transitions: the matrix by state name, and one sound per fill / riser / impact in use
  tick('transitions');
  const cueFiles = new Map<TransitionKind, { file: string; leadInSeconds: number }>();
  const bridgeFiles = new Map<string, { file: string; bridgeBars: number; bridgeSeconds: number }>();
  const transitions: AudioManifest['transitions'] = [];
  for (const [k, rule] of Object.entries(song.transitions)) {
    const [fromId, toId] = k.split('>');
    const from = fromId === ANY_STATE ? '*' : stateOfMarker.get(fromId);
    const to = stateOfMarker.get(toId);
    if (!from || !to) continue;
    const entry: AudioManifest['transitions'][number] = { from, to, kind: rule.kind, quantize: rule.quantize ?? 'bar' };
    if (rule.quantize === 'phrase') entry.phraseBars = rule.phraseBars ?? 4;
    if (rule.kind === 'bridge') {
      const sec = sectionOfMarker.get(toId);
      if (!sec) continue;
      const bars = rule.bridgeBars ?? 1;
      const key = `${toId}:${bars}`;
      if (!bridgeFiles.has(key)) {
        const made = bridgeFor(song, sec, bars, tempo, meterMap);
        if (!made) {
          // Nothing to play it on: a plain switch
          entry.kind = 'cut';
          transitions.push(entry);
          continue;
        }
        const file = `transitions/bridge into ${safe(to)}${bars > 1 ? ` (${bars} bars)` : ''}.wav`;
        const audio = await renderArrangement({ tracks: song.tracks, clips: made.clips, bpm: made.bpm, swing: song.swing, masterFx: song.masterFx, master: song.master, startBar: 1, endBar: 1 + made.lengthBars, sampleRate });
        const channels = channelsOf(audio);
        files.push({ name: file, data: encodeChannels(channels, audio.sampleRate, 16, [], undefined) });
        bridgeFiles.set(key, { file, bridgeBars: bars, bridgeSeconds: +((made.lengthBars * 240) / made.bpm).toFixed(6) });
      }
      Object.assign(entry, bridgeFiles.get(key));
    }
    if (rule.kind === 'crossfade') entry.beats = rule.beats ?? 4;
    if (rule.kind === 'stinger') {
      const name = rule.stingerId ? stingerName.get(rule.stingerId) : undefined;
      if (!name) continue;
      entry.stinger = name;
    }
    if (rule.kind === 'fill' || rule.kind === 'riser' || rule.kind === 'impact') {
      if (!cueFiles.has(rule.kind)) {
        const cue = transitionCue(rule.kind, song.tracks)!;
        const sound: Stinger = {
          id: rule.kind,
          name: rule.kind,
          kind: 'checkpoint',
          instrumentKey: cue.instrumentKey,
          variation: 0,
          notes: cue.notes.map((n) => ({ ...n, startOffset: n.startOffset + cue.leadIn })),
          lengthBars: Math.max(0.25, cue.leadIn, Math.max(...cue.notes.map((n) => n.startOffset + cue.leadIn)) + 0.25),
        };
        const file = `transitions/${rule.kind}.wav`;
        files.push({ name: file, data: await renderStinger(sound, song, sampleRate) });
        cueFiles.set(rule.kind, { file, leadInSeconds: +(cue.leadIn * secondsPerBar).toFixed(6) });
      }
      Object.assign(entry, cueFiles.get(rule.kind));
    }
    transitions.push(entry);
  }

  // Sound effects: every variation as a file (levelled like the maker makes them: a classic sound
  // 16-bit mono, a modern one 24-bit stereo), after the recordings they layer have loaded
  const sfx: NonNullable<AudioManifest['sfx']> = [];
  await ensureSfxRecordings(gameSfx.map((g) => g.sound));
  for (const g of gameSfx) {
    tick(`sound effect ${g.name}`);
    const variants = Math.max(1, g.variations);
    const names: string[] = [];
    let seconds = 0;
    for (let i = 0; i < variants; i++) {
      const channels = renderSfxStereo(varySfx(g.sound, i, g.spread), sampleRate);
      const samples = channels[0];
      const file = `sfx/${g.name}${variants > 1 ? `_${String(i + 1).padStart(2, '0')}` : ''}.wav`;
      files.push({ name: file, data: encodeChannels(channels, sampleRate, g.sound.modern ? 24 : 16, [], g.sound.loop ? { start: 0, end: samples.length } : undefined) });
      names.push(file);
      seconds = Math.max(seconds, samples.length / sampleRate);
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
    }
    sfx.push({ name: g.name, files: names, loop: g.sound.loop, seconds: +seconds.toFixed(4) });
  }

  const manifest: AudioManifest = {
    format: 'fledgetone-audio-manifest',
    version: 2,
    name: song.name,
    bpm: song.bpm,
    timeSignature: [song.meter?.num ?? 4, song.meter?.den ?? 4],
    beatsPerBar: song.meter?.num ?? 4,
    beatSeconds: +((60 / song.bpm) * (4 / (song.meter?.den ?? 4))).toFixed(6),
    sampleRate,
    key: key?.name ?? null,
    // Each group's recommended level (0 to 1) at each intensity (0 to 1); Main always plays at 1
    intensity: {
      default: song.intensity,
      groups: stemGroups.map((g) => ({ name: g.name, curve: g.name === MAIN_STEM && !groupNames.includes(MAIN_STEM) ? [[0, 1], [1, 1]] : (song.intensityCurves[g.name] ?? defaultCurve(g.name)) })),
    },
    ...(song.gameParams?.length ? { parameters: song.gameParams.map(manifestParam) } : {}),
    states,
    transitions,
    stingers,
    ...(sfx.length ? { sfx } : {}),
  };
  onProgress?.(1, 'done');
  return { manifest, files };
}

/**
 * How the kit's zip is laid out: 'any' is one folder with every player; 'godot' and 'unity' unzip
 * straight into a project (its root folder), with the player and an example scene in place.
 */
export const KIT_LAYOUTS = ['any', 'godot', 'unity'] as const;
export type KitLayout = (typeof KIT_LAYOUTS)[number];

const json = (v: unknown) => new Blob([JSON.stringify(v, null, 2)], { type: 'application/json' });
const text = (v: string, type = 'text/plain') => new Blob([v], { type });

/** Build the kit as a .zip: the parts, the manifest, the players (or one engine's) and a README. */
export async function buildGameKit(song: GameKitSong, onProgress?: (fraction: number, detail: string) => void, sampleRate: SampleRate = 44100, layout: KitLayout = 'any'): Promise<Blob> {
  const { manifest, files } = await buildGameKitParts(song, (f, d) => onProgress?.(f * 0.97, d), sampleRate);
  const out: ZipEntry[] = [];
  if (layout === 'godot') {
    const slug = sfxFileName(manifest.name);
    const dir = `bos_music/${slug}`;
    out.push(...files.map((f) => ({ ...f, name: `${dir}/${f.name}` })));
    out.push({ name: `${dir}/audio_manifest.json`, data: json(manifest) });
    out.push({ name: 'bos_music/AdaptiveMusic.gd', data: text(godotPlayer) });
    out.push({ name: 'bos_music/music_example.gd', data: text(godotExample) });
    out.push({ name: `bos_music/${slug}_example.tscn`, data: text(godotScene(dir)) });
    out.push({ name: `bos_music/README_${slug}.md`, data: text(godotReadme(manifest, slug), 'text/markdown') });
  } else if (layout === 'unity') {
    const folder = manifest.name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Song';
    const resources = `BosMusic/${folder}`;
    out.push(...files.map((f) => ({ ...f, name: `Assets/Fledgetone/Resources/${resources}/${f.name}` })));
    out.push({ name: `Assets/Fledgetone/Resources/${resources}/audio_manifest.json`, data: json(manifest) });
    out.push({ name: 'Assets/Fledgetone/AdaptiveMusic.cs', data: text(unityPlayer.replace('public string resourcesFolder = "Music";', `public string resourcesFolder = "${resources}";`)) });
    out.push({ name: 'Assets/Fledgetone/AdaptiveMusicExample.cs', data: text(unityExample) });
    out.push({ name: `Assets/Fledgetone/README_${folder}.md`, data: text(unityReadme(manifest, resources), 'text/markdown') });
  } else {
    out.push(...files);
    out.push({ name: 'audio_manifest.json', data: json(manifest) });
    out.push({ name: 'players/web/adaptive-music.js', data: text(webPlayer, 'text/javascript') });
    out.push({ name: 'players/godot/AdaptiveMusic.gd', data: text(godotPlayer) });
    out.push({ name: 'players/godot/music_example.gd', data: text(godotExample) });
    out.push({ name: 'players/unity/AdaptiveMusic.cs', data: text(unityPlayer) });
    out.push({ name: 'players/unity/AdaptiveMusicExample.cs', data: text(unityExample) });
    out.push({ name: 'README.txt', data: text(readme(manifest)) });
  }
  out.push({ name: EXPORTED_FILES_LICENCE_NAME, data: text(EXPORTED_FILES_LICENCE) });
  onProgress?.(1, 'zip');
  return createZip(out);
}

/** A Godot 4 scene: the player (pointed at the song's folder), the example script and its help text. */
function godotScene(dir: string): string {
  return `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://bos_music/music_example.gd" id="1"]
[ext_resource type="Script" path="res://bos_music/AdaptiveMusic.gd" id="2"]

[node name="MusicExample" type="Node"]
script = ExtResource("1")

[node name="Music" type="Node" parent="."]
script = ExtResource("2")
music_dir = "res://${dir}/"

[node name="Help" type="Label" parent="."]
offset_left = 24.0
offset_top = 24.0
offset_right = 824.0
offset_bottom = 624.0
`;
}

/** What a game can call, with this song's own names in the examples. */
function callNames(m: AudioManifest) {
  const states = m.states.map((s) => s.name);
  return { first: states[0] ?? 'Main', second: states[1] ?? states[0] ?? 'Main', sting: m.stingers[0]?.name, sfx: m.sfx?.[0]?.name, loop: m.sfx?.find((s) => s.loop)?.name };
}

/** The README line that swaps costumes, in each engine's words (none when the kit has none). */
function costumeLine(m: AudioManifest, lang: 'js' | 'gd' | 'cs'): string {
  const c = m.states[0]?.costumes?.[0]?.name;
  if (!c) return '';
  if (lang === 'gd') return `\nMusic.set_costume("${c}")       # the same music another way ("" to go back)`;
  if (lang === 'cs') return `\nmusic.SetCostume("${c}");       // the same music another way (null to go back)`;
  return `\n    music.setCostume('${c}');       // the same music another way (null to go back)`;
}

/** The README line that sets a parameter, in each engine's words (none when the song has none). */
function paramLine(m: AudioManifest, lang: 'js' | 'gd' | 'cs'): string {
  const p = m.parameters?.[0]?.name;
  if (!p) return '';
  if (lang === 'gd') return `\nMusic.set_parameter("${p}", 0.7)  # 0 to 1: moves what it was set up to move`;
  if (lang === 'cs') return `\nmusic.SetParameter("${p}", 0.7f); // 0 to 1: moves what it was set up to move`;
  return `\n    music.setParameter('${p}', 0.7); // 0 to 1: moves what it was set up to move`;
}

const TARGET_WORDS: Record<string, string> = { intensity: 'intensity', filter: 'filter', reverb: 'reverb', volume: 'volume', layer: 'layer' };

function inventory(m: AudioManifest): string {
  const lines = [`- **States** (each loops until you switch): ${m.states.map((s) => s.name).join(', ')}`];
  if (m.intensity.groups.length) lines.push(`- **Intensity layers**: ${m.intensity.groups.map((g) => g.name).join(', ')}`);
  if (m.stingers.length) lines.push(`- **Stingers**: ${m.stingers.map((s) => s.name).join(', ')}`);
  if (m.sfx?.length) lines.push(`- **Sound effects**: ${m.sfx.map((s) => `${s.name}${s.files.length > 1 ? ` (${s.files.length} variations)` : ''}${s.loop ? ' (loop)' : ''}`).join(', ')}`);
  const costumes = m.states[0]?.costumes?.map((c) => c.name) ?? [];
  if (costumes.length) lines.push(`- **Costumes** (the same music played another way, swapped mid-loop): ${costumes.join(', ')}`);
  if (m.parameters?.length) lines.push(`- **Parameters** (0 to 1, set by the game): ${m.parameters.map((p) => `${p.name} (moves ${[...new Set(p.targets.map((t) => (t.target === 'layer' ? `the ${t.group} layer` : TARGET_WORDS[t.target])))].join(', ') || 'nothing yet'}; starts at ${p.default})`).join('; ')}`);
  const shaped = m.states.filter((s) => s.shuffleBars || s.gap);
  if (shaped.length) lines.push(`- **Played in pieces**: ${shaped.map((s) => `${s.name} (${[s.shuffleBars ? `${s.shuffleBars}-bar pieces shuffled` : '', s.gap ? `${s.gap.min}-${s.gap.max} s silences` : ''].filter(Boolean).join(', ')})`).join('; ')}`);
  lines.push('- **Effects** (no files needed): underwater, muffled, lowHealth, dream, none');
  return lines.join('\n');
}

function godotReadme(m: AudioManifest, slug: string): string {
  const c = callNames(m);
  return `# ${m.name}: music${m.sfx?.length ? ' and sound effects' : ''} for Godot 4

Made with Fledgetone. ${m.bpm} BPM.

${inventory(m)}

## Try it (two minutes)

1. Unzip this into your Godot project's folder (the one with \`project.godot\` in it). You get a \`bos_music\` folder.
2. Open the project in Godot. It imports the sounds by itself.
3. In the FileSystem panel, open \`bos_music/${slug}_example.tscn\` and press **F6** (Run Current Scene).
4. Press **1**, **2**... to switch states, **Up** / **Down** for intensity${c.sting ? ', **Space** for a stinger' : ''}${m.sfx?.length ? ', **A**, **B**... for the sound effects' : ''}.

## Use it in your game

1. **Project › Project Settings › Globals › Autoload**: pick \`res://bos_music/AdaptiveMusic.gd\`, name it \`Music\`, **Add**.
2. Load the song once when your game starts (in your first scene's \`_ready()\`):

\`\`\`gdscript
Music.load_song("res://bos_music/${slug}/")
Music.play("${c.first}")
\`\`\`

3. Then anywhere in your game:

\`\`\`gdscript
Music.set_state("${c.second}")         # switches on the beat, the way the song's transitions say
Music.set_intensity(0.7)              # 0 to 1: the layers fade in and out
Music.set_effect("underwater")        # or "muffled", "lowHealth", "dream", "none"${costumeLine(m, 'gd')}${paramLine(m, 'gd')}${c.sting ? `\nMusic.stinger("${c.sting}")         # plays over the music on the next beat` : ''}${c.sfx ? `\nMusic.play_sfx("${c.sfx}")          # a different variation each time` : ''}${c.loop ? `\nvar hum = Music.play_sfx("${c.loop}") # loops until hum.stop()` : ''}
Music.stop()
\`\`\`

Sound effects play on the bus named in **sfx_bus** (Master unless you change it): make an "SFX" bus in the Audio panel to give them their own volume slider.
`;
}

function unityReadme(m: AudioManifest, resources: string): string {
  const c = callNames(m);
  return `# ${m.name}: music${m.sfx?.length ? ' and sound effects' : ''} for Unity

Made with Fledgetone. ${m.bpm} BPM.

${inventory(m)}

## Try it (two minutes)

1. Unzip this into your Unity project's folder (the one with the \`Assets\` folder in it). Everything lands in \`Assets/Fledgetone\`.
2. Go back to Unity: it imports the sounds by itself.
3. Make an empty GameObject (**GameObject › Create Empty**), and in the Inspector **Add Component › Adaptive Music Example** (it adds Adaptive Music too).
4. Press **Play**: buttons for every state${c.sting ? ' and stinger' : ''}${m.sfx?.length ? ' and sound effect' : ''}, and an intensity slider.

## Use it in your game

Put the **Adaptive Music** component on a GameObject (its **Resources Folder** is \`${resources}\`, this song), then from any script:

\`\`\`csharp
var music = FindObjectOfType<AdaptiveMusic>();
music.Play("${c.first}");
music.SetState("${c.second}");         // switches on the beat, the way the song's transitions say
music.SetIntensity(0.7f);             // 0 to 1: the layers fade in and out
music.SetEffect("underwater");        // or "muffled", "lowHealth", "dream", "none"${costumeLine(m, 'cs')}${paramLine(m, 'cs')}${c.sting ? `\nmusic.Stinger("${c.sting}");         // plays over the music on the next beat` : ''}${c.sfx ? `\nmusic.PlaySfx("${c.sfx}");          // a different variation each time` : ''}${c.loop ? `\nmusic.PlaySfx("${c.loop}");          // loops until music.StopSfx("${c.loop}")` : ''}
music.Stop();
\`\`\`

Changes are scheduled on Unity's audio clock, so they land exactly on the beat. **Volume** and **Sfx Volume** on the component set the music's and the sound effects' levels. Another song exported for Unity goes in its own folder under \`Resources/BosMusic\`: set **Resources Folder** to switch.
`;
}

function readme(m: AudioManifest): string {
  const { name, bpm } = m;
  const [tsNum, tsDen] = m.timeSignature ?? [4, 4];
  const barSeconds = (60 / bpm) * (4 / tsDen) * tsNum;
  const states = m.states.map((s) => s.name);
  const stingers = m.stingers.map((s) => s.name);
  const first = states[0] ?? 'Main';
  const second = states[1] ?? first;
  const sting = stingers[0];
  const stems = m.intensity.groups.map((g) => g.name);
  return `${name}: game music kit, made with Fledgetone
${'='.repeat(name.length + 49)}

${bpm} BPM, ${tsNum}/${tsDen}.
States (each a seamless loop): ${states.join(', ')}
${stems.length ? `Stem groups (crossfaded by intensity): ${stems.join(', ')}\n` : ''}${stingers.length ? `Stingers: ${stingers.join(', ')}\n` : ''}
What's here
-----------
audio_manifest.json  Everything the players need: tempo, time signature, every state (its loop,
                     its stems, its length in bars, seconds and samples), the transition rules
                     between states, every stinger, and each stem group's intensity curve
                     ([intensity, level] points, both 0 to 1).
states/              One seamless loop per state (the whole mix), with loop points.
stems/<state>/       The same loop split by stem group, all the same length: played together at
                     full level they make the mix. Mix them by the curves to follow intensity.
transitions/         Fill, riser and impact sounds. A fill or riser starts leadInSeconds before
                     the switch; an impact on it.
stingers/            Short cues to play over the music (or to bridge a switch: bridgeBars long).
sfx/                 Sound effects, each with its variations (_01, _02...): pick a different one
                     each time it plays. Looping ones (an engine, the rain) carry loop points.
players/             Ready-made players that do all of the above, and an example for each engine
                     (music_example.gd, AdaptiveMusicExample.cs). Export the game kit "for Godot"
                     or "for Unity" to get a folder that unzips straight into your project.

Transition rules: from a state (or * for any) to a state: cut, crossfade (over beats), stinger
(it plays, then the new state starts after bridgeBars), fill, riser or impact, on the next bar,
the next beat, or at once. A switch with no rule cuts on the next bar.

Web (players/web/adaptive-music.js)
    import { AdaptiveMusic } from './adaptive-music.js';
    const music = new AdaptiveMusic();
    await music.load('path/to/this/folder/');
    music.play('${first}');            // after the player clicks or presses a key
    music.setState('${second}');
    music.setIntensity(0.7);
    music.setEffect('underwater');     // or 'muffled', 'lowHealth', 'dream', 'none'${costumeLine(m, 'js')}${paramLine(m, 'js')}${sting ? `\n    music.stinger('${sting}');` : ''}${m.sfx?.length ? `\n    music.playSfx('${m.sfx[0].name}');      // sound effects: a different variation each time` : ''}

Godot 4 (players/godot/AdaptiveMusic.gd)
    Copy this folder to res://music/, add the script as an autoload called Music, call
    Music.load_song("res://music/") once, then Music.play("${first}"), Music.set_state("${second}"), Music.set_intensity(0.7)${sting ? `, Music.stinger("${sting}")` : ''}${m.sfx?.length ? `, Music.play_sfx("${m.sfx[0].name}")` : ''}.

Unity (players/unity/AdaptiveMusic.cs)
    Copy this folder to Assets/Resources/Music/, add the AdaptiveMusic component, then
    music.Play("${first}"), music.SetState("${second}"), music.SetIntensity(0.7f)${sting ? `, music.Stinger("${sting}")` : ''}${m.sfx?.length ? `, music.PlaySfx("${m.sfx[0].name}")` : ''}.
    Changes are scheduled on the audio clock (PlayScheduled), so they land on the beat exactly.

Other engines and middleware (FMOD, Wwise...): the loops are exact, so set each as a looping
sound and switch at bar lines (every ${barSeconds.toFixed(4)} s).
`;
}

/**
 * The clips of a bridge into a state (see bridgeNotes): its chords on the song's chord part, the
 * bass on its bass part, the fill on its drums, at the state's tempo and in its time signature.
 * Null when the song has nothing pitched to lead in with.
 */
export function bridgeFor(song: GameKitSong, sec: { from: number }, bars: 1 | 2, tempo: TempoMap, meterMap: MeterMap): { clips: Clip[]; lengthBars: number; bpm: number } | null {
  const meter = meterAt(sec.from, meterMap);
  const measure = meter.num / meter.den;
  const beat = 1 / meter.den;
  const audible = audibleTracks(song.tracks).filter((t) => INSTRUMENTS[t.instrumentKey] && t.instrumentKey !== 'bus' && t.instrumentKey !== 'return');
  const pitched = audible.filter((t) => !isDrumKind(t.instrumentKey) && INSTRUMENTS[t.instrumentKey].kind !== 'audio' && t.instrumentKey !== 'fx' && !isDropKind(t.instrumentKey));
  if (!pitched.length) return null;
  // What each pitched part plays over the state's first measure
  const opening = new Map<string, Array<{ midi: number; at: number }>>();
  for (const c of song.clips) {
    if (c.audio || !pitched.some((t) => t.id === c.trackId)) continue;
    for (const n of c.notes) {
      const at = c.startBar + n.startOffset - sec.from;
      if (at < -1e-6 || at >= measure - 1e-6 || n.startOffset >= c.lengthBars) continue;
      const midi = midiOf(n.note);
      if (!Number.isFinite(midi)) continue;
      const list = opening.get(c.trackId) ?? [];
      list.push({ midi, at });
      opening.set(c.trackId, list);
    }
  }
  const all = [...opening.values()].flat();
  const avg = (id: string) => {
    const l = opening.get(id);
    return l?.length ? l.reduce((a, n) => a + n.midi, 0) / l.length : Infinity;
  };
  const bassTrack = pitched.find((t) => INSTRUMENTS[t.instrumentKey].category === 'Bass' && opening.has(t.id)) ?? [...pitched].filter((t) => opening.has(t.id)).sort((a, b) => avg(a.id) - avg(b.id))[0];
  // The chords on the part that plays most notes at once (the busiest pitched part but the bass)
  const chordTrack =
    [...pitched].filter((t) => t !== bassTrack && opening.has(t.id)).sort((a, b) => opening.get(b.id)!.length - opening.get(a.id)!.length)[0] ??
    pitched.find((t) => t !== bassTrack && /pad|keys|piano|strings|organ|guitar/i.test(INSTRUMENTS[t.instrumentKey].category + t.instrumentKey));
  if (!chordTrack && !bassTrack) return null;
  const notes = bridgeNotes(bridgeTarget(all, beat), bars, measure, meter.num);
  const fit = (list: Clip['notes'], key: Track['instrumentKey']) => {
    const range = INSTRUMENTS[key]?.range;
    if (!range) return list;
    return list.map((n) => {
      let m = midiOf(n.note);
      while (m < range[0] && m + 12 <= range[1]) m += 12;
      while (m > range[1] && m - 12 >= range[0]) m -= 12;
      return { ...n, note: nameOf(m) };
    });
  };
  const clip = (track: Track, list: Clip['notes']): Clip => ({ id: `bridge-${track.id}`, trackId: track.id, name: 'Bridge', startBar: 1, lengthBars: notes.lengthBars, notes: list, isSelected: false });
  const clips: Clip[] = [];
  if (chordTrack) clips.push(clip(chordTrack, fit(notes.chords, chordTrack.instrumentKey)));
  if (bassTrack) clips.push(clip(bassTrack, fit(notes.bass, bassTrack.instrumentKey)));
  const drums = audible.find((t) => isDrumKind(t.instrumentKey));
  if (drums) clips.push(clip(drums, notes.drums));
  return { clips, lengthBars: notes.lengthBars, bpm: tempoAt(sec.from, tempo) };
}
