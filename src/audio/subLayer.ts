import * as Tone from 'tone';
import type { PlayableNote } from './instruments';
import { notLate } from './presets/monotonic';
import { createBus, createOsc, createVoiceSet, noteFrequency } from './presets/native';
import type { NativeBus, NativeVoice } from './presets/native';
import { HELD_NOTE } from './presets/edmSynths';
import type { SubLayer } from '../store/bassTools';
import { subFrequency } from '../store/bassTools';
import { createBendTimeline } from './bendTimeline';
import type { BendTimeline } from './bendTimeline';
import { lowestHeld, slideConstant, slidePitchAt } from './legato';
import type { NoteSlide } from './legato';

/**
 * The Sub enhancer (Track.subLayer): a clean sine played under a track's own notes, an octave down
 * or on the note itself, so a thin bass gets a solid, mono floor. It follows the notes rather than
 * the sound (there's no reliable way to find an octave below a sound without an audio worklet,
 * which would slow every export), so it's exact: in tune, in time, the same live and exported.
 * One sine at a time. Under a one-note instrument it slides from note to note as the instrument
 * does (when, how long and along which curve: see NoteSlide); under one that plays chords it's
 * under the lowest note sounding, and moves (without a slide: the instrument doesn't) when a lower
 * one starts or that one ends (see lowestHeld).
 *
 * Its nodes exist only while it's on, and per note only while that note sounds.
 */

/** Seconds a note's sub takes to rise: no click, still tight. */
const ATTACK = 0.006;
/** Seconds its end takes to fall 40 dB. */
const RELEASE = 0.06;
/** The sine's peak at level 1 and full velocity. */
const PEAK = 0.55;
/** Slide between overlapping notes under an instrument that doesn't say how it slides (a plugin). */
const DEFAULT_SLIDE: NoteSlide = { seconds: 0.06, curve: 'ramp' };
/** Seconds the sine under a chord's lowest note takes to fall when another note takes it over. */
const HANDOVER = 0.015;

const lowest = (notes: PlayableNote[]) => notes.reduce((a, b) => (noteFrequency(b.note) < noteFrequency(a.note) ? b : a));

interface SubVoice extends NativeVoice {
  osc: OscillatorNode;
  end: number;
  /** Its pitch: the last slide, from f0 to f1 begun at t0 (see slidePitchAt) */
  glide: { t0: number; f0: number; f1: number; slide: NoteSlide | null };
  /** The held key it's playing now (a slide hands it on): only that key lets it go */
  heldBy?: object;
  /** That key's own bend (cents), added to the instrument's: made at its first own bend */
  own?: ConstantSourceNode;
}

/** A note under a chord-playing instrument the sub may go under (see lowestHeld): its own bend, and the sines it's had. */
interface HeldUnder {
  note: PlayableNote;
  start: number;
  end: number;
  freq: number;
  /** Its own bend (cents) by time */
  own: BendTimeline;
  /** Its sines, by when each starts */
  subs: Map<number, SubVoice>;
}

/** Slide `freq` from `from` at `at` to `to` as `slide` says (none: straight there). */
function slideFreq(freq: AudioParam, at: number, from: number, to: number, slide: NoteSlide | null) {
  freq.cancelAndHoldAtTime(at);
  if (!slide || (slide.curve === 'ramp' && slide.seconds <= 0)) {
    freq.setValueAtTime(to, at);
    return;
  }
  // (Its start set as well as held: holding alone adds nothing when no ramp is still to come)
  freq.setValueAtTime(from, at);
  if (slide.curve === 'target') freq.setTargetAtTime(to, at, slideConstant(slide.seconds));
  else freq.exponentialRampToValueAtTime(to, at + slide.seconds);
}

export function createSubLayer(output: Tone.InputNode, initial: SubLayer | undefined) {
  let settings = initial;
  let nb: NativeBus | null = null;
  let voices: ReturnType<typeof createVoiceSet> | null = null;
  let current: SubVoice | null = null;
  /** The sines that may still sound, for the instrument's bends */
  const sounding = new Set<SubVoice>();
  /** The notes held under a chord-playing instrument (see holdLowest) */
  let held: HeldUnder[] = [];
  /**
   * Its bus, made while it's on. Made when the instrument is built or the setting changes, never
   * at a note: notes of an export play while Tone's current context may be the live one again, and
   * a bus made then would be in the wrong context.
   */
  const ready = () => {
    if (!nb) {
      nb = createBus(output);
      voices = createVoiceSet(nb.raw);
    }
    return { ...nb, voices: voices! };
  };
  if (initial) ready();
  /** The instrument's pitch bend (cents) by time, which the sub follows to stay under its notes (see bendTimeline.ts) */
  // (On the instrument's context's clock, kept while the sub is off too, so the old bends are let go)
  const clock = Tone.getContext().rawContext;
  const bends = createBendTimeline(() => clock.currentTime);
  /** The bends sent for later on `v`, from `from` while it sounds. */
  const follow = (v: SubVoice, raw: BaseAudioContext, from: number) => {
    for (const [t, cents] of bends.after(from, v.stopAt)) v.osc.detune.setTargetAtTime(cents, Math.max(raw.currentTime, t), 0.006);
  };
  const pitchOf = (v: SubVoice, at: number) => slidePitchAt(v.glide.f0, v.glide.f1, v.glide.t0, v.glide.slide, at);

  /**
   * The sub of `n` from `time`: slid to (on the sine sounding, or a new one from the last one's
   * pitch) as `how` says, or (null) begun on it. undefined: slid when it overlaps the last one
   * (DEFAULT_SLIDE). `chord`: one of the sines under a chord's lowest notes (see underLowest),
   * begun at `time` as it is, and ended there: the sine sounding plays on.
   */
  const playNote = (n: PlayableNote, time: number, how: NoteSlide | null | undefined, chord = false): SubVoice | undefined => {
    const s = settings;
    if (!s || s.level <= 0 || !nb || !voices) return;
    const { bus, raw, input } = nb;
    const set = voices;
    const freq = subFrequency(noteFrequency(n.note), s.mode);
    const length = bus.toSeconds(n.duration);
    if (!Number.isFinite(length) || !(freq > 0)) return;
    const start = chord ? time : notLate(bus.context, time);
    const end = start + Math.max(0.01, length);
    const peak = PEAK * s.level * (0.4 + 0.6 * n.velocity);
    const releaseTc = RELEASE / Math.log(100);

    const v = chord ? null : current;
    const ringing = !!v && v.stopAt > start;
    const slide = how !== undefined ? how : ringing && v!.end > start + 0.001 ? DEFAULT_SLIDE : null;
    // Where it slides from: the instrument's last note, or where the sine is
    const from = slide?.from !== undefined ? subFrequency(slide.from, s.mode) : v ? pitchOf(v, start) : freq;
    if (v && ringing && slide) {
      // Legato: slide on, at this note's level
      // (The last key's own bend is its own: this note starts from the instrument's)
      v.own?.offset.setTargetAtTime(0, start, 0.006);
      slideFreq(v.osc.frequency, start, from, freq, slide);
      v.glide = { t0: start, f0: from, f1: freq, slide };
      const g = v.amp.gain;
      g.cancelAndHoldAtTime(start);
      g.setTargetAtTime(s.decay > 0 ? 0 : peak, start, s.decay > 0 ? s.decay / Math.log(1000) : 0.01);
      g.setTargetAtTime(0, end, releaseTc);
      const followed = v.stopAt;
      set.extend(v, end + RELEASE * 1.5);
      v.end = end;
      // (It rings on longer: the bends sent for then too)
      follow(v, raw, followed - 1e-9);
      return v;
    }
    if (v && ringing) set.release(v, start, HANDOVER);
    const osc = createOsc(raw, 'sine', slide ? from : freq, start, bends.at(start));
    // (A slide begun as the last sine had already died away: this one takes it on)
    if (slide) slideFreq(osc.frequency, start, from, freq, slide);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + ATTACK);
    if (s.decay > 0) amp.gain.setTargetAtTime(0, start + ATTACK, s.decay / Math.log(1000));
    amp.gain.setTargetAtTime(0, end, releaseTc);
    osc.connect(amp);
    amp.connect(input);
    const stopAt = s.decay > 0 ? Math.min(end + RELEASE * 1.5, start + ATTACK + s.decay * 1.05) : end + RELEASE * 1.5;
    const voice: SubVoice = { start, stopAt, sources: [osc], nodes: [osc, amp], amp, osc, end, glide: { t0: start, f0: slide ? from : freq, f1: freq, slide } };
    follow(voice, raw, start);
    set.add(voice);
    for (const old of sounding) if (old.stopAt < raw.currentTime) sounding.delete(old);
    sounding.add(voice);
    if (!chord) current = voice;
    return voice;
  };

  /** `v`'s own bend in cents (an offset to its detune), made at its first. */
  const ownOf = (v: SubVoice, raw: BaseAudioContext): ConstantSourceNode => {
    if (!v.own) {
      const own = raw.createConstantSource();
      own.offset.value = 0;
      own.connect(v.osc.detune);
      own.start(Math.max(raw.currentTime, v.start));
      own.stop(v.stopAt);
      v.own = own;
      v.sources.push(own);
      v.nodes.push(own);
    }
    return v.own;
  };

  /**
   * Under a chord-playing instrument: the sines for the lowest of the notes held at each moment,
   * worked out again as notes start and end (they're sent out of order: a note's end and bends
   * ahead, when it starts). A sine already given whose stretch got shorter ends sooner; one no
   * longer wanted never sounds.
   */
  const underLowest = () => {
    if (!nb || !voices) return;
    const set = voices;
    const now = nb.raw.currentTime;
    // (The notes long ended are let go)
    held = held.filter((h) => h.end > now - 1);
    const wanted = new Set<SubVoice>();
    for (const { index, from, to } of lowestHeld(held)) {
      const h = held[index];
      let v = h.subs.get(from);
      if (!v) {
        if (to <= now) continue;
        const at = notLate(nb.bus.context, Math.max(from, now));
        v = playNote({ ...h.note, duration: Number.isFinite(h.end) ? `${Math.max(0.01, h.end - at).toFixed(6)}s` : HELD_NOTE }, at, null, true);
        if (!v) continue;
        h.subs.set(from, v);
        // (Its note's own bend, as it is there and on)
        if (h.own.moved()) {
          const own = ownOf(v, nb.raw);
          own.offset.setValueAtTime(h.own.at(v.start), v.start);
          for (const [t, cents] of h.own.after(v.start, v.stopAt)) own.offset.setTargetAtTime(cents, Math.max(now, t), 0.006);
        }
      }
      if (to < v.end) {
        // Another note takes over there, or this one ends then
        set.release(v, Math.max(now, to), to < h.end ? HANDOVER : RELEASE);
        v.end = to;
      }
      wanted.add(v);
    }
    for (const h of held) {
      for (const [from, v] of h.subs) {
        if (wanted.has(v)) continue;
        set.release(v, Math.max(now, v.start), HANDOVER);
        h.subs.delete(from);
      }
    }
  };

  return {
    /** A chord under a one-note instrument (or a plugin): the lowest note's sub, slid to as `how` says (see playNote). */
    play: (notes: PlayableNote[], time: number, how?: NoteSlide | null) => {
      if (!settings || !notes.length) return;
      try {
        const v = playNote(lowest(notes), time, how);
        if (v) v.heldBy = undefined;
      } catch (err) {
        console.warn('Skipped a sub note:', err);
      }
    },
    /**
     * A held key: its sub, what lets it go (`off`), and its own bend in cents from a time (`bend`:
     * a note whose bend is its own, added to the instrument's). Both act only while the sub is that key's.
     */
    hold: (note: PlayableNote, time: number, how?: NoteSlide | null) => {
      const voice = settings ? playNote({ ...note, duration: HELD_NOTE }, time, how) : undefined;
      const key = {};
      if (voice) voice.heldBy = key;
      const ours = () => !!voice && !!voices && !!nb && current === voice && voice.heldBy === key;
      return {
        off: (at: number) => {
          if (!ours() || !nb) return;
          const t = notLate(nb.bus.context, at);
          voices!.release(voice!, t, RELEASE);
          voice!.end = t;
        },
        bend: (cents: number, at: number) => {
          if (!ours() || !nb) return;
          const v = voice!;
          const t = Math.max(nb.raw.currentTime, notLate(nb.bus.context, at));
          if (!v.own && cents === 0) return;
          ownOf(v, nb.raw).offset.setTargetAtTime(cents, t, 0.006);
        },
      };
    },
    /** Notes that start together under a chord-playing instrument: the sub goes under the lowest held (see underLowest). */
    playLowest: (notes: PlayableNote[], time: number) => {
      if (!settings || !nb || !notes.length) return;
      const start = notLate(nb.bus.context, time);
      for (const n of notes) {
        const length = nb.bus.toSeconds(n.duration);
        const freq = noteFrequency(n.note);
        if (!Number.isFinite(length) || !(freq > 0)) continue;
        held.push({ note: n, start, end: start + Math.max(0.01, length), freq, own: createBendTimeline(() => clock.currentTime), subs: new Map() });
      }
      try {
        underLowest();
      } catch (err) {
        console.warn('Skipped a sub note:', err);
      }
    },
    /**
     * A held key of a chord-playing instrument (a voice of its own, see TrackInstrument.noteVoice):
     * the sub goes under it while it's the lowest held. What lets it go (`off`) and its own bend
     * (`bend`), as hold's.
     */
    holdLowest: (note: PlayableNote, time: number) => {
      const freq = noteFrequency(note.note);
      const h: HeldUnder | null = settings && nb && freq > 0 ? { note, start: notLate(nb.bus.context, time), end: Infinity, freq, own: createBendTimeline(() => clock.currentTime), subs: new Map() } : null;
      const again = () => {
        try {
          underLowest();
        } catch (err) {
          console.warn('Skipped a sub note:', err);
        }
      };
      if (h) {
        held.push(h);
        again();
      }
      return {
        off: (at: number) => {
          if (!h || !nb || !held.includes(h)) return;
          h.end = Math.max(h.start, notLate(nb.bus.context, at));
          again();
        },
        bend: (cents: number, at: number) => {
          if (!h || !nb) return;
          const t = Math.max(nb.raw.currentTime, notLate(nb.bus.context, at));
          h.own.set(cents, t);
          for (const v of h.subs.values()) {
            if (v.stopAt <= t || (!v.own && cents === 0)) continue;
            ownOf(v, nb.raw).offset.setTargetAtTime(cents, Math.max(t, v.start), 0.006);
          }
        },
      };
    },
    /** The instrument's pitch bend (cents) from `time`, as the instrument has it. `cut`: the bends sent for then and after are dropped first. */
    bend: (cents: number, time: number, cut?: boolean) => {
      const t = nb ? notLate(nb.bus.context, time) : time;
      const now = nb?.raw.currentTime ?? 0;
      if (cut) for (const v of sounding) v.osc.detune.cancelScheduledValues(Math.max(now, t));
      else if (Math.abs(cents - bends.at(t)) < 0.01) return;
      bends.set(cents, t, cut);
      for (const v of sounding) if (v.stopAt > t) v.osc.detune.setTargetAtTime(cents, Math.max(now, t), 0.006);
    },
    /** Its settings as they change (from the next note); undefined switches it off and lets its nodes go. */
    set: (next: SubLayer | undefined) => {
      settings = next;
      if (next) ready();
      if (!next && nb) {
        const old = { nb, voices };
        nb = null;
        voices = null;
        current = null;
        held = [];
        sounding.clear();
        old.voices?.releaseAll(old.nb.raw.currentTime, 0.03);
        // Once the fade has played
        setTimeout(() => {
          old.voices?.stopAll();
          old.nb.bus.dispose();
        }, 500);
      }
    },
    releaseAll: () => {
      if (voices && nb) voices.releaseAll(nb.raw.currentTime, 0.03);
      current = null;
      held = [];
    },
    dispose: () => {
      voices?.stopAll();
      nb?.bus.dispose();
      nb = null;
      voices = null;
      current = null;
      held = [];
      sounding.clear();
    },
  };
}
