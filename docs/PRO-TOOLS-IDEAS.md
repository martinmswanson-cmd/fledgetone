# Pro tools to build: ideas list

Plugins and features that professional producers expect, especially those Ableton Live and FL Studio
have, that Fledgetone doesn't have yet. Checked against the code on 2026-11-15. Nothing here is started.

## Mixing and production tools

1. **Resonance suppressor**: finds the narrow peaks that ring and move from note to note in growls,
   supersaws and FM basses, and turns each one down only while it rings. A new plugin in the
   `fledge.wasm` family; `src/audio/fft.ts` and `phaseVocoder.ts` are the groundwork.
2. **Pro EQ upgrade**: dynamic bands (a band cuts only when that frequency gets loud), mid/side per
   band, a linear-phase mode, and **Match** against the reference song (`referenceTrack.ts`). Today's
   Pro EQ (`src/audio/peq.ts`) is static Web Audio biquads; `PeqEditor.tsx` already draws the curve.
3. **Stereo and phase meter**: vectorscope, a live correlation bar, loudness history, PSR/PLR
   (dynamic range left) and a mono-compatibility warning on the master.
4. **Vocal cleanup**: noise reduction learned from a quiet stretch of the take, de-hum, de-click and
   de-plosive, run in a Worker.
5. **Audio to MIDI**: turn a recorded melody, bass line or hummed tune into notes, reusing the pitch
   tracking in `vocalTune.ts`.
6. **Sidechain input for any plugin** (host feature): `scripts/plugins/bbplug.h` has stereo in and
   out only. Add optional sidechain buffers and a "Sidechain from…" picker, so any built-in
   compressor, gate or vocoder can be keyed from another track.

## Making your own sounds from sine waves (Operator, Sytrus, Harmor)

7. **FM operator synth**: 4 to 6 sine operators, each with a ratio or fixed frequency, a fine tune,
   a multi-stage envelope, feedback and a choice of shape. Pick a preset algorithm, or wire any
   operator into any other in a modulation matrix (Sytrus-style). Rust, in `engine/` next to
   Fledge Synth. Fledge Synth has only one FM path (B into A).
8. **Additive synth and harmonic editor**: draw the level (and phase) of each of up to 256 partials,
   each partial built from sine waves, and morph between two or more drawings over time. It can also
   resynthesise a sample into partials. A quick first step is a harmonic editor that writes into
   Fledge Synth's existing **User table** (`src/audio/plugins/userTable.ts`); a full additive engine,
   with an envelope on each partial, comes after.
9. **Wavetable editor**: draw a single cycle, type a formula, or edit each frame of a table. Today a
   User table can only be made from an audio clip.
10. **Modulators on any setting** (Ableton 12 modulators, FL's Peak Controller and Formula
    Controller): an LFO, a multi-stage envelope, an envelope follower (driven by another track's
    level) or a random source that moves any parameter of any track or plugin. Today Fledge Synth's
    LFOs and envelopes reach only its own settings.
11. **Modular patcher** (FL Patcher, Bitwig's Grid, a light Max for Live): a node graph of
    oscillators, envelopes, filters, maths, mixers and effects, wired freely, saved as an
    instrument or an effect. The biggest item here; it gives you control over every part of a sound.

## Instruments inside instruments (Instrument Rack, FL Layer and Patcher)

12. **Instrument Rack / Layer**: one track that holds several chains, each chain any instrument
    (built-in, recorded, Fledge Synth, a plugin, even a Drum Rack) with its own effects. Each chain
    gets:
    - its own key zone and velocity zone, for splits and layers;
    - a **chain selector**, one knob that crossfades between chains;
    - its own level, pan and transpose.

    The rack has 8 macros, each able to move any setting inside it. Racks save to **My sounds**
    as one preset.
13. **Effect Rack**: parallel effect chains on one insert, for parallel compression, a split by
    frequency band (a different chain on the lows and on the highs), and dry/wet per chain.
14. **Drum Rack pads that hold any instrument**: a pad that plays a Drum Designer kick, a Fledge Synth
    patch or a plugin, with its own effects and sends. Today pads only play samples.

## Other Ableton and FL staples

15. **MIDI effects chain** before the instrument: arpeggiator, chord, scale lock, note echo,
    randomise, velocity shaping (Ableton's MIDI effects, FL's Riff Machine). Arpeggiator and chord
    code exists, but there's no general chain.
16. **Microtuning**: tuning systems and Scala (`.scl`) files for every instrument (Ableton 12).
    Nothing exists yet.
17. **Granular instrument from your own sample** (Ableton's Granulator, FL's Granulizer). Clouds
    exists, but only as an effect.

## Smaller items

- A polarity flip and phase alignment control on every channel strip (`lineUp.ts` may cover part).
- A transient shaper with a proper display (Faust's Transient has only sliders).

## Suggested order

1. Instrument Rack / Layer (#12): mostly TypeScript in the host, and it makes every existing
   instrument layerable. Effect Rack (#13) and Drum Rack pads (#14) reuse it.
2. Sidechain input (#6): improves hundreds of existing plugins at once.
3. Harmonic editor into the User table (#8, first step): sine-wave sound design for little work.
4. FM operator synth (#7), then modulators (#10).
5. Resonance suppressor (#1) and dynamic EQ (#2) for the bass-music core.
6. Modular patcher (#11) last: the largest, and it builds on 7 to 10.
