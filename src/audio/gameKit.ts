import { renderArrangement, encodeChannels, channelsOf, type SampleRate } from './exportWav';
import { renderStinger } from './stingerPlayer';
import { createZip, type ZipEntry } from './zip';
import { songSections } from '../store/cutToLength';
import { detectKey } from '../store/songKey';
import { transitionCue } from '../store/transitions';
import { stingerKind } from '../store/stingers';
import type { Clip, Marker, MasterFx, MasterSettings, Stinger, Track, TransitionKind } from '../store/timelineTypes';
import webPlayer from '../gameKit/adaptive-music.js?raw';
import godotPlayer from '../gameKit/AdaptiveMusic.gd?raw';
import unityPlayer from '../gameKit/AdaptiveMusic.cs?raw';

/**
 * The game kit: everything a game needs to play the song the way the Game preview does, in one
 * .zip. Every state (section) as a seamless loop, the stingers, the transitions into states, a
 * music.json describing them (tempo, bars, which transition goes with which state), and ready-made
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
  transitions: Record<string, TransitionKind>;
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';

/** Build the kit; `onProgress` hears 0 to 1 and what's being made. */
export async function buildGameKit(song: GameKitSong, onProgress?: (fraction: number, detail: string) => void, sampleRate: SampleRate = 44100): Promise<Blob> {
  const sections = songSections(song.clips, song.markers);
  if (!sections.length) throw new Error('the timeline is empty');
  const files: ZipEntry[] = [];
  const key = detectKey(song.clips, song.tracks);
  const secondsPerBar = 240 / song.bpm;
  const steps = sections.length + song.stingers.length + 3;
  let step = 0;
  const tick = (detail: string) => onProgress?.(step++ / steps, detail);

  // States: each section a seamless loop
  const states = [];
  const usedNames = new Set<string>();
  for (const sec of sections) {
    tick(`state ${sec.name}`);
    let name = sec.name;
    for (let n = 2; usedNames.has(name); n++) name = `${sec.name} ${n}`;
    usedNames.add(name);
    const audio = await renderArrangement({ tracks: song.tracks, clips: song.clips, bpm: song.bpm, swing: song.swing, masterFx: song.masterFx, master: song.master, startBar: sec.from, endBar: sec.to, ending: 'seamless', sampleRate });
    const channels = channelsOf(audio);
    const file = `states/${safe(name)}.wav`;
    files.push({ name: file, data: encodeChannels(channels, audio.sampleRate, 16, [], { start: 0, end: channels[0].length }) });
    const marker = song.markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - sec.from) < 1e-6);
    const kind = (marker && song.transitions[marker.id]) || 'cut';
    states.push({ name, file, bars: sec.to - sec.from, seconds: +((sec.to - sec.from) * secondsPerBar).toFixed(6), kind });
  }

  // Transitions: one file per kind in use, starting where its lead-in starts
  const transitionFiles = new Map<TransitionKind, { file: string; leadInSeconds: number }>();
  for (const kind of new Set(states.map((s) => s.kind))) {
    const cue = transitionCue(kind, song.tracks);
    if (!cue) continue;
    tick(`transition ${kind}`);
    const stinger: Stinger = {
      id: kind,
      name: kind,
      kind: 'checkpoint',
      instrumentKey: cue.instrumentKey,
      variation: 0,
      notes: cue.notes.map((n) => ({ ...n, startOffset: n.startOffset + cue.leadIn })),
      lengthBars: Math.max(0.25, cue.leadIn, Math.max(...cue.notes.map((n) => n.startOffset + cue.leadIn)) + 0.25),
    };
    const file = `transitions/${kind}.wav`;
    files.push({ name: file, data: await renderStinger(stinger, song, sampleRate) });
    transitionFiles.set(kind, { file, leadInSeconds: +(cue.leadIn * secondsPerBar).toFixed(6) });
  }

  // Stingers
  const stingers = [];
  for (const s of song.stingers) {
    tick(`stinger ${s.name}`);
    const file = `stingers/${safe(s.name)}.wav`;
    files.push({ name: file, data: await renderStinger(s, song, sampleRate) });
    stingers.push({ name: s.name, kind: s.kind, label: stingerKind(s.kind).label, file, quantize: 'beat' });
  }

  tick('music.json');
  const music = {
    format: 'bos-beatbox-adaptive-music',
    version: 1,
    name: song.name,
    bpm: song.bpm,
    beatsPerBar: 4,
    key: key?.name ?? null,
    states: states.map(({ kind, ...s }) => ({ ...s, transition: transitionFiles.has(kind) ? { kind, ...transitionFiles.get(kind)! } : null })),
    stingers,
  };
  files.push({ name: 'music.json', data: new Blob([JSON.stringify(music, null, 2)], { type: 'application/json' }) });
  files.push({ name: 'players/web/adaptive-music.js', data: new Blob([webPlayer], { type: 'text/javascript' }) });
  files.push({ name: 'players/godot/AdaptiveMusic.gd', data: new Blob([godotPlayer], { type: 'text/plain' }) });
  files.push({ name: 'players/unity/AdaptiveMusic.cs', data: new Blob([unityPlayer], { type: 'text/plain' }) });
  files.push({ name: 'README.txt', data: new Blob([readme(song.name, music.states.map((s) => s.name), stingers.map((s) => s.name), song.bpm)], { type: 'text/plain' }) });
  onProgress?.(1, 'zip');
  return createZip(files);
}

function readme(name: string, states: string[], stingers: string[], bpm: number): string {
  const first = states[0] ?? 'Main';
  const second = states[1] ?? first;
  const sting = stingers[0];
  return `${name}: game music kit, made with Bo's Beatbox
${'='.repeat(name.length + 49)}

${bpm} BPM, 4 beats to the bar.
States (each a seamless loop): ${states.join(', ')}
${stingers.length ? `Stingers: ${stingers.join(', ')}\n` : ''}
What's here
-----------
music.json      The tempo, every state (its loop file, length, and the transition that plays
                going into it) and every stinger. The players below read it.
states/         One seamless loop per state, a whole number of bars long, with loop points.
transitions/    Played going into a state: a fill or a riser starts leadInSeconds before the
                switch; an impact starts on it.
stingers/       Short cues to play over the music.
players/        Ready-made players that switch states on the next bar, on the beat.

Web (players/web/adaptive-music.js)
    import { AdaptiveMusic } from './adaptive-music.js';
    const music = new AdaptiveMusic();
    await music.load('path/to/this/folder/');
    music.play('${first}');            // after the player clicks or presses a key
    music.setState('${second}');${sting ? `\n    music.stinger('${sting}');` : ''}

Godot 4 (players/godot/AdaptiveMusic.gd)
    Copy this folder to res://music/, add the script as an autoload called Music, then
    Music.play("${first}"), Music.set_state("${second}")${sting ? `, Music.stinger("${sting}")` : ''}.

Unity (players/unity/AdaptiveMusic.cs)
    Copy this folder to Assets/Resources/Music/, add the AdaptiveMusic component, then
    music.Play("${first}"), music.SetState("${second}")${sting ? `, music.Stinger("${sting}")` : ''}.
    Changes are scheduled on the audio clock (PlayScheduled), so they land on the beat exactly.

Other engines and middleware (FMOD, Wwise...): the loops are exact, so set each as a looping
sound and switch at bar lines (every ${(240 / bpm).toFixed(4)} s).
`;
}
