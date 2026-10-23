# Sound recipes

How the demo sounds the owner signed off on were made, so they can be made again. Each recipe has
the lessons (what was wrong and what fixed it), the settings, and the exact command that renders
it. The scripts build the song through the app's own store and export path, so a recipe also tests
that the app can still make that sound: re-render after a change to the engine, the presets or the
master and compare.

Rendering: start the dev server (`npx vite --port 5511 --strictPort`), then from the repo
`OUT=<folder> APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs <script> '<json arg>'`.
The MP3 comes out as `<file>-mp3.wav` in `<folder>` (it is an MP3; rename it).

## Colour-bass drop (signed off 2026.10.22)

Script: `scripts/demos/colour-bass-drop.js` (100 BPM, E phrygian, 21 bars: a 2-bar filtered break,
a 2-bar build, a 16-bar drop, an end hit).

```
OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/colour-bass-drop.js \
  '{"take":"a","newBass":{"hp":70,"vol":3.2},"vol":{"drums":-4},"crunch":0.4,"subTilt":-3,"duck":"bass","file":"colour-bass-drop"}'
```

At commit `589abc47` this renders bit-identical to the
signed-off file (MP3 md5 `879feecbaf0fc95744741a8ee0d238a1`). Measured on its drop: −7.0 LUFS
(hit check), decoded true peak −2.0 dBTP, crest 7.0 dB, mids pump −2.6 dB, beat-rate level movement
0.08, sub dips 3.6 per bar, the master limiter taking off at most 1.1 dB. The reference it was
measured against: −7.1 LUFS, pump −2.3 dB, beat-rate movement 0.09, 4.1 sub dips per bar.

What it took, in the order the owner's ears found the problems:

1. **"Sounds like the 2010s."** The first demos were half-time at 145 with one snare a bar, 8th
   hats, a soft boom kick, a clean one-root riddim bass, lush maj7/9 colour chords and a wide pad.
   The reference is full time at 100 with the snare on 2 and 4, accented 16th hats, about six
   syncopated kicks a bar 1–3 16ths apart (a "zap" kick: pitch 150 → 70 Hz in 50 ms, loud click),
   and a gritty bass that changes note about 30 times a bar over two octaves, gliding a third of the
   time. Fixes: the **Syncopated drop** drummer style, Crunch kick / Zap kick / Crunch snare /
   Sharp tight hat, the Crunch presets, and **Crunch** on the Loud master.
2. **"The melody is generic commercial."** Our lead walked the scale in 8ths over a chord
   progression, with thirds and sixths over the bass. The reference uses no progression: a pedal or
   two roots a tritone (or semitone) apart, two bars each; power-chord stacks (root, fifth, octave,
   no third) held all the time, every voice sliding a semitone when the root jumps a tritone; hooks
   of one to four pitches, often one note struck in a syncopated rhythm; exact 2-bar loops; the top
   line doubling the bass's root or fifth most of the time. Take "a" (the script's default): roots
   E → A# → E → F, a one-note C6 hook on off-beat 16ths that slips a semitone at the loop's end.
3. **"The bass goes wubwubwub."** Three bass synths took turns every few 16ths, each with its own
   attack, so the tone and level jumped on every note. Fix: one main bass, **Bass/Driven Legato**
   (five detuned saws over a square, driven twice, no per-note randomness, legato with a 50 ms
   glide, notes held slightly into the next), plus a **Clean Sub** holding the roots; Duck to kick
   made gentle on busy drums (holes −5 dB and short when hits are half a beat apart or closer).
4. **Still pumping in the mix.** The Crunch clipper let the top of the sound skip the clip and
   hard-clipped highs overshot, so peaks came out up to 6 dB over the limiter, which then pulled the
   whole mix down after every kick and snare. Fix: Crunch clips the whole band (161-tap up/down
   filters, two hard passes, 1 dB lower), so the limiter barely works.

Settings that matter in the command: drums −4 dB into the master, Crunch 40% (higher Crunch makes it
louder and clips the bass under each hit, so it dips again), sub tilt −3, Duck to kick style "bass",
the Driven Legato bass at +3.2 dB with a 70 Hz high-pass (the Clean Sub takes the lows), Loud master
on Club (it stops at about −7 LUFS at its distortion cap). A crunchier variant, louder (−5.8 LUFS)
but with the bass dipping again: `"vol":{"drums":-1},"crunch":0.85`.

## Melodic takes (not signed off yet)

Script: `scripts/demos/melodic-takes.js`, `arg.take` `'a'` (artcore, 175 BPM, Eb major: off-barline
extended harmony with a secondary dominant and a borrowed iv, a four-pitch syncopated hook, grand
piano broken chords and 16th runs, a tamed Driven Legato bass, music pump −1 dB, Loud master at −10
LUFS, no Crunch) or `'b'` (future bass, 130 BPM, A major: lydian II and borrowed iv, a lead holding
one colour tone over several chords, chopped chords over a wash, Duck to kick "Future bass"). Kept
here so they can be rebuilt while the owner decides.

Second versions (`scripts/demos/melodic-takes-2.js`, same args): the owner said the first ~10 s of
each worked, then "the melody and synth go everywhere, I can't catch an actual melody". Fix: the
drop grows out of the opening; one lead sings one 4-bar tune in A A' A B form, identical each time
except the phrase endings; chords once a bar on the barline; piano, wash and chord stacks capped
under the tune's register; runs and answers only in the gaps between phrases; bass holds roots; the
lead is the loudest melodic part.

Third versions (`scripts/demos/melodic-takes-3.js`): the owner liked A2 and wanted the tune higher
and the piano faster; B felt repetitive, its claps off and its drop too slow. A3: the third pass an
octave up, the B phrase lifted to an Eb6 climax; piano 16th arpeggios under the tune, 16th→32nd runs
up two octaves only while the tune holds. B3: 150 BPM, half-time intro → full-time drop; the clap
was a 5-burst preset landing 40–60 ms late (a flam), now a snappy 3-burst clap quietly under a tight
snare on 2 and 4; the tune unchanged but the arrangement varies per pass (sparse, full with answers,
a break, the last A an octave up with a new chord), a fill and crash every 4 bars.

## Off the Rails: take B as a whole song (not signed off yet)

Script: `scripts/demos/future-bass-song.js` (2:41, A major at 150 BPM, then B major at 175: the B3 tune, its 3+3+2
rhythm and future-bass core, with risks taken on purpose). It builds a real project through the store (markers,
one clip per section, the Drop pad, swells reversed with the app's own Reverse), exports it as the Export dialog
does (Loud master, Crunch 40%, Loud -9 LUFS target, the app's MP3 encoder) and saves the `.fledgetone.json`:

```
OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/future-bass-song.js '{"file":"off-the-rails","save":true}'
```

The saved file, copied into the repo's `songs/` folder and run with `'{"open":"/songs/off-the-rails.fledgetone.json"}'`,
opens through the app's own open path in a fresh browser and exports to the identical MP3.

The kick ("it's missing a sort of kick"): B3's Club kick was a round thump, no click and no knock (alone: click
and 200 Hz-1 kHz both ~15 dB under its low end; in the mix no bump at 250 Hz-4 kHz after the hit, where every
reference has +1.5..+7 dB), with a short sub (down 20 dB in 124 ms) and the low end 9-12 dB down 100 ms after
each kick: a pop and a hole, gone on small speakers. Its drops also came in only 0.2-2 LU over the builds. Fixes:
**Hard drop kick** (click and driven knock 2-5 dB around the low end, a tuned sub carrying it ~250 ms; its tail
set by hand to A1, B1 after the key change), the Clean Sub ducking deeper and longer under the kick only (-10 dB,
170 ms) so the kick's tail hands over to the sub, **Drop impact** on every drop's downbeat, the build's last two
bars swept down on the Drop pad's Filter and one beat of silence with a reversed swell. Measured: knock +3.3..+3.7
dB, 1-4 kHz +1.5..+1.9, low end 100 ms after a kick -3.3 (was -9..-12), drop entrances +6..+9 LU.

The map: intro (e-piano 3+3+2, the tune soft over half-time drums) 0:00; build 0:13; drop 1 (full time, A A' A
B ending deceptively) 0:19; breakdown (the tune alone on the e-piano over new chords: F#m9 G#m7 Dmaj9 E7sus4 |
Bm11 Bbmaj7#11 C#m7 E7sus4) 0:45; half-time verse 0:58; build and a fake-out (the drop lands for two beats,
Tape stop, then the tune's first figure chopped in 32nds through the Gate) 1:10; drop 2, the colour-bass switch
(Crunch kit, syncopated, one legato Driven Legato bass over a Clean Sub, held power-chord stabs, a chip lead
chopping the tune, Drop pad stutters, crush and gate) 1:17; bridge (the answer alone on a sine) 1:42; a tempo
ramp 150 to 175 onto F#7sus4 1:49; the final drop a whole step up in B, the third pass an octave up 1:55;
outro (the e-piano as at the start) 2:28. Whole song -9.0 LUFS, drops -7.5..-8.4, decoded true peak -2.0 dBTP.
