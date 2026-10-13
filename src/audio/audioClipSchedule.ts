/**
 * Audio clips (sound files on the timeline) on a Transport: each clip's sound plays from its
 * offset with its gain, fades, crossfades, time-stretch and warp markers, into its track. Handles
 * starts, seeks and loop passes into the middle of a clip. The same code serves live playback and
 * every export render.
 */
import { baseBpm, tempoAt, type Tempo } from './tempoMap';
import * as Tone from 'tone';
import type { Clip, Track } from '../store/timelineTypes';
import type { NativeBus } from './presets/native';
import { nativeContextOf } from './nativeNodes';
import { barToTicks } from './transport';
import { decodedSound, ensureSound, requestStretch, requestWarp, stretchedSound, warpedSound } from './soundLibrary';
import { DECLICK_SECONDS, envelopeAt, envelopeFrom, envelopeShape } from './clipEnvelope';
import type { EnvelopePoint, EnvelopeShape } from './clipEnvelope';
import { crossfades, envelopeDbAt, secondsPerBar, stretchRatio, type Crossfade } from '../store/audioClips';
import { beatAt, clipSecondsAt, isWarped, sourceAt, warpKey } from '../store/warp';
import { ENVELOPE_DB_MIN } from '../store/timelineTypes';
import { expandAudioComps } from '../store/takes';

type Transport = ReturnType<typeof Tone.getTransport>;

/** One audio clip sounding: its sound file playing into its track from `from` seconds into the clip. */
interface Voice {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** The clip's gain envelope (a gain of its own, after the fades), while it has one */
  env: GainNode | null;
  shape: EnvelopeShape;
  /** Context time it starts (or started), and how far into the clip that is */
  startAt: number;
  from: number;
  /** Context time it stops */
  stopAt: number;
  /** The whole sound's length, in seconds as recorded */
  soundSeconds: number;
}

interface Entry {
  clip: Clip;
  /** The Transport tick the clip starts on, and the event scheduled there */
  tick: number;
  eventId: number;
  /** What a change of restarts the clip: where it is and what it plays (its gain and fades only reshape it) */
  placement: string;
  /** Its crossfades with the clips either side, as a key (a change reshapes it) */
  xfade: string;
}

export interface AudioClipSchedule {
  /** Bring the Transport in line with the timeline's audio clips. Cheap when little has changed. */
  update: (tracks: Track[], clips: Clip[]) => void;
  /** A track's bus was rebuilt (its plugin effects changed): what's playing on it starts again on the new one, where it was. */
  restartTrack: (trackId: string) => void;
  dispose: () => void;
}

/** A tick's worth of float noise: positions compared closer than this are the same tick. */
const TICK_EPS = 1e-3;

const placementOf = (clip: Clip, bpm: number) =>
  `${clip.trackId}|${clip.startBar}|${clip.lengthBars}|${clip.audio?.soundId}|${clip.audio?.offset}|${clip.audio ? stretchRatio(clip.audio, bpm) : 1}|${clip.audio ? warpKey(clip.audio) : ''}|${clip.audio?.envelope ? 'e' : ''}`;

/** An envelope point's gain: silent at the bottom of its range. */
const envGain = (db: number) => (db <= ENVELOPE_DB_MIN ? 0 : Math.pow(10, db / 20));

/**
 * Play the timeline's audio clips on `transport`: each clip's sound file, from the clip's offset
 * into it, at its gain and with its fades, into its track (`busFor`; a track that has no bus, or
 * isn't being rendered, plays nothing). The same for live playback and the WAV export, which
 * builds its own Transport and buses.
 *
 * A clip starts from its beginning on a Transport event at its start tick, like a note. The
 * Transport's own events cover everything else: playback started or moved into the middle of a
 * clip (`start`, which a seek while playing also emits, after a `stop`), and a loop coming round
 * (`loopEnd` cuts what is playing, `loopStart` starts what plays at the loop's In). A clip that
 * starts exactly where playback does is left to its own event, so it never plays twice. Every
 * clip is a plain AudioBufferSourceNode and a GainNode made when it starts and let go when it
 * ends, so nothing runs between clips. Cuts fade over DECLICK_SECONDS so they don't click.
 */
export function createAudioClipSchedule(
  transport: Transport,
  busFor: (trackId: string) => NativeBus | undefined,
  /** The song's tempo: each clip plays at the tempo where it starts (see tempoMap.ts) */
  tempo: () => Tempo = () => transport.bpm.value
): AudioClipSchedule {
  // The browser's own context: a clip's nodes are made per play, so skip Tone's wrapper (nativeNodes.ts)
  const raw = nativeContextOf(transport.context);
  let entries = new Map<string, Entry>();
  /** Where overlapping clips on a track crossfade (see crossfades) */
  let xfades = new Map<string, Crossfade>();
  const xfadeKey = (id: string) => {
    const x = xfades.get(id);
    return x ? `${x.in}|${x.out}` : '';
  };
  const voices = new Set<Voice>();
  /** Between the Transport's start event and its stop: what plays now is known, and an edit can join in. */
  let running = false;

  /** The tempo where `clip` starts, which sets its length in seconds and its stretch. */
  const localBpm = (clip: Clip) => tempoAt(clip.startBar, tempo());
  /** Seconds per Transport tick as the Transport counts them now (to read its start offset back as ticks) */
  const secondsPerTick = () => 60 / (transport.bpm.value * transport.PPQ);
  const clipSeconds = (clip: Clip) => (clip.lengthBars * 240) / localBpm(clip);
  /** Whole frames: a source started between two frames is interpolated by the browser, which blurs its top end. */
  const onFrame = (seconds: number) => Math.round(seconds * raw.sampleRate) / raw.sampleRate;

  /**
   * The clip's envelope. A clip cut into its sound (its left edge trimmed) or cut off before the
   * sound's end gets at least a short fade at that edge, so the cut doesn't click; one that plays
   * its sound from the very start, or to its end, keeps the recording's own edges.
   */
  const shapeOf = (clip: Clip, soundSeconds: number): EnvelopeShape => {
    const audio = clip.audio!;
    const seconds = clipSeconds(clip);
    const ratio = stretchRatio(audio, localBpm(clip));
    const x = xfades.get(clip.id);
    // A crossfade longer than the clip's own fade replaces it, with an equal-power curve
    const xIn = (x?.in ?? 0) > audio.fadeIn;
    const xOut = (x?.out ?? 0) > audio.fadeOut;
    const fadeIn = Math.max(xIn ? x!.in : audio.fadeIn, audio.offset > 0 ? DECLICK_SECONDS : 0);
    const fadeOut = Math.max(xOut ? x!.out : audio.fadeOut, (ratio === 1 && !audio.stretchBpm ? audio.offset + seconds : sourceAt(audio, seconds, localBpm(clip))) < soundSeconds - 1e-6 ? DECLICK_SECONDS : 0);
    return envelopeShape(audio.gain, seconds, fadeIn, fadeOut, { in: xIn, out: xOut });
  };

  const scheduleEnvelope = (param: AudioParam, points: EnvelopePoint[], base: number) => {
    param.setValueAtTime(points[0][1], base + points[0][0]);
    for (let i = 1; i < points.length; i++) param.linearRampToValueAtTime(points[i][1], base + points[i][0]);
  };

  /**
   * A clip's gain envelope on `param` from `from` seconds into the clip (the clip's start at context
   * time `base`), its points placed where the clip plays their moments of the sound; from `at` on.
   */
  const scheduleGainEnvelope = (param: AudioParam, clip: Clip, from: number, base: number, at: number) => {
    const audio = clip.audio!;
    const points = audio.envelope ?? [];
    const bpm = localBpm(clip);
    const seconds = clipSeconds(clip);
    param.setValueAtTime(envGain(envelopeDbAt(points, sourceAt(audio, from, bpm))), Math.max(at, base + from));
    for (const p of points) {
      const t = clipSecondsAt(audio, p.src, bpm);
      if (t <= from || t >= seconds) continue;
      param.linearRampToValueAtTime(envGain(p.db), base + t);
    }
  };

  /** Hold `param` where the envelope is at `at`, so the ramp scheduled next starts from there (see README on cancelAndHoldAtTime). */
  const holdAt = (param: AudioParam, value: number, at: number) => {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
    else param.cancelScheduledValues(at);
    param.setValueAtTime(value, at);
  };

  /** Start `clip` at context time `at`, `from` seconds into it. */
  const start = (clip: Clip, from: number, at: number) => {
    const audio = clip.audio;
    const bus = audio && busFor(clip.trackId);
    if (!audio || !bus) return;
    // A clip that follows the tempo plays its stretched copy; until that's made, the recording
    // sped up like tape (in time, a little off pitch)
    const ratio = stretchRatio(audio, localBpm(clip));
    const recorded = decodedSound(audio.soundId, raw.sampleRate);
    if (!recorded) return; // not decoded yet (or missing from this browser): silent until it is
    let buffer = recorded;
    let bufferRatio = 1;
    /** Along its warp markers: where in the warped copy the clip starts (else null) */
    let warpedAt: number | null = null;
    const bpm = localBpm(clip);
    if (isWarped(audio)) {
      const warped = warpedSound(audio.soundId, raw.sampleRate, audio, bpm);
      if (warped) {
        buffer = warped;
        warpedAt = ((beatAt(audio, audio.offset) - beatAt(audio, 0)) * 60) / bpm;
      } else requestWarp(audio.soundId, raw.sampleRate, audio, bpm);
    }
    if (warpedAt === null && ratio !== 1) {
      const stretched = stretchedSound(audio.soundId, raw.sampleRate, ratio);
      if (stretched) {
        buffer = stretched;
        bufferRatio = ratio;
      } else requestStretch(audio.soundId, raw.sampleRate, ratio);
    }
    // A late event (the main thread was busy) starts the clip now, further in, so it stays in time
    const late = raw.currentTime - at;
    if (late > 0) {
      at = raw.currentTime;
      from += late;
    }
    at = onFrame(at);
    from = onFrame(from);
    const seconds = clipSeconds(clip);
    const offset = onFrame(warpedAt !== null ? warpedAt + from : (audio.offset + from * ratio) / bufferRatio);
    if (from >= seconds || offset >= buffer.duration) return;
    const shape = shapeOf(clip, recorded.duration);
    const points = envelopeFrom(shape, from);
    if (!points.length) return;
    const source = raw.createBufferSource();
    source.buffer = buffer;
    if (warpedAt === null && ratio !== bufferRatio) source.playbackRate.value = ratio / bufferRatio;
    const gain = raw.createGain();
    scheduleEnvelope(gain.gain, points, at - from);
    source.connect(gain);
    let env: GainNode | null = null;
    if (audio.envelope?.length) {
      env = raw.createGain();
      scheduleGainEnvelope(env.gain, clip, from, at - from, at);
      gain.connect(env);
      env.connect(bus.input);
    } else gain.connect(bus.input);
    source.start(at, offset);
    const stopAt = at + (seconds - from);
    source.stop(stopAt);
    const voice: Voice = { clipId: clip.id, source, gain, env, shape, startAt: at, from, stopAt, soundSeconds: recorded.duration };
    // Ended (which the browser reports once the audio, or the render, has got there): let the nodes go
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      gain.disconnect();
      env?.disconnect();
    };
    voices.add(voice);
  };

  /** Start `clip` at `at` if the Transport position `posTicks` is inside it (strictly past its start). */
  const startInside = (clip: Clip, tick: number, posTicks: number, at: number) => {
    if (tick >= posTicks - TICK_EPS) return;
    start(clip, ((posTicks - tick) / (transport.PPQ * 4)) * (240 / localBpm(clip)), at);
  };

  /** How long before its time the Transport may dispatch an event: an edit and the event can meet in this window (see update). */
  const dispatchWindow = () => ((transport.context as unknown as { updateInterval?: number }).updateInterval ?? 0.05) + 0.01;

  /** Fade a voice out to end at `time` (nothing if it ends before then; a voice not yet started never starts). */
  const stop = (voice: Voice, time: number) => {
    const now = raw.currentTime;
    const end = Math.max(time, now);
    if (end >= voice.stopAt) return;
    if (end <= voice.startAt) {
      voice.source.stop(voice.startAt);
      voice.stopAt = voice.startAt;
      return;
    }
    const fadeFrom = Math.max(end - DECLICK_SECONDS, voice.startAt, now);
    holdAt(voice.gain.gain, envelopeAt(voice.shape, voice.from + (fadeFrom - voice.startAt)), fadeFrom);
    voice.gain.gain.linearRampToValueAtTime(0, end);
    voice.source.stop(end);
    voice.stopAt = end;
  };

  /** The clip's gain or fades changed: its playing voices take the new envelope from here on, without a restart. */
  const reshape = (clip: Clip) => {
    const audio = clip.audio;
    if (!audio) return;
    const now = raw.currentTime + 0.005;
    for (const voice of voices) {
      if (voice.clipId !== clip.id || voice.stopAt <= now) continue;
      const shape = shapeOf(clip, voice.soundSeconds);
      const param = voice.gain.gain;
      if (now < voice.startAt) {
        // Not started yet: the whole envelope again
        param.cancelScheduledValues(0);
        scheduleEnvelope(param, envelopeFrom(shape, voice.from), voice.startAt - voice.from);
      } else {
        // Sounding: hold where it is, then move onto the new envelope over 10 ms and follow it
        const pos = voice.from + (now - voice.startAt);
        holdAt(param, envelopeAt(voice.shape, pos), now);
        const join = Math.min(pos + 0.01, shape.seconds);
        scheduleEnvelope(param, envelopeFrom(shape, join, false), voice.startAt - voice.from);
      }
      voice.shape = shape;
      if (voice.env) {
        // The gain envelope again, from here
        const at = Math.max(now, voice.startAt);
        const pos = voice.from + (at - voice.startAt);
        holdAt(voice.env.gain, voice.env.gain.value, at);
        scheduleGainEnvelope(voice.env.gain, clip, pos, voice.startAt - voice.from, at);
      }
    }
  };

  const fire = (clipId: string) => {
    // A repeat of the same tick (see scheduler.ts) is skipped
    let lastTime = -Infinity;
    return (time: number) => {
      if (Math.abs(time - lastTime) < 1e-4) return;
      lastTime = time;
      const entry = entries.get(clipId);
      if (!entry) return;
      // An edit (see update) may have started this clip a moment ago, just before its event was
      // dispatched: then this event is that same start, not a second one
      const window = dispatchWindow();
      for (const voice of voices) if (voice.clipId === clipId && voice.stopAt > time && Math.abs(voice.startAt - time) < window) return;
      start(entry.clip, 0, time);
    };
  };

  const onStart = (time: number, offsetSeconds: number) => {
    running = true;
    // Where the Transport is then, read in ticks: its offset in seconds is worked out along the
    // tempo ramp it had (mid-glide, a seek or a loop wrap would read back at the wrong bar)
    let posTicks = offsetSeconds / secondsPerTick();
    try {
      const ticks = transport.getTicksAtTime(time);
      if (Number.isFinite(ticks)) posTicks = ticks;
    } catch {
      // Keep the offset
    }
    for (const { clip, tick } of entries.values()) startInside(clip, tick, posTicks, time);
  };
  const onStop = (time: number) => {
    running = false;
    for (const voice of voices) stop(voice, time);
  };
  transport.on('start', onStart);
  transport.on('loopStart', onStart);
  transport.on('stop', onStop);
  transport.on('pause', onStop);
  transport.on('loopEnd', onStop);

  return {
    update: (tracks, all) => {
      // A mic take folder plays its comp's pieces, each a clip of its own here
      const clips = expandAudioComps(all, (c) => secondsPerBar(localBpm(c)) * stretchRatio(c.audio!, localBpm(c)));
      const trackIds = new Set(tracks.map((t) => t.id));
      const next = new Map<string, Entry>();
      /** Entries made now: new clips, and clips whose placement changed (their old voices are stopped) */
      const fresh: Entry[] = [];
      const stopped = new Set<string>();
      xfades = crossfades(clips.filter((c) => c.audio && trackIds.has(c.trackId)), baseBpm(tempo()));
      for (const clip of clips) {
        if (!clip.audio || !trackIds.has(clip.trackId)) continue;
        ensureSound(clip.audio.soundId);
        const ratio = stretchRatio(clip.audio, localBpm(clip));
        if (isWarped(clip.audio)) requestWarp(clip.audio.soundId, raw.sampleRate, clip.audio, localBpm(clip));
        else if (ratio !== 1) requestStretch(clip.audio.soundId, raw.sampleRate, ratio);
        const prev = entries.get(clip.id);
        const placement = placementOf(clip, localBpm(clip));
        if (prev && prev.placement === placement) {
          const xfade = xfadeKey(clip.id);
          if (prev.clip !== clip || prev.xfade !== xfade) {
            reshape(clip);
            prev.clip = clip;
            prev.xfade = xfade;
          }
          next.set(clip.id, prev);
        } else {
          if (prev) {
            transport.clear(prev.eventId);
            stopped.add(clip.id);
          }
          const tick = barToTicks(clip.startBar);
          const entry = { clip, tick, eventId: transport.schedule(fire(clip.id), `${tick}i`), placement, xfade: xfadeKey(clip.id) };
          next.set(clip.id, entry);
          fresh.push(entry);
        }
      }
      for (const [id, entry] of entries) {
        if (next.has(id)) continue;
        transport.clear(entry.eventId);
        stopped.add(id);
      }
      entries = next;
      if (!stopped.size && !fresh.length) return;
      // Clips deleted or moved while playing stop now. A clip that moved, or has just appeared
      // (pasted, brought back by undo) under the playhead starts from wherever the playhead is in
      // it: the Transport has passed its start, so its own event won't play it (or, started within
      // the last update interval, is about to and sees this start: see fire).
      const now = transport.now();
      for (const voice of voices) if (stopped.has(voice.clipId)) stop(voice, now);
      if (!running) return;
      const posTicks = transport.getTicksAtTime(now);
      for (const entry of fresh) startInside(entry.clip, entry.tick, posTicks, now);
    },
    restartTrack: (trackId) => {
      const now = transport.now();
      const onTrack = [...entries.values()].filter((e) => e.clip.trackId === trackId);
      const ids = new Set(onTrack.map((e) => e.clip.id));
      for (const voice of voices) if (ids.has(voice.clipId)) stop(voice, now);
      if (!running) return;
      const posTicks = transport.getTicksAtTime(now);
      for (const entry of onTrack) startInside(entry.clip, entry.tick, posTicks, now);
    },
    dispose: () => {
      transport.off('start', onStart);
      transport.off('loopStart', onStart);
      transport.off('stop', onStop);
      transport.off('pause', onStop);
      transport.off('loopEnd', onStop);
      entries.forEach((entry) => transport.clear(entry.eventId));
      entries.clear();
      for (const voice of voices) {
        voice.source.onended = null;
        voice.source.stop();
        voice.source.disconnect();
        voice.gain.disconnect();
        voice.env?.disconnect();
      }
      voices.clear();
    },
  };
}
