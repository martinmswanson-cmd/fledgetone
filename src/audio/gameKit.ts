import { renderArrangement, renderGroupStems, audibleTracks, encodeChannels, channelsOf, type SampleRate } from './exportWav';
import { defaultCurve, groupsInUse, type IntensityCurve } from '../store/intensity';
import { renderStinger } from './stingerPlayer';
import { createZip, type ZipEntry } from './zip';
import { songSections } from '../store/cutToLength';
import { detectKey } from '../store/songKey';
import { ANY_STATE, transitionCue } from '../store/transitions';
import { stingerKind } from '../store/stingers';
import type { Clip, Marker, MasterFx, MasterSettings, Stinger, Track, TransitionKind, TransitionRule } from '../store/timelineTypes';
import webPlayer from '../gameKit/adaptive-music.js?raw';
import godotPlayer from '../gameKit/AdaptiveMusic.gd?raw';
import unityPlayer from '../gameKit/AdaptiveMusic.cs?raw';

/**
 * The game kit: everything a game needs to play the song the way the Game preview does, in one
 * .zip. Every state (section) as a seamless loop (and its stems), the stingers, the transitions, an
 * audio_manifest.json describing them (tempo, bars, the transition rules, the intensity curves), and ready-made
 * players for the web, Godot and Unity that read it and switch on the beat.
 */

export interface GameKitSong {
  name: string;
  bpm: number;
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
  sampleRate: number;
  key: string | null;
  intensity: { default: number; groups: Array<{ name: string; curve: IntensityCurve }> };
  states: Array<{ name: string; file: string; bars: number; seconds: number; samples: number; stems: Array<{ group: string; file: string; tracks: string[] }> }>;
  transitions: Array<{ from: string; to: string; kind: TransitionKind; quantize: 'bar' | 'beat' | 'now'; beats?: number; file?: string; leadInSeconds?: number; stinger?: string }>;
  stingers: Array<{ name: string; kind: string; label: string; file: string; quantize: 'beat'; bridgeBars: number }>;
}

/**
 * Render everything the game needs and describe it. `onProgress` hears 0 to 1 and what's being
 * made. Used by the export (zipped, with the players) and by the Game preview's audition pads,
 * which play these same sounds with the same web player.
 */
export async function buildGameKitParts(song: GameKitSong, onProgress?: (fraction: number, detail: string) => void, sampleRate: SampleRate = 44100): Promise<GameKitParts> {
  const sections = songSections(song.clips, song.markers);
  if (!sections.length) throw new Error('the timeline is empty');
  const files: ZipEntry[] = [];
  const key = detectKey(song.clips, song.tracks);
  const secondsPerBar = 240 / song.bpm;
  // Stems: one per stem group in use (tracks without one go in Main), when any track has a group
  const audible = audibleTracks(song.tracks);
  const groupNames = groupsInUse(audible);
  const stemGroups = groupNames.length
    ? [
        ...groupNames.map((name) => ({ name, tracks: audible.filter((t) => t.stemGroup === name) })),
        ...(audible.some((t) => !t.stemGroup) ? [{ name: MAIN_STEM, tracks: audible.filter((t) => !t.stemGroup) }] : []),
      ]
    : [];
  const steps = sections.length * (stemGroups.length ? 2 : 1) + song.stingers.length + 4;
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
    const marker = song.markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - sec.from) < 1e-6);
    if (marker) stateOfMarker.set(marker.id, name);
    const range = { tracks: song.tracks, clips: song.clips, bpm: song.bpm, swing: song.swing, masterFx: song.masterFx, master: song.master, startBar: sec.from, endBar: sec.to, sampleRate };
    const audio = await renderArrangement({ ...range, ending: 'seamless' });
    const channels = channelsOf(audio);
    const file = `states/${safe(name)}.wav`;
    files.push({ name: file, data: encodeChannels(channels, audio.sampleRate, 16, [], { start: 0, end: channels[0].length }) });
    const stems: AudioManifest['states'][number]['stems'] = [];
    if (stemGroups.length) {
      tick(`stems ${name}`);
      const r = await renderGroupStems(range, stemGroups);
      for (const [k, stem] of r.stems.entries()) {
        const stemFile = `stems/${safe(name)}/${safe(stem.name)}.wav`;
        files.push({ name: stemFile, data: encodeChannels(stem.channels, r.sampleRate, 16, [], { start: 0, end: stem.channels[0].length }) });
        stems.push({ group: stem.name, file: stemFile, tracks: stemGroups[k].tracks.map((t) => t.name) });
      }
    }
    states.push({ name, file, bars: sec.to - sec.from, seconds: +((sec.to - sec.from) * secondsPerBar).toFixed(6), samples: channels[0].length, stems });
  }

  // Stingers (some also bridge transitions)
  const stingers: AudioManifest['stingers'] = [];
  const stingerName = new Map<string, string>();
  for (const s of song.stingers) {
    tick(`stinger ${s.name}`);
    const file = `stingers/${safe(s.name)}.wav`;
    files.push({ name: file, data: await renderStinger(s, song, sampleRate) });
    stingers.push({ name: s.name, kind: s.kind, label: stingerKind(s.kind).label, file, quantize: 'beat', bridgeBars: Math.max(1, Math.ceil(s.lengthBars - 1e-6)) });
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

  const manifest: AudioManifest = {
    format: 'bos-beatbox-audio-manifest',
    version: 2,
    name: song.name,
    bpm: song.bpm,
    timeSignature: [4, 4],
    beatsPerBar: 4,
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
  };
  onProgress?.(1, 'done');
  return { manifest, files };
}

/** Build the kit as a .zip: the parts, the manifest, the players and a README. */
export async function buildGameKit(song: GameKitSong, onProgress?: (fraction: number, detail: string) => void, sampleRate: SampleRate = 44100): Promise<Blob> {
  const { manifest, files } = await buildGameKitParts(song, (f, d) => onProgress?.(f * 0.97, d), sampleRate);
  files.push({ name: 'audio_manifest.json', data: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) });
  files.push({ name: 'players/web/adaptive-music.js', data: new Blob([webPlayer], { type: 'text/javascript' }) });
  files.push({ name: 'players/godot/AdaptiveMusic.gd', data: new Blob([godotPlayer], { type: 'text/plain' }) });
  files.push({ name: 'players/unity/AdaptiveMusic.cs', data: new Blob([unityPlayer], { type: 'text/plain' }) });
  files.push({ name: 'README.txt', data: new Blob([readme(manifest)], { type: 'text/plain' }) });
  onProgress?.(1, 'zip');
  return createZip(files);
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
players/             Ready-made players that do all of the above.

Transition rules: from a state (or * for any) to a state: cut, crossfade (over beats), stinger
(it plays, then the new state starts after bridgeBars), fill, riser or impact, on the next bar,
the next beat, or at once. A switch with no rule cuts on the next bar.

Web (players/web/adaptive-music.js)
    import { AdaptiveMusic } from './adaptive-music.js';
    const music = new AdaptiveMusic();
    await music.load('path/to/this/folder/');
    music.play('${first}');            // after the player clicks or presses a key
    music.setState('${second}');
    music.setIntensity(0.7);${sting ? `\n    music.stinger('${sting}');` : ''}

Godot 4 (players/godot/AdaptiveMusic.gd)
    Copy this folder to res://music/, add the script as an autoload called Music, then
    Music.play("${first}"), Music.set_state("${second}"), Music.set_intensity(0.7)${sting ? `, Music.stinger("${sting}")` : ''}.

Unity (players/unity/AdaptiveMusic.cs)
    Copy this folder to Assets/Resources/Music/, add the AdaptiveMusic component, then
    music.Play("${first}"), music.SetState("${second}"), music.SetIntensity(0.7f)${sting ? `, music.Stinger("${sting}")` : ''}.
    Changes are scheduled on the audio clock (PlayScheduled), so they land on the beat exactly.

Other engines and middleware (FMOD, Wwise...): the loops are exact, so set each as a looping
sound and switch at bar lines (every ${(240 / bpm).toFixed(4)} s).
`;
}
