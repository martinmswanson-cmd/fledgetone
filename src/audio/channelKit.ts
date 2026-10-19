/**
 * The channel kit: a song made into what a streamer, YouTuber or podcaster needs, in one .zip.
 *   - Intro and Outro, for the start and end of a video or a stream
 *   - three seamless loops for a stream's screens: Starting soon (the main part), Be right back
 *     (the same part without its lead, or without drums) and Ending (a calmer part)
 *   - three short alerts in the song's key and tempo (a follow, a subscribe, a big moment): the
 *     song's own stingers when it has some
 *   - a whoosh for a scene transition
 *   - a README saying what each file is for and how to use it in OBS and the like
 * Which bars make each piece is planned in store/channelKit.ts. Everything is a WAV at 48 kHz (what
 * streaming software and video runs at), 24-bit; the loops carry their loop points. The music is
 * turned up or down to the loudness target by one gain for every piece (worked out on Starting
 * soon), so a calmer piece stays calmer; no limiter, so the loops' seams stay seamless.
 */
import { renderArrangement, channelsOf, type RenderOptions } from './exportWav';
import { encodeAudio } from './encoders';
import { exportCeilingDbtp } from './effects/limiter';
import { measureLoudness, normalizeGainDb } from './loudness';
import { targetById } from './loudnessTarget';
import { renderStinger } from './stingerPlayer';
import { generateSfx, renderSfxStereo } from './sfx/sfxSynth';
import { ensureSfxRecordings } from './sfx/sfxRecordings';
import { createZip, type ZipEntry } from './zip';
import { barToSeconds, FOUR_FOUR, type MeterMap } from './tempoMap';
import { songEnd, songSections } from '../store/cutToLength';
import { planChannelKit, type ChannelKitPlan, type KitRange } from '../store/channelKit';
import { versionTracks } from '../store/songVersions';
import { createStinger } from '../store/stingers';
import { detectKey, keyOf } from '../store/songKey';
import type { GameKitSong } from './gameKit';
import type { Stinger, StingerKind } from '../store/timelineTypes';

export const KIT_RATE = 48000;

/** A piece of the kit, as the dialog lists it before it's made */
export interface KitPiece {
  file: string;
  what: string;
  /** Bars it comes from (music), for the list */
  range?: KitRange;
}

/** The alerts made when the song has no stingers of its own: the stinger kind, the file's name */
const ALERTS: ReadonlyArray<{ kind: StingerKind; file: string; what: string }> = [
  { kind: 'checkpoint', file: 'Alert 1 (follow).wav', what: 'A short two-note alert: a new follower' },
  { kind: 'item', file: 'Alert 2 (subscribe).wav', what: 'A brighter alert: a subscriber or a tip' },
  { kind: 'victory', file: 'Alert 3 (big moment).wav', what: 'A fanfare: a raid, a goal reached, a win' },
];

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';

/** The song's plan, or null for an empty song */
export function channelKitPlan(song: GameKitSong): ChannelKitPlan | null {
  const meter: MeterMap = { base: song.meter ?? FOUR_FOUR, points: song.meterPoints ?? [] };
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  return planChannelKit(songSections(song.clips, song.markers, meter), songEnd(song.clips, meter), (bar) => barToSeconds(bar, tempo));
}

/** What the loops play: Be right back and Ending, each a version of a section (null: left out) */
function loopsOf(song: GameKitSong, plan: ChannelKitPlan) {
  const underscore = versionTracks(song.tracks, song.clips, 'underscore');
  const noDrums = versionTracks(song.tracks, song.clips, 'noDrums');
  const brb = underscore ? { tracks: underscore, how: 'without its lead melody' } : noDrums ? { tracks: noDrums, how: 'without its drums' } : null;
  const ending = plan.calm
    ? { tracks: song.tracks, range: plan.calm, how: 'a calmer part of the song' }
    : noDrums && brb?.tracks !== noDrums
      ? { tracks: noDrums, range: plan.loop, how: 'the main part without its drums' }
      : null;
  return { brb, ending };
}

/** Every file the kit will hold, for the dialog's list. */
export function channelKitPieces(song: GameKitSong): KitPiece[] {
  const plan = channelKitPlan(song);
  if (!plan) return [];
  const { brb, ending } = loopsOf(song, plan);
  const pieces: KitPiece[] = [
    { file: 'Intro.wav', what: 'The opening of the main part, about 6 seconds, fading out', range: plan.intro },
    { file: 'Outro.wav', what: "The song's ending, about 10 seconds", range: plan.outro },
    { file: 'Loop - Starting soon.wav', what: `The main part (${plan.main.name}) as a seamless loop`, range: plan.loop },
  ];
  if (brb) pieces.push({ file: 'Loop - Be right back.wav', what: `The main part ${brb.how}, as a seamless loop`, range: plan.loop });
  if (ending) pieces.push({ file: 'Loop - Ending.wav', what: `${ending.how[0].toUpperCase()}${ending.how.slice(1)}, as a seamless loop`, range: ending.range });
  for (const a of alertsOf(song)) pieces.push({ file: a.file, what: a.what });
  pieces.push({ file: 'Transition whoosh.wav', what: 'A whoosh for a scene change (a stinger transition)' });
  return pieces;
}

/** Stinger kinds that make a good alert (a follow is good news: not Danger or Game over) */
const UPBEAT: ReadonlySet<StingerKind> = new Set(['victory', 'levelUp', 'item', 'checkpoint']);

/**
 * The alerts: the song's own upbeat stingers first (they're in its sound), then ones made in its
 * key for the kinds still missing, three in all.
 */
function alertsOf(song: GameKitSong): Array<{ file: string; what: string; stinger: Stinger }> {
  const own = song.stingers.filter((s) => UPBEAT.has(s.kind)).slice(0, 3);
  const out = own.map((s, i) => ({ file: `Alert ${i + 1} (${safe(s.name)}).wav`, what: `Your stinger "${s.name}"`, stinger: s }));
  const key = detectKey(song.clips, song.tracks) ?? keyOf(0, 'major');
  for (const a of ALERTS) {
    if (out.length >= 3) break;
    if (own.some((s) => s.kind === a.kind)) continue;
    out.push({ file: a.file.replace(/^Alert \d/, `Alert ${out.length + 1}`), what: a.what, stinger: createStinger(a.kind, key, []) });
  }
  return out;
}

/** A fade over the first or last `seconds` (a quarter-sine, so it doesn't sound like a cut) */
function fade(channels: Float32Array[], sampleRate: number, seconds: number, at: 'in' | 'out'): void {
  const n = Math.min(channels[0].length, Math.round(seconds * sampleRate));
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const g = Math.sin((Math.PI / 2) * (i / n));
      if (at === 'in') ch[i] *= g;
      else ch[ch.length - 1 - i] *= g;
    }
  }
}

function readme(song: GameKitSong, pieces: KitPiece[]): string {
  const list = pieces.map((p) => `  ${p.file}\n      ${p.what}`).join('\n');
  return `${song.name}: channel kit

Music for the start, the breaks and the end of your streams and videos, all from one song, so
everything sounds like it belongs together. Every file is a WAV at 48 kHz.

${list}

Using it
  Streams (OBS, Streamlabs and the like): add a loop to a scene as a Media Source with "Loop"
  on (the loops repeat with no gap). Alerts go in your alert service's sound settings. The whoosh
  works as the sound of a Stinger transition between scenes.

  Videos: put the intro at the start and the outro at the end in your editor. The loops can run
  under a section for as long as you need.

  The loops and the intro and outro are at the same loudness as each other, so you set the volume
  once. Turn the music down under your voice.

Made with Fledgetone (fledgetone.com).
`;
}

/** Render the kit as a .zip. `onProgress` hears 0 to 1 and what's being made. */
export async function buildChannelKit(song: GameKitSong, opts: { target: string; intensity?: RenderOptions['intensity']; signal?: AbortSignal }, onProgress?: (fraction: number, detail: string) => void): Promise<Blob> {
  const plan = channelKitPlan(song);
  if (!plan) throw new Error('the timeline is empty');
  const { brb, ending } = loopsOf(song, plan);
  const alerts = alertsOf(song);
  const ceiling = exportCeilingDbtp('wav');
  const base: Omit<RenderOptions, 'startBar' | 'endBar'> = {
    tracks: song.tracks,
    clips: song.clips,
    bpm: song.bpm,
    tempoPoints: song.tempoPoints,
    swing: song.swing,
    masterFx: song.masterFx,
    master: song.master,
    sampleRate: KIT_RATE,
    peakCeilingDbtp: ceiling,
    signal: opts.signal,
    ...(opts.intensity ? { intensity: opts.intensity } : {}),
  };
  const music: Array<{ file: string; detail: string; range: KitRange; tracks: RenderOptions['tracks']; ending: RenderOptions['ending']; shape?: (ch: Float32Array[]) => void }> = [
    { file: 'Loop - Starting soon.wav', detail: 'Starting soon', range: plan.loop, tracks: song.tracks, ending: 'seamless' },
    {
      file: 'Intro.wav',
      detail: 'the intro',
      range: plan.intro,
      tracks: song.tracks,
      ending: 'exact',
      shape: (ch) => fade(ch, KIT_RATE, Math.min(1.5, (ch[0].length / KIT_RATE) * 0.3), 'out'),
    },
    { file: 'Outro.wav', detail: 'the outro', range: plan.outro, tracks: song.tracks, ending: 'ringOut', shape: plan.outro.from > 1 ? (ch) => fade(ch, KIT_RATE, 0.4, 'in') : undefined },
  ];
  if (brb) music.push({ file: 'Loop - Be right back.wav', detail: 'Be right back', range: plan.loop, tracks: brb.tracks, ending: 'seamless' });
  if (ending) music.push({ file: 'Loop - Ending.wav', detail: 'Ending', range: ending.range, tracks: ending.tracks, ending: 'seamless' });

  const steps = music.length + alerts.length + 2;
  let step = 0;
  const tick = (detail: string) => onProgress?.(step++ / steps, detail);
  const files: ZipEntry[] = [];

  // The music: rendered, then one gain for all of it (Starting soon's), each held under the ceiling
  const rendered: Array<{ file: string; channels: Float32Array[]; loop: boolean; peak: number }> = [];
  let gainDb = 0;
  for (const [i, m] of music.entries()) {
    tick(`Rendering ${m.detail}`);
    const audio = await renderArrangement({ ...base, tracks: m.tracks, startBar: m.range.from, endBar: m.range.to, ending: m.ending });
    opts.signal?.throwIfAborted();
    const channels = channelsOf(audio);
    m.shape?.(channels);
    const reading = await measureLoudness(channels, KIT_RATE, opts.signal);
    if (i === 0) gainDb = normalizeGainDb(reading, targetById(opts.target).lufs, ceiling).gainDb;
    rendered.push({ file: m.file, channels, loop: m.ending === 'seamless', peak: reading.truePeakMax });
  }
  for (const r of rendered) {
    const g = Math.pow(10, Math.min(gainDb, Number.isFinite(r.peak) ? ceiling - r.peak : gainDb) / 20);
    if (g !== 1) for (const ch of r.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    files.push({ name: r.file, data: await encodeAudio(r.channels, KIT_RATE, 'wav', { bitDepth: 24, ...(r.loop ? { loop: { start: 0, end: r.channels[0].length } } : {}) }) });
  }

  // The alerts, each at the loudness target (they play on their own, over whatever's on)
  for (const a of alerts) {
    tick(`Rendering ${a.file.replace(/\.wav$/, '')}`);
    const wav = await renderStinger(a.stinger, song, KIT_RATE);
    opts.signal?.throwIfAborted();
    const ctx = new OfflineAudioContext(2, 1, KIT_RATE);
    const audio = await ctx.decodeAudioData(await wav.arrayBuffer());
    const channels = channelsOf(audio);
    const reading = await measureLoudness(channels, KIT_RATE, opts.signal);
    const { gainDb: ag } = normalizeGainDb(reading, targetById(opts.target).lufs, ceiling);
    const g = Math.pow(10, ag / 20);
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    files.push({ name: a.file, data: await encodeAudio(channels, KIT_RATE, 'wav', { bitDepth: 24 }) });
  }

  // The whoosh: a little under the target (a transition shouldn't jump out)
  tick('Making the whoosh');
  const whooshSound = generateSfx('whoosh', 7);
  await ensureSfxRecordings(whooshSound);
  const whoosh = renderSfxStereo(whooshSound, KIT_RATE);
  const wr = await measureLoudness(whoosh, KIT_RATE, opts.signal);
  const wg = Math.pow(10, normalizeGainDb(wr, targetById(opts.target).lufs - 4, ceiling).gainDb / 20);
  for (const ch of whoosh) for (let i = 0; i < ch.length; i++) ch[i] *= wg;
  files.push({ name: 'Transition whoosh.wav', data: await encodeAudio(whoosh, KIT_RATE, 'wav', { bitDepth: 24 }) });

  tick('Packing the .zip');
  files.push({ name: 'README.txt', data: new Blob([readme(song, channelKitPieces(song))], { type: 'text/plain' }) });
  return createZip(files.map((f) => ({ ...f, name: `${safe(song.name)} channel kit/${f.name}` })));
}
