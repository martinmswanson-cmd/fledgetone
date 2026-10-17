---
title: Mix and master
summary: Take a finished song and mix it yourself: levels, panning, EQ, compression, reverb and delay, a drum bus, then a master that's ready for streaming.
level: Intermediate
time: 30 minutes
---
Mixing is making every part of a song heard: nothing buried, nothing poking out, the low end solid. In this lesson you'll take the **Synthwave** starter, flatten its mix and build it back up the way a mix engineer works: levels, panning, EQ, compression, reverb and delay, a drum bus, and last of all the master. Every move comes with exact values. Open [the studio](https://fledgetone.com/app/) in another tab and follow along.

### Open the song and the Mixer

1. **File › New…**, type *synthwave* and click **Synthwave**.
2. Click the **Mixer** tab in the bottom panel. Each track has a strip: the **REV** and **DLY** sends, **PAN**, a meter and a fader.
3. Click **FX Rack** in the toolbar to open the **Inspector** on the right. Click a track's name in the Mixer to show it there.

### Levels first

Most of a mix is the faders. Get the balance right and the rest is polish.

1. Double-click each of the six faders in the Mixer. Each jumps to **0 dB**. Press **Space**: the pad and strings smother the lead and the drums lose their punch.
2. Click **M** on every strip except **Drums**, so you hear the drums alone.
3. Set the faders to these levels, unmuting one track at a time in this order. Drag a fader and read its level under it; for fine steps, click it and use the arrow keys (0.5 dB a press).

| Track | Fader | Why |
|---|---|---|
| Drums | -4 dB | the loudest part: the kick and snare carry the groove |
| Bass | -6 dB | just under the kick, so both are heard |
| Lead | -8 dB | the melody, in front of everything else |
| Arp | -12 dB | busy, so it sits back |
| Strings | -14 dB | a bed for the lead |
| Poly pad | -16 dB | furthest back: felt more than heard |

Start with what drives the song (drums and bass), then the main part (the lead), then fill in around it, each part just loud enough to notice.

{{shot:mix-levels}}

> Mix quietly. Loud, everything sounds exciting; quiet, you hear what's really too loud or lost.

### Pan the parts apart

Two parts in the middle cover each other. Panning gives each its own place across the speakers.

1. Drag the **Strings** strip's **PAN** to the left until it reads **L30**.
2. Drag the **Arp** strip's **PAN** to the right until it reads **R30**.
3. Leave **Drums**, **Bass** and **Lead** in the middle (**C**). The low end and the melody belong there, so they stay strong on a phone speaker.

### EQ: cut what each part doesn't need

Every part makes sound below its own notes: rumble and mud that crowd the bass. EQ is mostly cutting, not boosting, with the **Pro EQ** in each track's Inspector.

1. Click **Poly pad** in the Mixer and scroll the Inspector to **PRO EQ**. Make sure its switch reads **ON**, then click **Reset** under the graph for flat starting bands.
2. Click a numbered dot to pick a band; its shape, **FREQ**, **GAIN** and **Q** show under the graph. Drag the dot sideways for frequency and up or down for gain, or use the sliders.
3. Set the bands below, then do the same for **Strings**, **Arp** and **Lead**. Band 1, the **Low cut**, starts off: tick its box.

| Track | Band | Shape | Setting | What it does |
|---|---|---|---|---|
| Poly pad | 1 | Low cut | 150 Hz | takes away the rumble under the chords |
| Poly pad | 3 | Bell | 300 Hz, -3 dB, Q 1.4 | less mud in the low mids |
| Strings | 1 | Low cut | 120 Hz | leaves the bottom to the bass |
| Arp | 1 | Low cut | 250 Hz | a thin, bright arp that doesn't thicken the middle |
| Lead | 1 | Low cut | 200 Hz | the melody without boom |
| Lead | 4 | Bell | 2.5 kHz, +2 dB | a little presence, so it comes through |

Leave **Drums** and **Bass** alone: they own the low end. **Open big** shows the EQ in the **EQ & Dynamics** tab, with the track's sound drawn behind the curve while it plays.

{{shot:mix-eq}}

> A cut part sounds thin on its own. That's fine: what matters is how it sits in the mix. EQ with everything playing, and switch the EQ off and on to check you made it better, not just different.

**Make space** under the Mixer strips makes moves like these for you, on any song.

### Compress the bass

A compressor turns the loudest moments down, so a part stays even. Bass lines benefit most: every note should feel equally heavy.

1. Click **Bass** in the Mixer and find **COMPRESSOR** in the Inspector. Click **OFF** to switch it on.
2. Set **Threshold** to **-18 dB**: the level above which it starts turning down.
3. Set **Ratio** to **3:1**: how hard it turns down. 2:1 to 4:1 evens a part without squashing it.
4. Set **Makeup** to **+2 dB** to win back the level it took.

{{shot:mix-compressor}}

Switch it off and on while the bass plays: with it on, the bass sits steadier under the drums.

### Reverb and delay sends

Reverb puts a part in a room; delay gives it echoes in time. Each strip's **REV** and **DLY** sliders send some of the track to the shared **Master Reverb** and **Ping-Pong Echo**, so all the parts share one space.

| Track | REV | DLY |
|---|---|---|
| Drums | 10% | 0% |
| Bass | 0% | 0% |
| Poly pad | 40% | 0% |
| Strings | 30% | 0% |
| Arp | 0% | 25% |
| Lead | 30% | 20% |

Then open the Inspector's **Master** tab, scroll down to **PING-PONG ECHO DELAY** and click **1/8D**: a dotted-8th echo, classic on synthwave leads.

> Keep the bass and kick dry. Reverb on the low end makes the whole mix muddy.

### A bus for the drums

A **bus** is a track that other tracks play into, so they share one fader and one set of effects.

1. Choose **Track › Bus preset: Drum bus**.

A **Drum bus** appears under **Drums**, whose header now says **→ Drum bus**. The preset gives it glue compression (Threshold -16 dB, Ratio 4:1) and a little **Saturation**, so the kit hits as one. Every drum track goes through it, and its fader turns the whole kit up or down.

{{shot:mix-drum-bus}}

See [Buses](/guide/mixing-and-effects/#buses-group-channels) for the other presets and routing by hand.

### The master

Everything goes through the master on its way out. Open the Inspector's **Master** tab, click **5** on the ruler and press **Space**: the song plays from bar 5, where the full beat comes in.

1. **Loudness** at the top measures the song as streaming services do, in **LUFS**. Watch **Since Play**: everything since you pressed Play.
2. Set **Glue**, the master compressor, to **Punchy**: it lets each drum hit through before it holds the rest.
3. Make sure **OTT** is **ON** and set **Depth** to **20%**. It squeezes the lows, mids and highs separately, for a denser, brighter mix. A little goes a long way.
4. Set **Stereo Width** to **120%**, with **Keep the bass in the middle** ticked.
5. Set **Level** to **-0.5 dB**. It turns the whole mix up or down just before the limiter. Aim for **Since Play** around **-14 LUFS**, where streaming services play; with these settings the mix exports at about -14 LUFS.

{{shot:mix-master}}

The **limiter** at the very end keeps the true peak under -1 dBTP, so the song never clips.

### What to listen for

Ears get used to a mix in minutes. Near the bottom of the Master tab, the **Mix check** listens for you.

1. Set **Going to** to **Streaming (-14 LUFS)** and click **Check the mix**. It renders the song and each track and says what to look at.
2. On this mix it flags **Bass** and **Lead** covering each other between 250 and 400 Hz. Click **Lead** in the Mixer, then **Track FX**, pick band **3** on its Pro EQ and set it to **300 Hz**, **-3 dB**. Back on the **Master** tab, click **Check again**: nothing to flag.

{{shot:mix-check}}

Then listen for yourself:

- **The low end**: are the kick and bass two things? If they blur, try a **PUMP** on the bass following the kick.
- **The lead**: can you follow the melody without straining?
- **Small speakers**: on a phone, does the bass vanish?
- **A reference**: load a song you like under **Reference** and flip between it and yours with **A / B**, at the same loudness.

### Louder, for the club

Club and EDM masters sit around -9 LUFS. Set **Level** to **+3 dB** and switch the **Clipper** on with **Drive** at **+4 dB**: it shaves the tallest drum peaks flat before the limiter, so the mix gets louder with less squashing. Past 3 to 4 dB on its meter it sounds crunchy.

{{shot:mix-clipper}}

> Don't master loud for streaming: services turn it down to -14 LUFS, and all you keep is the squashing.

### Export at the right loudness

In the **Export** dialog, tick **Match a loudness target** and pick where the song is going: **Streaming (-14 LUFS)**, **Loud: club and EDM (-9 LUFS)**, **Games (-16 LUFS)** and more. The file is turned to that level as it renders. [Export, share and finish](/learn/export-and-share/) covers every choice.

### What's next

You've set levels, panned, EQ'd, compressed, added space, bussed the drums and mastered for streaming. More in the guide: [Mixing and effects](/guide/mixing-and-effects/). Next, add a voice: [Record and polish vocals](/learn/vocals/).

{{example:synthwave-mix}}
