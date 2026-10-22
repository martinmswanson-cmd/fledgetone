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

## Full song: "Lanterns" (melodic artcore, not signed off yet)

Script: `scripts/demos/melodic-song.js` (175 BPM, Eb major, the second drop a semitone up in E, 114
bars, 2:40). It grows the third take A's tune and harmony into a whole song, using what the
references do at song level: 8-bar sections with short hinges between them, a "lift" that states
the tune at full height with no kick and no bass before the drop, one-beat stops filled by a
reverse swell, a piano break with the drums out, and a second drop that is longer than the first,
a key up, wider and busier.

```
OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/melodic-song.js '{}'
```

It writes `lanterns-mp3.wav` (an MP3: rename it) and `lanterns.fledgetone.json.wav` (the project
file, as the studio's Save writes it: rename it to `lanterns.fledgetone.json` and open it in the
studio). To check the file opens and plays the same, serve it from the dev server (copy it into
`public/` for a moment) and run the script with `'{"checkUrl":"/lanterns.fledgetone.json"}'`. That
opens it through the studio's own Open (`openProjectFromFile`) and renders it again: the printed
`fingerprint` (a hash of every sample) must equal the first run's, and the MP3 comes out
byte-identical. At the commit that added it the MP3's md5 is `47d82499d776aac7e73a0fac30f5e2c6`
(fingerprint `4bbe03e4`).

Every Fledge Synth track plays a built-in preset as it is, so nothing hides in custom values:
**Lead/Soaring Saw** (lead and its octave double), **Chords/Silk Stack**, **Pad/Silk Wash**,
**Bass/Round Root**, **Keys/Vowel Chop**, **Keys/Glass Pluck**, **FX/Reverse Swell**, plus
**Bass/Clean Sub**, **FX/Riser** and **FX/Downlifter**. The piano is the Concert Grand (two tracks:
the accompaniment and the tune). Drums: the Designed Kit with the presets Punchy kick, Tight snare,
Crisp clap, Tight hat (row -4 dB), Open hat, Crash, Ride (row -9 dB), Low and Mid tom. Mix: Duck
to kick "Future bass / artcore" with the music's pump set to -1 dB and the sub's to -3 dB, shared
reverb 3.2 s, the Loud master on (Loud, no Crunch), exported at -10 LUFS.

| bars (app) | section | what it does |
|---|---|---|
| 1–8 | Intro | take A3's: piano 8th broken chords; from bar 5 the tune on the piano (A'), the wash, the bass, hats, a half breakbeat and a fill |
| 9–16 | Verse | the tune on the piano (A A'), a glass pluck an octave over it the second time; half-time drums; a first vowel-chop answer where the tune holds |
| 17–24 | Lift | the supersaw lead's first entry (B, then A') with the held stack and piano 16ths, but no kick, bass or sub; a riser and snare build; beat 4 of bar 24 stops, a reverse swell fills it |
| 25–40 | Drop 1 | take A3's drop: A, A', A an octave up, the lifted B; piano 16th arpeggios and runs in the gaps; the two-step breakbeat |
| 41–48 | Post-drop | the lead rests; vowel chops cut the tune up in a syncopated 16th rhythm; the stack out; the drums thin; a downlifter into the break |
| 49–56 | Break | piano alone with the wash: the chord struck once, a slow arpeggio, the tune (A A') in the right hand |
| 57–60 | Swell | B on the piano, the glass pluck over it, the stack swelling bar by bar, the bass back |
| 61–72 | Build | the lift again: the lead sings A, A' (doubled an octave up); then the pivot (Fm9, Bb13sus4, B13sus4, B7(b9)) with a four-on-the-floor kick, a riser, the tune climbing to D#6; a stop and a reverse swell |
| 73–104 | Drop 2 | in E: the A an octave up first (D#6 resolving to E6), then A', A, B; again A up, A', B, and B ending on the tonic held on E6; the octave double throughout; a new vowel-chop counter-hook in off-beat 16ths an octave away from the tune; the glass pluck doubling the piano's runs and, from bar 89, a high 8th sparkle; from bar 89 a busier kick, an 8th-note bass, double-time fills (snare 16ths and 32nds, a kick-snare stutter) |
| 105–115 | Outro, end | back to the intro's piano with the tune once more (A A'), the drums thinning out, then Emaj9 rolled up and held |

Measured (decoded MP3): whole song -10.1 LUFS, true peak -1.8 dBTP, loudness range 3.9 LU; drop 1
-9.3 LUFS (hit check, crest 10.4 dB, pump -0.8 dB), drop 2 -8.9 (crest 10.1); intro -12.7, verse
-10.9, lift -10.2, post-drop -10.6, break -12.4, build -10.6, outro -12.2. No clicks away from drum
hits. The hit check's "bass pattern repeats by the bar" is low for the same reason as take A's (the
harmony changes off the barline), the sub ducks a little long under the snare (-7 / -9 dB), and drop
2's mids and presence are a little high (the chops and the glass pluck): its brighter top is on purpose.
