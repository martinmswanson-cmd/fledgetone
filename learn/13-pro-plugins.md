---
title: Mix with Fledgetone's own plugins
summary: Carve room for a melody, tame what rings out, treat the centre and the sides apart, warm the bass in its own band and move a part in time with the song.
level: Advanced
time: 35 minutes
---
Fledgetone has a set of plugins of its own, made for it: you find them under **Plugins**, beside the hundreds of open-source ones. This lesson uses five of them on the **Lo-Fi** starter, each for the job it was made for. None of them adds any delay, so every track stays in time. If you haven't mixed a song before, do [Mix and master](/learn/mix-and-master/) first: these are the tools for what faders, panning and a plain EQ can't fix.

### Open the song, and turn the sound on

1. **File › New…** and click **Lo-Fi**.
2. Press **Space** to play it for a few bars, then **Space** again to stop. A plugin takes a preset only once the audio is running, so do this before anything else.

Five shortcuts are worth learning now, because you'll use them all through:

| Keys | Opens |
|---|---|
| `Shift+P` | The plugin browser (effects go on the selected track) |
| `Shift+A` | The spectrum analyser |
| `Shift+T` | The tuner |
| `Shift+F` | The FX Rack |
| `Shift+X` | The Mixer |

### Make room for the flute: Fledge Carve

The flute is the melody and the keys are the chords, and they sit in the same range, so the keys blur the flute. Turning the keys down loses them between phrases. A sidechain compressor would duck all of the keys whenever the flute plays. **Fledge Carve** takes away only the frequencies the flute is using, only while it plays.

1. Click the **Keys** track's name to select it.
2. Press `Shift+P`, type **carve** in the search box and click **Add**. Its window opens.
3. At the top of the window, beside **Sidechain from**, choose **Flute**. Until you pick a track, Carve does nothing.
4. Open **Preset** and choose **Pads under the lead**: up to 9 dB, from 300 Hz upwards, so the keys keep their low notes.
5. Press **Space**. Switch **Removed only** on: you hear just what is being taken out, a faint shadow of the keys in the shape of the flute's tune. Switch it off again.

{{shot:pro-carve}}

**Amount** is the most any band is turned down. 6 to 9 dB is plenty in a mix; more than that is an effect. **Threshold** is how loud the flute must be in a band before that band counts.

> If you solo the Keys to listen, solo the Flute too. A soloed track silences the others, and Carve then has nothing to follow.

### See where two parts clash

1. Press `Shift+A` for the **Spectrum analyser**.
2. Beside **Show**, choose **Keys**. Beside **Against**, choose **Flute**. Press **Space**.

The filled shape is the keys and the line is the flute. Where both are high in the same place, they are fighting: that is the range Carve is working in. Click **Hold peaks** to keep the highest each has reached.

{{shot:pro-analyser}}

### Tame what rings out: Fledge Smooth

A flute, a voice or a bright synth has moments where one narrow range jumps out and sounds harsh. An EQ cut would dull it all the time. **Fledge Smooth** listens in 28 narrow bands and turns one down only while it stands out from the bands around it.

1. Select the **Flute**, press `Shift+P`, search **smooth** and click **Add**.
2. Choose the preset **Soften a vocal**: it works on 2 to 10 kHz, where the harshness is.
3. Play, and switch **Removed only** on. You should hear thin, whistling scraps. Turn **Depth** up until you start to hear the tune itself in there, then back it off a little and switch **Removed only** off.

{{shot:pro-smooth}}

**Stands out by** is how far over its neighbours a band must be before it's touched: lower catches more, higher only the worst. **Attack** is how fast it catches a ringing.

### A band that moves: Fledge Dynamic EQ

The upright bass has a few notes that boom and others that don't. Cut 120 Hz with an ordinary EQ and the quiet notes go thin. A band of the **Dynamic EQ** can turn down only while its own range is loud.

1. Select the **Bass**, press `Shift+P`, search **dynamic** and click **Add**.
2. Choose the preset **Tame the boom, only when it booms**. Look at **Band 1**: **frequency** 120 Hz, **gain** 0 dB, **moves by** -8 dB, **threshold** -26 dB. With a gain of 0 it does nothing until that range passes the threshold; then it turns down by up to 8 dB and eases back.

{{shot:pro-dyneq}}

Each band also has **works on**: **Stereo** (both sides), **Mid** (what the two speakers share: the centre) or **Side** (where they differ: the width).

3. Select the **Keys**, add another **Fledge Dynamic EQ** and choose **Wider top**: a 4 dB lift at 10 kHz on the **Side** only. The keys open out at the edges and the centre stays as it was.

> **Bass in the middle** is the same idea turned round: a deep cut at 70 Hz on the Side, so the low end sits in the centre. Use it on a wide synth bass or on a bus.

### Warm the bass in its own band: Fledge Heat

Distortion adds harmonics, and harmonics are what a phone speaker can still play when the low notes themselves are too deep for it. But drive a whole bass and its top turns to fuzz. **Fledge Heat** splits the sound into lows, mids and highs and gives each its own kind of distortion.

1. With the **Bass** selected, press `Shift+P`, search **heat** and click **Add**. A fresh one does nothing: every band is **Clean**.
2. Choose the preset **Bass that speaks on small speakers**: the lows through **Tube**, a little **Warm** in the mids, the highs left clean.
3. Click **Bypass** at the top of the window a few times as it plays. If it's louder with Heat on, bring **Low level** down until on and off are as loud as each other: louder always sounds better, so match them before you judge.

{{shot:pro-heat}}

On a loud sound, more drive is more grit at the same level. A quiet sound comes up with the drive, which is why you match the level by ear.

### Move a part in time: Fledge Shape

The rain is a steady wash. Make it breathe with the beat.

1. Select the **Rain**, press `Shift+P`, search **shape** and click **Add**.
2. It starts on a **Duck** every quarter note. Set **Depth** to about **50 %**: the rain dips on each beat and swells back, like a pad ducked under a kick, with no kick needed.
3. Now try the preset **Filter falls every bar**: **Moves** changes to **Low-pass**, and the rain goes from bright to dull across each bar.

{{shot:pro-shape}}

**Every** sets how often the shape repeats, from 4 bars down to a 32nd. **Starts at** slides it along the beat: at 50 % a pump lands on the off-beat. It moves one thing at a time, so for a pump and a sweep together, add it twice.

### Check that each one earns its place

Every plugin window has **Bypass**. Play the song and switch each plugin off and on, one at a time:

- **Carve** on the Keys: is the flute easier to follow, without the keys sounding thinner between phrases?
- **Smooth** on the Flute: less harsh, but still bright?
- **Dynamic EQ** on the Bass: are the booming notes even with the others?
- **Heat** on the Bass: can you follow the bass line on a phone speaker?

If you can't hear a difference, take the plugin off. A mix with fewer things in it is easier to keep right.

### What's next

In the studio, the **Learn** menu has hands-on tutorials for these plugins and the others: **Make room in a mix**, **Pump, gate and stutter in time**, **Dynamic EQ, mid/side and saturation** and **Sound design lab** (drawing a wave from sine waves, a vocoder, a harmoniser, a frequency shifter and a spectral freeze). For the instruments themselves, see [Design your own sounds](/learn/sound-design/).
