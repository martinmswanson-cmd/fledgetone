import { FOUR_FOUR, meterAt, secondsBetween, tempoAt, type Meter, type MeterMap, type MeterPoint, type TempoMap, type TempoPoint } from './tempoMap';
import { renderArrangement, renderGroupStems, audibleTracks, encodeChannels, channelsOf, type SampleRate } from './exportWav';
import { defaultCurve, groupsInUse, type IntensityCurve } from '../store/intensity';
import { renderStinger } from './stingerPlayer';
import { createZip, type ZipEntry } from './zip';
import { renderSfx, sfxFileName, varySfx } from './sfx/sfxSynth';
import type { GameSfx } from '../store/gameSfx';
import { songSections } from '../store/cutToLength';
import { detectKey } from '../store/songKey';
import { ANY_STATE, transitionCue } from '../store/transitions';
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
  }>;
  transitions: Array<{ from: string; to: string; kind: TransitionKind; quantize: 'bar' | 'beat' | 'now'; beats?: number; file?: string; leadInSeconds?: number; stinger?: string }>;
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
  const steps = sections.length * (stemGroups.length && !skipMix ? 2 : 1) + song.stingers.length + gameSfx.length + 4;
  let step = 0;
  const tick = (detail: string) => onProgress?.(step++ / steps, detail);

  // States: each section a seamless loop (and its stems), named after its marker
  const states: AudioManifest['states'] = [];
  const stateOfMarker = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const sec of sections) {
    tick(`state ${sec.name}`);
    let name = sec.name;
    for (let n = 2; usedNames.has(name); n++) name = `${sec.name} ${n}`;
    usedNames.add(name);
    // (Sections start on the 16th grid; a marker a hair off it is still this state's)
    const marker = song.markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - sec.from) < 1 / 32);
    if (marker) stateOfMarker.set(marker.id, name);
    const range = { tracks: song.tracks, clips: song.clips, bpm: song.bpm, tempoPoints: song.tempoPoints, swing: song.swing, masterFx: song.masterFx, master: song.master, startBar: sec.from, endBar: sec.to, sampleRate };
    const file = `states/${safe(name)}.wav`;
    const seconds = secondsBetween(sec.from, sec.to, tempo);
    let samples = Math.round(seconds * sampleRate);
    if (!skipMix) {
      const audio = await renderArrangement({ ...range, ending: 'seamless' });
      const channels = channelsOf(audio);
      samples = channels[0].length;
      files.push({ name: file, data: encodeChannels(channels, audio.sampleRate, 16, [], { start: 0, end: channels[0].length }) });
    }
    const stems: AudioManifest['states'][number]['stems'] = [];
    if (stemGroups.length) {
      if (!skipMix) tick(`stems ${name}`);
      const r = await renderGroupStems(range, stemGroups);
      for (const [k, stem] of r.stems.entries()) {
        const stemFile = `stems/${safe(name)}/${safe(stem.name)}.wav`;
        files.push({ name: stemFile, data: encodeChannels(stem.channels, r.sampleRate, 16, [], { start: 0, end: stem.channels[0].length }) });
        stems.push({ group: stem.name, file: stemFile, tracks: stemGroups[k].tracks.map((t) => t.name) });
      }
    }
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
    });
  }

  // Stingers (some also bridge transitions)
  const stingers: AudioManifest['stingers'] = [];
  const stingerName = new Map<string, string>();
  for (const s of song.stingers) {
    tick(`stinger ${s.name}`);
    const file = `stingers/${safe(s.name)}.wav`;
    files.push({ name: file, data: await renderStinger(s, song, sampleRate) });
    stingers.push({ name: s.name, kind: s.kind, label: stingerKind(s.kind).label, file, quantize: 'beat', bridgeBars: Math.max(1, Math.ceil(s.lengthBars - 1e-6)), bridgeSeconds: +(Math.max(1, Math.ceil(s.lengthBars - 1e-6)) * secondsPerBar).toFixed(6) });
    stingerName.set(s.id, s.name);
  }

  // Transitions: the matrix by state name, and one sound per fill / riser / impact in use
  tick('transitions');
  const cueFiles = new Map<TransitionKind, { file: string; leadInSeconds: number }>();
  const transitions: AudioManifest['transitions'] = [];
  for (const [k, rule] of Object.entries(song.transitions)) {
    const [fromId, toId] = k.split('>');
    const from = fromId === ANY_STATE ? '*' : stateOfMarker.get(fromId);
    const to = stateOfMarker.get(toId);
    if (!from || !to) continue;
    const entry: AudioManifest['transitions'][number] = { from, to, kind: rule.kind, quantize: rule.quantize ?? 'bar' };
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

  // Sound effects: every variation as a file (mono, levelled like the maker makes them)
  const sfx: NonNullable<AudioManifest['sfx']> = [];
  for (const g of gameSfx) {
    tick(`sound effect ${g.name}`);
    const variants = Math.max(1, g.variations);
    const names: string[] = [];
    let seconds = 0;
    for (let i = 0; i < variants; i++) {
      const samples = renderSfx(varySfx(g.sound, i, g.spread), sampleRate);
      const file = `sfx/${g.name}${variants > 1 ? `_${String(i + 1).padStart(2, '0')}` : ''}.wav`;
      files.push({ name: file, data: encodeChannels([samples], sampleRate, 16, [], g.sound.loop ? { start: 0, end: samples.length } : undefined) });
      names.push(file);
      seconds = Math.max(seconds, samples.length / sampleRate);
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
    }
    sfx.push({ name: g.name, files: names, loop: g.sound.loop, seconds: +seconds.toFixed(4) });
  }

  const manifest: AudioManifest = {
    format: 'bos-beatbox-audio-manifest',
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
    out.push(...files.map((f) => ({ ...f, name: `Assets/BosBeatbox/Resources/${resources}/${f.name}` })));
    out.push({ name: `Assets/BosBeatbox/Resources/${resources}/audio_manifest.json`, data: json(manifest) });
    out.push({ name: 'Assets/BosBeatbox/AdaptiveMusic.cs', data: text(unityPlayer.replace('public string resourcesFolder = "Music";', `public string resourcesFolder = "${resources}";`)) });
    out.push({ name: 'Assets/BosBeatbox/AdaptiveMusicExample.cs', data: text(unityExample) });
    out.push({ name: `Assets/BosBeatbox/README_${folder}.md`, data: text(unityReadme(manifest, resources), 'text/markdown') });
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

function inventory(m: AudioManifest): string {
  const lines = [`- **States** (each loops until you switch): ${m.states.map((s) => s.name).join(', ')}`];
  if (m.intensity.groups.length) lines.push(`- **Intensity layers**: ${m.intensity.groups.map((g) => g.name).join(', ')}`);
  if (m.stingers.length) lines.push(`- **Stingers**: ${m.stingers.map((s) => s.name).join(', ')}`);
  if (m.sfx?.length) lines.push(`- **Sound effects**: ${m.sfx.map((s) => `${s.name}${s.files.length > 1 ? ` (${s.files.length} variations)` : ''}${s.loop ? ' (loop)' : ''}`).join(', ')}`);
  return lines.join('\n');
}

function godotReadme(m: AudioManifest, slug: string): string {
  const c = callNames(m);
  return `# ${m.name}: music${m.sfx?.length ? ' and sound effects' : ''} for Godot 4

Made with Bo's Beatbox. ${m.bpm} BPM.

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
Music.set_intensity(0.7)              # 0 to 1: the layers fade in and out${c.sting ? `\nMusic.stinger("${c.sting}")         # plays over the music on the next beat` : ''}${c.sfx ? `\nMusic.play_sfx("${c.sfx}")          # a different variation each time` : ''}${c.loop ? `\nvar hum = Music.play_sfx("${c.loop}") # loops until hum.stop()` : ''}
Music.stop()
\`\`\`

Sound effects play on the bus named in **sfx_bus** (Master unless you change it): make an "SFX" bus in the Audio panel to give them their own volume slider.
`;
}

function unityReadme(m: AudioManifest, resources: string): string {
  const c = callNames(m);
  return `# ${m.name}: music${m.sfx?.length ? ' and sound effects' : ''} for Unity

Made with Bo's Beatbox. ${m.bpm} BPM.

${inventory(m)}

## Try it (two minutes)

1. Unzip this into your Unity project's folder (the one with the \`Assets\` folder in it). Everything lands in \`Assets/BosBeatbox\`.
2. Go back to Unity: it imports the sounds by itself.
3. Make an empty GameObject (**GameObject › Create Empty**), and in the Inspector **Add Component › Adaptive Music Example** (it adds Adaptive Music too).
4. Press **Play**: buttons for every state${c.sting ? ' and stinger' : ''}${m.sfx?.length ? ' and sound effect' : ''}, and an intensity slider.

## Use it in your game

Put the **Adaptive Music** component on a GameObject (its **Resources Folder** is \`${resources}\`, this song), then from any script:

\`\`\`csharp
var music = FindObjectOfType<AdaptiveMusic>();
music.Play("${c.first}");
music.SetState("${c.second}");         // switches on the beat, the way the song's transitions say
music.SetIntensity(0.7f);             // 0 to 1: the layers fade in and out${c.sting ? `\nmusic.Stinger("${c.sting}");         // plays over the music on the next beat` : ''}${c.sfx ? `\nmusic.PlaySfx("${c.sfx}");          // a different variation each time` : ''}${c.loop ? `\nmusic.PlaySfx("${c.loop}");          // loops until music.StopSfx("${c.loop}")` : ''}
music.Stop();
\`\`\`

Changes are scheduled on Unity's audio clock, so they land exactly on the beat. **Volume** and **Sfx Volume** on the component set the music's and the sound effects' levels. Another song exported for Unity goes in its own folder under \`Resources/BosMusic\`: set **Resources Folder** to switch.
`;
}

function readme(m: AudioManifest): string {
  const { name, bpm } = m;
  const states = m.states.map((s) => s.name);
  const stingers = m.stingers.map((s) => s.name);
  const first = states[0] ?? 'Main';
  const second = states[1] ?? first;
  const sting = stingers[0];
  const stems = m.intensity.groups.map((g) => g.name);
  return `${name}: game music kit, made with Bo's Beatbox
${'='.repeat(name.length + 49)}

${bpm} BPM, 4/4.
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
    music.setIntensity(0.7);${sting ? `\n    music.stinger('${sting}');` : ''}${m.sfx?.length ? `\n    music.playSfx('${m.sfx[0].name}');      // sound effects: a different variation each time` : ''}

Godot 4 (players/godot/AdaptiveMusic.gd)
    Copy this folder to res://music/, add the script as an autoload called Music, call
    Music.load_song("res://music/") once, then Music.play("${first}"), Music.set_state("${second}"), Music.set_intensity(0.7)${sting ? `, Music.stinger("${sting}")` : ''}${m.sfx?.length ? `, Music.play_sfx("${m.sfx[0].name}")` : ''}.

Unity (players/unity/AdaptiveMusic.cs)
    Copy this folder to Assets/Resources/Music/, add the AdaptiveMusic component, then
    music.Play("${first}"), music.SetState("${second}"), music.SetIntensity(0.7f)${sting ? `, music.Stinger("${sting}")` : ''}${m.sfx?.length ? `, music.PlaySfx("${m.sfx[0].name}")` : ''}.
    Changes are scheduled on the audio clock (PlayScheduled), so they land on the beat exactly.

Other engines and middleware (FMOD, Wwise...): the loops are exact, so set each as a looping
sound and switch at bar lines (every ${(240 / bpm).toFixed(4)} s).
`;
}
