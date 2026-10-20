---
title: Design your own sounds
summary: Build a pluck and a pad in the Synth Designer, make drums from scratch, shape a coin and a jump for a game, and turn your own recordings into instruments.
level: Advanced
time: 40 minutes
---
Presets get you started; your own sounds make a track yours. In this lesson you'll build two synth patches from a plain saw wave (a short pluck and a slow, wide pad), design a kick and a snare, make two classic game sounds, and play your own recordings from the Sampler, the Slicer and a Drum Rack. Every value is given, so you can match it exactly and then go your own way. Open [the studio](https://fledgetone.com/app/) in another tab and follow along.

### Start from a song

You'll design sounds in place, on parts that are already playing, so you hear each change in the music.

1. **File › New…**, type *space* and click **Space Station**. It's 105 BPM in E minor, with an **Arp**, a **Pad** and **Drums**.
2. Press **Space**. The loop plays the opening bars: the arp's 16th notes over the pad.

To change a track's instrument, click the sliders icon on its header to open the **Track Inspector**, click the instrument under **SOUND GENERATOR**, type a name and press **Enter**. The clips stay as they are.

> Exact values: drag a slider close to the number, then use the arrow keys to land on it. Double-click any slider to put it back. Every change is one Undo step and plays from the next note.

### A pluck in the Synth Designer

A synth sound is built in three stages. **Oscillators** make a raw tone, a **filter** takes away brightness, and **envelopes** shape how each note changes over time: how fast it starts (**Attack**), how quickly it falls (**Decay**), the level it holds at (**Sustain**) and how long it rings after you let go (**Release**). A pluck is bright for an instant, then dark and gone.

1. Switch the **Arp** track to **Synth Designer**. Its panel appears under the instrument.
2. **Load preset… › Init saw**: one plain saw wave, the blank page.
3. Set the rest from this table, top to bottom.

| Section | Setting | Value |
|---|---|---|
| Osc 2 | tick it, wave **Saw**, **Octave** | **+1** |
| Osc 2 | **Level** (leave **Fine** at +7 ct) | **40%** |
| Filter | **Low-pass**, **Cutoff** | **500 Hz** |
| Filter | **Reso** / **Env amt** | **4.0** / **+4.0 oct** |
| Filter envelope | **Decay** / **Sustain** | **180 ms** / **0%** |
| Amp envelope | **Decay** / **Sustain** / **Release** | **350 ms** / **0%** / **200 ms** |

{{shot:sound-pluck}}

Play it. The second saw an octave up, 7 cents off, makes it shimmer. The filter sits low at 500 Hz, and its envelope throws it four octaves open at each note, then closes it in 180 ms: that's the "pluck". **Reso** puts a little ring on the sweep. With the amp's **Sustain** at 0%, every note dies away in about a third of a second, however long it's written.

> Too clicky? Raise the amp **Attack** to 10 ms. Too dull? Raise **Cutoff** or **Env amt**. A pluck lives on its filter envelope's **Decay**: try 100 ms for a tight one, 400 ms for a softer one.

### A slow, wide pad

A pad is the opposite: it swells in, holds and fades out slowly, and it's wide.

1. Switch the **Pad** track to **Synth Designer** and choose **Load preset… › Init saw**.
2. Tick **Osc 2** and set its wave to **Saw** (leave Fine at +7 ct and Level at 60%).
3. Set the rest:

| Section | Setting | Value |
|---|---|---|
| Sub, noise and unison | **Unison** / **Spread** / **Width** | **5 voices** / **25 ct** / **90%** |
| Filter | **Ladder (warm, 24 dB)**, **Cutoff** | **1.2 kHz** |
| Filter | **Env amt** / **Drift** | **+1.0 oct** / **30%** |
| Filter envelope | **Attack** / **Decay** / **Sustain** / **Release** | **1.50 s** / **1.80 s** / **60%** / **2.00 s** |
| Amp envelope | **Attack** / **Decay** / **Sustain** / **Release** | **1.20 s** / **1.80 s** / **90%** / **2.00 s** |
| LFO | **Filter (wobble)**, **Sine**, **1/1**, **Depth** | **20%** |

{{shot:sound-pad}}

**Unison** stacks five copies of each saw, detuned across 25 cents and spread across the stereo field: that's the width. The **Ladder** filter is the warm, slightly driven kind on classic analog synths, and **Drift** makes every chord a touch different, as an analog synth does. The long attacks fade each chord in over a second, and the LFO at **1/1** opens and closes the filter once a bar, so the pad breathes in time.

All the Synth Designer's controls are in [the guide](/guide/instruments/#synth-designer).

### Drums from scratch: the Drum Designer

The **Designed Kit** is a drum kit synthesized in the browser: you design each row's sound.

1. Switch the **Drums** track to **Designed Kit**. The **Drum Designer** appears with a button for each row.
2. Click **Kick** (it plays). Set **Preset** to **Punchy short kick**, then **Pitch** to **48 Hz** and **Decay** to **400 ms**: a little deeper and longer.
3. Click **Snare**. Set **Preset** to **Crisp snare**.
4. Click **ADD LAYER**. A clap is stacked on the snare at **-8 dB**. Set its **Delay** to **8.0 ms**, so the clap lands just behind the snare's crack and widens it.

{{shot:sound-drum-designer}}

Each change plays the drum so you hear it as you go. Once you change anything the **Preset** box reads **Your own sound**, and the row's name turns bold. The sounds are rendered once and replayed, so a designed kit costs next to nothing to play and sounds the same in every export. More in [the guide](/guide/instruments/#drum-designer-your-own-hard-drums).

### Game sounds: a coin and a jump

The **sound effects maker** makes the sounds games are full of, from layers of simple sources. Open **File › New…** and choose **Platformer** for a game song to try them in, then open the **Sound FX** tab of the bottom panel.

1. Click **Retro**, then **Coin**. Each click makes a new coin and plays it.
2. Make it exactly this one: **Source** **square**, **Pitch** **990 Hz**, **Slide** **0 st**, **Jump** **+5 st**, **Jump at** **15%**, **Attack** **0 ms**, **Hold** **80 ms**, **Punch** **50%**, **Decay** **300 ms**, **Width** **50%**.

{{shot:sound-coin}}

That's the classic pickup: a bright square note that leaps up a fourth almost at once and rings out. Letting go of any slider plays it. **Tune to key** is on because the song has notes: it shows **B5**, a note of A minor, so the coin sits in the music.

Now the jump: click **Jump** and set **Source** **square**, **Pitch** about **330 Hz**, **Slide** **+12 st**, **Curve** **60%**, **Jump** **off**, **Attack** **0 ms**, **Hold** **40 ms**, **Punch** **0%**, **Decay** **200 ms**, **Width** **50%**. The **Slide** sweeps it up an octave, quickly at first (that's the **Curve**), like a body leaving the ground.

Click **Save** for a WAV or OGG file named for a game, **Add to song** to put it on an Audio track at the playhead, or **Keep** to keep it in **My sounds**. The same settings always make the same sound. More in [the guide](/guide/game-music/#sound-effects-maker).

> Want a whole family of sounds at once? **Make a set › Retro platformer** makes every sound that kind of game needs, in one style.

### Your own samples

Any recording can become an instrument: a note you sang, a hit you recorded, a loop you made.

- **Sampler**: **+ Add Track**, type *sampler*, **Enter**. Click **Load a sound…** and pick a file. **C4** plays it at its own pitch; higher notes play it faster and higher.
- **Slicer**: **+ Add Track**, type *slicer*, **Enter**, then **Load a sound…**. With **CUT** on **Auto** it cuts where it hears each new word or hit (**SENS** sets how faint a hit still counts) and puts **Slice 1** on C3, **Slice 2** on C#3, and so on. Click a slice to hear it, and write notes to play the chops in a new order.

{{shot:sound-slicer}}

- **Drum Rack**: **+ Add Track**, type *drum rack*, **Enter**, then **Load sounds…** and pick up to 16 files. They fill the pads in order from pad 1 (C2, bottom left). Click a pad for its **Level**, **Pan**, **Pitch**, **Decay**, filters and **Drive**. Put a closed and an open hi-hat in the same **Choke** group, and the closed one cuts the open one off.

{{shot:sound-drum-rack}}

> A vocal you recorded in [Record and polish vocals](/learn/vocals/) is perfect for the Slicer: right-click the take, **Chop sample…**, then **To a Slicer instead**.

### Plugins, briefly

**Plugins › Browse plugins…** opens hundreds of built-in effects and instruments: open-source plugins compiled to run in the browser. Search by what they do (*tape*, *warm*, *bell*), choose the track under **Effects go on**, and click **Add**. An instrument's **New track** makes a track that plays it. Each plugin's window has a slider for every setting. See [the guide](/guide/instruments/#plugins).

{{shot:sound-plugins}}

### What's next

You've built a pluck and a pad, designed drums, made game sounds and played your own recordings. Next, put sounds to pictures: [Score a video](/learn/score-a-video/).

The example is Space Station with this lesson's sounds: the pluck on the arp, the pad, and the designed kick and snare.

{{example:space-station-designed}}
