---
title: Game music that reacts
summary: Turn a song into music a game can steer: states to switch between, transitions, intensity layers and stingers, then export it for Godot, Unity, the web, FMOD or Wwise.
level: Advanced
time: 35 minutes
---
Game music can't just play from start to finish, because nobody knows how long a player will stay in one place. It has to loop, change when something happens, and get busier as things heat up. In this lesson you'll take a game starter, add a third state, choose how the music moves between states, set up intensity layers and stingers, hear it the way a game will play it, and export it for your engine.

### Open a game starter

1. Open **File › New…**, type *overworld* and click **Overworld Adventure**. It's 116 BPM in C major, with two sections marked on the ruler: **Explore** (bar 1) and **Danger** (bar 9).
2. Open **Game › Game panel (states, intensity, stingers)**. The **Game** tab opens in the bottom panel, in three columns: states and transitions, intensity, and stingers with the exports.

Every game starter comes set up like this, so they're good to learn from. See [Game music](/guide/game-music/) in the guide for every control.

### Markers are states

Each stretch between two markers is a **state**: one loop the game can ask for. Explore runs 8 bars, but its second half (with drums and the horn) feels like a journey, so make it a state of its own.

1. Click the **BAR.BEAT.TICK** readout, type *5* and press **Enter**. The playhead jumps to bar 5.
2. Press **M** to drop a marker there.
3. Double-click its flag on the ruler, type *Travel* and press **Enter**.

The Game tab now has three state buttons: **Explore**, **Travel** and **Danger**.

### Switch between states

1. Click **Explore**. It plays and loops bars 1 to 4. The playing state is green.
2. Click **Travel**. The button pulses amber while it waits for the next bar, then the music moves there.
3. Click **Danger**, then **Explore** again.

{{shot:game-states}}

The menu at the top of the column (**on the next bar**) sets when a switch with no rule of its own happens: the next bar, the next beat, or at once.

> Name states for what happens in the game (Explore, Combat, Boss), not musically (Verse, Bridge). The names travel into the exports, and the game's code asks for a state by its name.

### Choose how states hand over

1. Click **Transitions** under the states. A matrix opens: rows are the state you come **from**, columns the state you go **to**.
2. Click the cell in the **Travel** row and **Danger** column.
3. Set it to **Bridge**, **on the next phrase**, **of 4 bars**, and **2 bars: a turn, then the pull**.

{{shot:game-transitions}}

Here's what the starter's rules and your new one do:

| From → to | Rule | What you hear |
|---|---|---|
| Explore → Danger | Fill | a snare fill over the last beat, then Danger |
| Danger → Explore | XF 8 | Danger fades out as Explore fades in, over 8 beats |
| Travel → Danger | Bridge, 2 bars, next phrase | waits for the end of a 4-bar phrase, then plays Dm for a bar and E7 for a bar, landing on Danger's opening A minor |

The bridge is written from your song: E7 is the chord that pulls hardest into A minor, and Dm (chord iv) turns into it first. It plays on the song's own chords, bass and drums. Any cell that shows a dash has no rule and cuts on the next bar; a rule in the **Any** row applies from every state that doesn't have its own.

> The timeline can't play two parts of the song at once, so a crossfade cuts there. Use **Audition like the game** (below) to hear every rule exactly.

### Layer the intensity

Intensity is one number, 0 to 100%, that a game turns up as things get exciting. Each track belongs to a **stem group**, and each group has a curve for how loud it plays at each intensity.

1. In the middle column, set **Cello** to **Ambient** with the list beside it.
2. Click **Explore** to play, and drag **Intensity** down to **40%**.
3. Drag it slowly up to 100% and back while the music plays.

{{shot:game-intensity}}

At 40%, **Ambient** (harp, strings and now cello) plays at full level, **Percussion** at 80%, and **Tension** and **Climax** are silent. Higher up, the pizzicato comes in, then the horn near the top, while Ambient eases back to 60%. Drag a point on a curve to move it, click empty space to add one, double-click a point to remove it. The flute has no group, so it always plays at full level.

### Add stingers

Stingers are short cues the game plays over the music: a coin, a checkpoint, a win.

1. Open **+ Add a stinger…** at the top of the right column and choose **Checkpoint**.
2. While the music plays, click **Checkpoint**. It plays on the next bar, in the song's key.
3. Click the dice beside it for another version, and pick another sound from its instrument list.

{{shot:game-stingers}}

### Loop variations

A player who waits in one place for five minutes hears the same loop over and over. **Loop variations** (in the middle column) makes takes of the loop region with a different ending each.

1. Click **Travel**, so the loop covers bars 5 to 9.
2. In **Loop variations**, choose **3 takes** and click **Export**.

You get take A as written, B with a snare fill into the loop point and C with a tom fill, all the same length, for the game to rotate through.

### Audition like the game

1. Click **Audition like the game** in the right column. It renders every state, stem, stinger and transition exactly as the game kit will (it takes a little while).
2. Click the big **Explore** pad, then **Travel**, then **Danger**. Every switch follows your matrix, crossfades and the bridge included.
3. Fire the stinger pads, drag **Intensity**, and try the **Effect** buttons, such as **Underwater** and **Low health**.

{{shot:game-audition}}

### Try it in a game

1. Close the audition and click **Try it in a game**. A little 3D level opens with your song.
2. Walk with the arrow keys or **WASD**, and grab coins. Coins fire your **Item found** stinger.
3. Walk towards the cube guard. When it spots you the music switches to **Danger** through your Fill, and intensity rises as it gets closer. Jump on it with **Space** to beat it.
4. Click **Music wiring** and set **Win (stinger)** to **Victory**, then press **R** to restart and beat the guard again.

{{shot:game-try}}

Two more games are at the top of the window. Click **2D platformer** to run and jump to a flag past gaps, spikes and blobs: a blob that spots you switches the music to **Danger** the same way. Click **Rhythm game** and your song's own notes fall down four lanes; hit **D F J K** in time, on **Easy**, **Normal** or **Hard**. It's a quick way to hear whether a beat is fun to play along to.

> The panel at the top left shows the state and intensity, and the list under it says what the music just did and why. If a switch sounds wrong, it tells you which rule played.

### Export for your engine

1. In the right column, choose what the kit is **For**: **Godot 4 project (unzip into it)**, **Unity project (unzip into it)**, or **Any engine (web, Godot and Unity players)**.
2. Click **Export game kit (.zip)**.

For Godot, unzip it into the folder with `project.godot`, open `bos_music/<song>_example.tscn` and press **F6**: number keys switch states, **Up** and **Down** change intensity, **Space** plays a stinger. For Unity, unzip it into the folder with `Assets`, add an empty GameObject, choose **Add Component › Adaptive Music Example** and press **Play**. Either way you get every state as a seamless loop, the stems by group, the stingers and transition sounds, an `audio_manifest.json` with the curves and rules, a player script, and a README using your own state names.

Working in audio middleware instead? **Game › Export FMOD / Wwise package…** lays out the same music with a script that builds the event in **FMOD Studio** or a Music Switch Container in **Wwise**. The [game kit](/guide/game-music/#the-game-kit-everything-for-the-game-in-one-file) and [FMOD and Wwise](/guide/game-music/#fmod-and-wwise) guide sections list every file.

### What's next

You've made a song a game can steer: three states, transitions with a written bridge, intensity layers, stingers and loop takes, tested in a real level and exported. Next, finish and share your music: [Export, share and finish](/learn/export-and-share/).

{{example:overworld-states}}
