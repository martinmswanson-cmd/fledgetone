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
Since compressed exports are limited at −1 dBTP like a WAV and MP3s are gapless, the same command makes a
different MP3: the master reaches −6.1 LUFS at −1 dBTP (distortion −18.1 dB instead of −16.3), and the
MP3 is turned down 1.3 dB after encoding, decoding at −7.4 LUFS and −1.1 dBTP with its first sample at 0.

Since the mix balance pass (see the end of this file) the same command also runs Make space and plays the bass's
170 Hz bell at +3 dB (was +7) and the drums 2 dB down at 220 Hz; the hats are a little wide in the kit itself. To rebuild
the earlier mix add `"space":false,"eq":{"bass":[-4,170,7,450,-9,4000,8,9000],"drums":[0,400,0,2500,0,4500,5]}`
(the hats stay wide: that is the kit's sound now).

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
byte-identical. Version 2's MP3 has md5 `1e73254683dae9de1c5df77ba8057c36` (fingerprint
`9ba84ba8`; version 1's was `47d82499…`, `4bbe03e4`). Extra arg `"stems":true` (or a list of track
ids) writes each track alone as a WAV, for checks like the ones below.

Every Fledge Synth track plays a built-in preset as it is, so nothing hides in custom values:
**Lead/Soaring Saw** (lead and its octave double), **Chords/Silk Stack**, **Pad/Silk Wash**,
**Bass/Round Root**, **Keys/Vowel Chop**, **Keys/Glass Pluck**, **FX/Reverse Swell**, plus
**Bass/Clean Sub**, **FX/Riser** and **FX/Downlifter**. The piano is the Concert Grand (two tracks:
the accompaniment and the tune); recorded strings: String Section (held), Violins (the tune) and
Violins Short (an 8th ostinato). Drums: the Designed Kit with the presets Punchy short kick, Tight
dry snare (row +3 dB), Crisp clap (+2), Tight closed hat (-4), Open hat, Washy crash, Ping ride (-9),
Low and Mid tom, and Shaker on the Perc row (-6); a second kit plays Drop impact at the drops. Mix: Duck
to kick "Future bass / artcore" with the music's pump set to -1 dB and the sub's to -3 dB, shared
reverb 3.2 s, the Loud master on (Loud, no Crunch), exported at -10 LUFS.

| bars (app) | section | what it does |
|---|---|---|
| 1–8 | Intro | take A3's: piano 8th broken chords; from bar 5 the tune on the piano (A'), the wash, the bass, hats, a half breakbeat and a fill |
| 9–16 | Verse | the tune on the piano (A A'), a glass pluck an octave over it the second time; half-time drums; a first vowel-chop answer where the tune holds |
| 17–24 | Lift | the supersaw lead's first entry (B, then A') with the held stack, the string section swelling and piano 16ths, but no kick, bass or sub; a riser and snare build; beat 4 of bar 24 stops, a reverse swell fills it |
| 25–40 | Drop 1 | take A3's drop: A, A', A an octave up, the lifted B; piano 16th arpeggios and runs in the gaps; strings holding the falling top voice; the two-step breakbeat with a shaker in 16ths, a hat roll every 4 bars, an impact on the downbeat; a reverse swell into the post-drop |
| 41–48 | Post-drop | the lead rests; vowel chops cut the tune up in a syncopated 16th rhythm, short violins in 8ths under them; the stack out; the drums thin; a downlifter into the break |
| 49–56 | Break | piano with the wash and the strings: the chord struck once, a slow arpeggio, the tune (A A') in the right hand, the violins joining it softly |
| 57–60 | Swell | B on the piano, violins and glass pluck with it, the stack and strings swelling bar by bar, the bass back |
| 61–72 | Build | the lift again: the lead sings A, A' (doubled an octave up); then the pivot (Fm9, Bb13sus4, B13sus4, B7(b9)) with a four-on-the-floor kick, a riser, the tune climbing to D#6; a stop and a reverse swell |
| 73–104 | Drop 2 | in E: the A an octave up first (D#6 resolving to E6), then A', A, B; again A up, A', B, and B ending on the tonic held on E6; the lead's octave double (never above it); the violins singing the tune in its own octave; a short-violin 8th ostinato; the string section; impacts at bars 73 and 89; a riser and reverse swell into bar 89; from bar 89 a busier kick, an 8th-note bass, double-time fills (snare 16ths and 32nds, a kick-snare stutter); shaker 16ths and off-beat open hats throughout; a downlifter into the outro |
| 105–115 | Outro, end | back to the intro's piano with the tune once more (A A', the violins with it at first), strings fading, the drums thinning out, then Emaj9 rolled up and held |

Measured (decoded MP3, version 2): whole song -10.1 LUFS, true peak -1.7 dBTP, loudness range 2.9
LU; drop 1 -9.7 LUFS (hit check: crest 10.4 dB, kick 3.9 dB over the mix, presence -18.4, air -23.9),
drop 2 -9.0 (crest 9.9, presence -18.6); intro -12.9, verse -10.8, lift -10.1, post-drop -10.3,
break -11.5, build -10.5, outro -11.6. Five sample-level spikes 20–30 ms after snare hits (snare
tails), none elsewhere. Still flagged: "bass pattern repeats by the bar" (off-barline harmony, as take
A), the sub ducking a little long under the snare (-8 / -10 dB), drop 2's crest 0.1 dB under 10.

### Version 2: what the owner heard, what it was, what changed

"Very squeaky, lost the punch of take A3, weird stuff in the background, needs drums and effects,
violins maybe, something bouncy and out of tune." Each track was rendered alone (`stems`) and measured
in the drops: its share of 2–6 kHz and narrow peaks over 2 kHz, the fundamental of every long note
against equal temperament, the partials against the harmonics, and the envelope's strongest rates.

- **Squeaky.** Keys/Glass Pluck used the metallic wave two octaves up with a top boost: 2–6 kHz was
  its loudest band, with narrow peaks 37 dB over their surroundings at 4 and 10 kHz, and it doubled the
  piano's runs up to D8 plus a high 8th sparkle. Keys/Vowel Chop's vowel wave rang at 10 kHz (+23 dB), with 6 kHz and up only 7.5 dB under its total.
  The lead's octave double above an already octave-up lead added more 2–6 kHz. Fix: Glass Pluck now a
  harmonic wave with a soft top, used only on the tune; Vowel Chop darker (2.4 kHz low-pass: 6 kHz and
  up now 19 dB under its total) and used only in the post-drop; the doubles never above the lead; the lead a little darker
  and its track 2 dB lower at 3.2 kHz. Drop 2's presence went from -14.7 to -18.6 dB (target -20…-15.5).
- **Out of tune.** Glass Pluck's partials were on average 33 cents off the harmonics (the metallic
  wave is inharmonic), the loudest "wrong" notes in the mix. The lead's voices spread about ±13 cents
  (detune) with a ±14-cent vibrato, and the saw stack and lead went through two choruses (the preset's
  and the track's, depth 0.7). Vowel Chop scooped up 0.7 semitone into every note and picked a random
  vowel per note. Fix: Glass Pluck harmonic; Soaring Saw detuned less (0.42 / 0.22) with a ±6-cent
  vibrato coming in later; Silk Stack's own chorus and random detune removed, Silk Wash's chorus lighter,
  the tracks' chorus depth 0.7 → 0.3; Vowel Chop's scoop and random vowel removed. Measured now: Glass Pluck's partials
  within 1 cent of the harmonics; lead, violins and strings within 2 cents of equal temperament on the
  median, the lead's notes more than 15 cents off down from 5% to 1%. The Concert Grand's samples sit
  about 6 cents sharp (median over the tune's notes), in version 1 too and in take A3: left as it is.
- **Bouncy.** Three presets had a dotted-eighth echo (Soaring Saw, Vowel Chop, Glass Pluck), so every
  note came back off the beat in three layers; the vowel chops' counter-hook added off-beat 16ths all
  through drop 2 (the chop track's envelope peaked at 0.62 of a beat). Fix: echoes off, except a quiet
  quarter-note one on the lead; the counter-hook removed.
- **Weird stuff in the background.** The drop-2 vowel-chop answers, the glass doubling of the runs, the
  high sparkle and the chorus wobble. All gone; drop 2's extra layers are now strings (violins with the
  tune, a short-violin ostinato, the section), all in tune with the piano and lead.
- **Lost the punch.** The drums stood 2.9 dB (kick) and 1.8 dB (snare) over the mix in drop 1, about
  as in take A3 (3.0 / 1.6), but drop 2 was denser and the whole bed (wash + stack + chops + glass) sat
  where the snare speaks. Fix: drums +2.5 dB, the snare row +3 and clap +2, no wash in the drops (the
  strings hold the harmony), the stack a little softer, an impact on each drop. Drop 1's kick now stands
  3.9 dB over the mix (A3 3.0) and rises 2.2 dB out of the 60 ms before it in 40–150 Hz (A3 0.9); the
  snare's peak is held by the Loud master's limiter (1.5–1.8 dB over the mix, as A3), so raising its row
  more only adds limiting.
- **Background.** A shaker in 16ths through the drops (8ths in the verse), off-beat open hats in drop 2,
  a hat roll every 4 bars in drop 1, impacts, more risers, a reverse swell into bar 89 and into the
  post-drop, a downlifter into the outro, and the recorded strings.

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

## Night Rails: Off the Rails as melodic house (not signed off yet)

Script: `scripts/demos/house-song.js` (3:00, 140 BPM four on the floor, D major with phrygian borrowings, the last
drop a whole step up in E). The owner liked Off the Rails and asked for a more melodic, slightly faster version
in modern house, after their favourite house track. That reference measured: 135.000 BPM; kick on every beat,
short open hats on every off-beat, claps on 2 and 4, straight 8ths; a sustained bass that owns 35-110 Hz
between the kicks (dipping 10-12 dB on the beat, holding through the off-beat half); music pump only about 2 dB;
D with Bb, C and Eb around a major tonic; held strings and choir in a dark breakdown; -8.1 LUFS, crest ~10,
presence and air around -15/-16 dB, wide mids. 140 BPM is a little faster than the reference and still house
(Off the Rails' own 150-175 is past house tempo).

```
OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/house-song.js '{"file":"night-rails","save":true}'
```

The saved file, copied into `songs/` and run with `'{"open":"/songs/night-rails.fledgetone.json"}'`, opens
through the app's open path in a fresh browser and exports to the identical MP3.

The hook is Off the Rails' 3+3+2 idea made singable, two 4-bar halves (16ths: 6, 6, 4 a bar):
A over D | Bbmaj7 | Cadd9 | Asus4: F#5 A5 D6 | D6 Bb5 F5 | E5 G5 A5 | E5 (held) A4;
B over D | Ebmaj7 | Gm9 | A7: F#5 A5 D6 | Eb6 D6 Bb5 | Bb5 A5 G5 | A5 G5 E5.
What carries it: the plucky saw (verse, builds), the soaring saw (drops, an octave up in the last), the
violins (breakdown). The engine from Off the Rails: Hard drop kick (its tail tuned to A1 and shortened to 0.22 s
so the bass owns the low end between kicks, as in the reference) on every beat; the Driven Legato bass rolling
on the off-beats over a Clean Sub that holds the root and dips 10 dB under each kick. House sounds made from
Fledge presets (listed in the sound list): a chord stab (Silk Stack with a 0.22 s decay and no sustain, its
Filter insert swept open in the intro and closed in the outro), a plucky saw lead (Soaring Saw, sustain 0.15).

The map: intro (the groove from bar 1, the bass and stabs opening up) 0:00; verse (the hook on the pluck)
0:14; groove (drums, bass and short violins bouncing) 0:27; build 0:41; drop 1 (the hook on the soaring
lead, strings, stabs) 0:48; the chop break (off the rails: the vowel chop stutters the hook's figure, the bass
turns into Off the Rails' octave-leaping riff, Drop pad gate, crush and stutters) 1:15; breakdown (drums out:
strings, choir and the violins singing the hook over D Ebmaj9 C Asus4 | Bm7 Eb Gm9 A7, a timpani roll)
1:29; build 2 with a fake drop (two beats, then Tape stop, the hook's opening stuttered up into the new key)
1:50; final drop in E with brass and choir, the hook an octave up 2:03; outro 2:45. Whole song -9.0 LUFS,
drops -8.2 and -7.4, decoded true peak -1.8 dBTP.

## Mix balance and width (all three demos)

Measured against eight professional reference drops (their median third-octave balance, each spectrum relative to
its own total power), our drops stood 3 to 9 dB too hot around 200 Hz and were nearly mono above 8 kHz (side 10 to
15 dB under the middle, left-right correlation 0.80 to 0.94, where the references sit at -1.3 to -8.7 dB and 0.15 to
0.76, median -5.2 and 0.53). Above 8 kHz our mixes are mostly drums, and every synthesized kit was folded to mono.

What changed, for every song (the first) and in the three demo scripts (the rest):
- **The kits' hats, cymbals and shakers in stereo** (drumSynth.ts `renderDrumStereo`): the noise of each `hat` and
  `shaker` layer gets a side made of two more renders with other seeds (their difference: noise only, the metal and the
  other layers cancel), high-passed at 1.2 kHz, at 0.55 of the middle; the middle is the mono hit exactly and both sides
  are turned down so each speaker carries the energy the mono hit did. The track strip folds the Designed Kit and the
  synthesized kits to mono only under 1 kHz. Alone: side 5 to 10 dB under the middle, the mono sum 0.4 to 1.3 dB quieter.
- **Make space** (`makeSpace.ts`), run by the scripts unless `"space":false`: -2 dB at 280 Hz on parts under middle D,
  -3 dB at about 2.5 times the middle note on a bass over a sub, +1.5 dB from 5 kHz on the lead. Bands the scripts set
  by hand are left alone, so in these demos it mostly adds low cuts and the 280 Hz dip on the pads and stacks.
- **Less low-mid boost by hand**: the Driven Legato basses' 170 Hz bell +7 → +3 dB (colour-bass drop, Off the Rails'
  drop 2), +3 → +1 (Off the Rails' bass), +2 → +1 (Night Rails); every drum track -2 dB at 220 Hz (was a flat band).

Measured on the decoded MP3s, before (commit `c0b16d37`) → after, dB against the reference median:

| drop | 157 Hz | 198 Hz | 250 Hz | 4-8 kHz share | over 8 kHz: side / correlation | whole file |
|---|---|---|---|---|---|---|
| Colour-bass drop | +5.0 → +3.0 | +5.8 → +4.3 | +6.1 → +4.8 | -14.4 → -13.5 | -12.7 / 0.90 → -8.3 / 0.74 | -7.4 → -7.5 LUFS |
| Off the Rails, drop 1 | +1.5 → +0.6 | +9.0 → +7.9 | +5.8 → +5.2 | -16.4 → -16.0 | -14.5 / 0.93 → -13.5 / 0.91 | -10.3 → -9.9 |
| Off the Rails, drop 2 | +4.8 → +3.1 | +8.2 → +6.7 | +5.5 → +4.5 | -14.7 → -13.7 | -14.9 / 0.94 → -9.4 / 0.79 | |
| Off the Rails, final | +2.0 → +1.0 | +7.1 → +6.0 | +6.3 → +5.5 | -15.7 → -15.4 | -12.8 / 0.90 → -12.3 / 0.89 | |
| Night Rails, drop 1 | +1.1 → +0.4 | +2.8 → +1.7 | +4.0 → +3.2 | -16.8 → -16.6 | -10.7 / 0.84 → -7.0 / 0.67 | -10.0 → -10.3 |
| Night Rails, final | +0.5 → -0.2 | +2.6 → +1.5 | +3.6 → +2.8 | -16.1 → -16.0 | -9.6 / 0.80 → -6.5 / 0.63 | |

Every export still lands on its Loud target before encoding (-6.1, -9, -9 LUFS). What is left around 200 Hz is the
Driven Legato bass's own harmonics (over half the energy there), the kicks' knock and snares' bodies (most of the rest),
and about 1 dB from the Crunch clipper; Off the Rails' drop 1 and final drop stay narrow because their hats are
quiet against the kick and snare there. The starters play recorded kits (Lo-Fi's Break Kit is low-passed at 5 kHz), so
their balance and loudness didn't move (Lo-Fi re-measured at -14.7 LUFS with its 3.5 dB trim, as in the table).

**The driven basses' low mids, in the presets** (Fledge Synth, so every song with them): Driven Legato -6 dB at
210 Hz (Fledge's EQ mid, Q 0.9: its two clip stages piled the second and third harmonics of every low note there),
Hard Clip Stab and Clipped Square -3 dB at 220 Hz; each preset's Level raised to keep its loudness (held notes
within 0.3 dB of before at C2, C3 and C4; the 60-100 Hz body within 0.5 dB, 125 Hz -2.6 dB on Driven Legato).
Measured as above, before (commit `a9c6f51c`) → after, dB against the reference median:

| drop | 125 Hz | 157 Hz | 198 Hz | 250 Hz | 62 / 79 / 99 Hz |
|---|---|---|---|---|---|
| Colour-bass drop | +2.3 → +1.8 | +2.9 → +1.0 | +4.3 → +3.2 | +4.8 → +2.8 | -0.2 / -4.5 / -3.8 → +0.2 / -4.2 / -3.6 |
| Off the Rails, drop 1 | +0.1 → -0.1 | +0.6 → -0.2 | +7.9 → +6.1 | +5.1 → +4.6 | +0.6 / -4.0 / -1.8 → +1.0 / -3.6 / -1.7 |
| Off the Rails, drop 2 | +2.8 → +2.3 | +3.1 → +1.6 | +6.6 → +4.9 | +4.5 → +3.2 | -0.9 / -2.6 / -0.7 → -0.3 / -2.1 / -0.5 |
| Off the Rails, final | +1.8 → +1.6 | +1.0 → +0.1 | +6.0 → +5.2 | +5.5 → +4.0 | +1.8 / -1.7 / -2.2 → +2.1 / -1.4 / -2.1 |

The masters land as before (colour-bass drop -6.1 LUFS, push 10.0 → 10.2 dB); its MP3 comes out 0.5 dB lower after
encoding (true peak -1.6 dBTP), so it decodes at -8.0 LUFS (was -7.2). With the bass eased, what's left at 198 Hz in
Off the Rails is mostly the drums: rendered alone through the master, the drums carry about 80% of the energy there in
drop 1 and the final drop and 75% in drop 2, the two Driven Legato basses 15 to 40%, the stabs 15% in drop 2.
