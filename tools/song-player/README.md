# Song player

{{HEADER}}

Plays a song saved from Fledgetone in a web page or browser game, with no audio files. You give
it the song's project file (the .json that **Save** makes in the studio, usually a few kilobytes);
it makes the music in the player's browser when the game loads, with the same sound engine as the
studio, then plays it like the game kit's player: states, transitions on the beat, intensity
layers, stingers and sound effects.

Use it when download size matters more than loading time. For the smallest wait, export a game
kit instead and use the game music players.

## What's in this zip

| File | What it is |
| --- | --- |
| `bos-player.js` | The player, one JavaScript module ({{PLAYER_SIZE}}, about {{PLAYER_GZIP}} when a web server compresses it) |
| `bos-player.d.ts`, `adaptive-music.d.ts` | TypeScript types |
| `index.html` | An example page: choose a saved song and play it |
| `THIRD-PARTY-LICENSES.txt` | The licences of the open-source libraries inside `bos-player.js` |
| `LICENSE` | The MIT licence |

## Try it

Serve this folder and open `index.html`, then choose a song you saved from the studio:

```sh
npx serve
```

## Use it

```js
import { loadSong } from './bos-player.js';

const music = await loadSong('music/my-song.json', {
  onProgress: (fraction, detail) => (progressBar.value = fraction),
});
startButton.onclick = () => music.play('Explore');   // browsers start sound only after a click
music.setState('Combat');                            // by the song's transition rules
music.setIntensity(0.8);                             // crossfades the stem groups
music.stinger('Victory');
```

`loadSong(source, options?)` takes a URL to the song's .json or the parsed JSON itself. Options:
`context` (your game's AudioContext, else it makes one), `destination` (an AudioNode to play
into, for your own mixer) and `onProgress`. It returns the same player as the web game music
player (`AdaptiveMusic`), with `play`, `setState`, `setIntensity`, `stinger`, `setParameter`,
`setEffect`, `setCostume`, `playSfx`, `setVolume`, `stop` and the rest: see
`adaptive-music.d.ts`.

Making the music takes a few seconds per minute of music, more on slow devices, so start
`loadSong` while your game loads and show a progress bar.

## What it downloads

Synth instruments need nothing. Sounds the song's audio clips and samplers play are inside the
song file. But **recorded instruments** (pianos, drum kits, strings and so on) and the studio's
built-in plugins (Fledge Synth and the plugin effects) need their recordings and code, which the
player downloads while it makes the music:

- first from your own copies, if you host them: the folders `fledgetone-samples/` and
  `fledgetone-sfx/` next to your page, and `fledgetone-plugins/` next to `bos-player.js` (a web
  runtime kit exported from the studio has the plugins its song plays there already),
- otherwise from fledgetone.com (`https://fledgetone.com/app/...`), which allows this from any site,
- and a few older instrument sets from public sample collections on GitHub
  (`tonejs.github.io`, `raw.githubusercontent.com` and `gleitz.github.io`).

If a plugin the song plays can't be loaded, `loadSong` rejects with an error that names it, rather
than play that part silent.

Four of those plugins are other people's work under the GPL, not the MIT licence: **Surge XT**,
the **Dragonfly** and **Plateau** reverbs and the **Tonewheel Organ** (setBfree). They are not in
this download; the player fetches one only when a song plays it, and it keeps its own licence. If
you host or ship those plugin files yourself, the GPL's terms for them apply (a runtime kit that
carries one includes its notice and licence).

So a song that uses recorded instruments needs an internet connection the first time, and your
players' browsers will contact those sites. If that matters for your game, use only synth
instruments, host the recordings yourself, or export a game kit (plain audio files) instead.
The recordings have their own licences: see the credits at https://fledgetone.com/guide/credits/.

{{LICENCE}}

### Inside a runtime kit

The same `bos-player.js` comes inside the web runtime kits you export from the studio. Those
copies carry the kit's own permission (`LICENSE-exported-files.txt`); the files in this download
are under the MIT licence, as above, and you may use either.

## Open-source libraries inside

{{THIRD_PARTY}}
