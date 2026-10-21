# Game music players

{{HEADER}}

Players for adaptive game music made in Fledgetone, for the web, Godot 4 and Unity. Each one is a
single file you drop into your game.

## What they play: a game kit

In the Fledgetone studio, **Export › Game kit** turns a song into a folder your game can use:

- `audio_manifest.json`: the song's states, transitions, stingers, intensity curves, parameters
  and sound effects, with their timings
- every state as a seamless loop (and its stems, if the song has stem groups)
- the transitions, bridges and stingers, and your sound effects, as audio files

These players read that folder and play it the way the song was set up: they switch states on
the next bar, beat or phrase, crossfade the stem groups as the intensity changes, play stingers on
the beat, and play sound effects with a different variation each time.

A game kit already has these players inside it. Download them here if you want the latest
versions, or want to read or change them.

## What's in this zip

| File | What it is |
| --- | --- |
| `web/adaptive-music.js` | The player for web games (Web Audio, no libraries) |
| `web/adaptive-music.d.ts` | Its TypeScript types |
| `godot/AdaptiveMusic.gd` | The player for Godot 4 |
| `godot/music_example.gd`, `godot/music_example.tscn` | A scene to try it: run it with F6 |
| `unity/AdaptiveMusic.cs` | The player for Unity |
| `unity/AdaptiveMusicExample.cs` | A component to try it: buttons for every state and sound |
| `LICENSE` | The GNU General Public License, version 3 |

## Web

Put the game kit's folder (the one with `audio_manifest.json`) and `adaptive-music.js` on your
site. Browsers start sound only after a click or a key press.

```js
import { AdaptiveMusic } from './adaptive-music.js';

const music = new AdaptiveMusic();       // or new AdaptiveMusic(yourAudioContext, yourMixerNode)
await music.load('music/');              // the folder with audio_manifest.json in it
startButton.onclick = () => music.play('Explore');
music.setState('Combat');                // by the song's transition rules
music.setIntensity(0.8);                 // 0 to 1: the stem groups crossfade along their curves
music.stinger('Victory');                // over the music, on the next beat
music.setParameter('danger', 0.7);       // one of the song's parameters, 0 to 1
music.setEffect('underwater');           // 'muffled', 'lowHealth', 'dream', 'none'
music.setCostume('8-bit');               // the same music played another way (null: back)
music.playSfx('sword_hit');              // a sound effect
const rain = music.playSfx('rain');      // a looping one plays until rain.stop()
music.setVolume(0.8); music.setSfxVolume(0.6);
music.stop();
```

All the calls: `load(baseUrl)`, `play(state)`, `setState(state, unit?)` (unit: `'bar'`, `'beat'`,
`'phrase'`, `'end'` or `'now'`), `setIntensity(value, seconds?)`, `stinger(name, unit?)`,
`setCostume(name, seconds?)`, `costumeNames`, `setEffect(name, seconds?)`, `setFilter(hz, seconds?)`,
`setReverb(amount, seconds?)`, `setParameter(name, value, seconds?)`, `getParameter(name)`,
`parameterNames`, `playSfx(name, { volume, pitch, when }?)`, `stopSfx(name?, fade?)`, `sfxNames`,
`setVolume(volume, seconds?)`, `setSfxVolume(volume, seconds?)`, `stop()`, `dispose()`.
See `adaptive-music.d.ts` for the types.

## Godot 4

1. Copy the game kit's folder into your project, for example `res://music/`.
2. Copy `AdaptiveMusic.gd` into your project too. Add it to a Node and set **Music Dir** in the
   Inspector, or make it an autoload called `Music` and call `Music.load_song("res://music/")` once.
3. Call it from your game:

```gdscript
Music.load_song("res://music/")
Music.play("Explore")
Music.set_state("Combat")          # by the song's transition rules
Music.set_intensity(0.8)           # bring the layers in
Music.stinger("Victory")
Music.set_parameter("danger", 0.7)
Music.set_effect("underwater")     # "muffled", "lowHealth", "dream", "none"
Music.set_costume("8-bit")         # "" to go back
Music.play_sfx("sword_hit")        # a different variation each time
var rain = Music.play_sfx("rain")  # loops until rain.stop() or Music.stop_sfx("rain")
Music.stop()
```

To try it: copy `music_example.gd` and `music_example.tscn` next to `AdaptiveMusic.gd` in
`res://bos_music/`, open the scene, set the Music node's **Music Dir** to your kit's folder, and
press F6. Keys 1 to 9 switch states, Up and Down change the intensity, Space plays a stinger and
A to Z play sound effects.

The player sends music to the **Bus** you choose (and sound effects to **Sfx Bus**). It also has
`set_filter`, `set_reverb`, `time_to_next`, `parameter_names`, `get_parameter`, `costume_names`,
`sfx_names` and `stop_sfx`.

## Unity

1. Copy the game kit's folder into `Assets/Resources/Music/` (the manifest becomes a TextAsset and
   the WAV files AudioClips).
2. Copy `AdaptiveMusic.cs` into `Assets/`. Add the **AdaptiveMusic** component to a GameObject and
   leave **Resources Folder** as `Music`.
3. Call it from your scripts:

```csharp
var music = GetComponent<AdaptiveMusic>();
music.Play("Explore");
music.SetState("Combat");          // by the song's transition rules
music.SetIntensity(0.8f);
music.Stinger("Victory");
music.SetParameter("danger", 0.7f);
music.SetEffect("underwater");     // "muffled", "lowHealth", "dream", "none"
music.SetCostume("8-bit");         // null to go back
music.PlaySfx("sword_hit");        // a different variation each time
music.StopSfx("rain");
music.Stop();
```

To try it: add `AdaptiveMusicExample.cs` to the same GameObject and press Play. It shows a button
for every state, stinger and sound effect, and an intensity slider. Changes are timed on Unity's
audio clock, so they land on the beat.

{{LICENCE}}

### Inside a game kit

When these players come inside a game kit you export from the studio, they come with an extra
permission (the kit's `LICENSE-exported-files.txt`, and section 3 of Fledgetone's terms): there
they can ship inside any game, closed-source and paid games too, with no need to share your own
code; but if you change the players themselves and distribute them, the changed files stay under
the GPL, with their source. The files in this download are offered under the GPL, as above.
