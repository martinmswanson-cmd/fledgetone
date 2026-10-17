import runtimeSource from '../../dist-runtime/bos-player.js?raw';
import { createZip } from './zip';
import { EXPORTED_FILES_LICENCE, EXPORTED_FILES_LICENCE_NAME } from './exportLicence';
import { embedSounds } from './soundLibrary';
import { referencedSoundIds } from '../store/audioClips';
import { serializeProject, type ProjectSnapshot } from '../store/project';

/**
 * The web runtime kit: for a web game where download size matters, the song as its project file
 * (kilobytes) and bos-player.js, which synthesizes the music in the player's browser when the game
 * loads (see src/runtime/player.ts), instead of megabytes of WAV files. With an example page and a
 * README.
 */

// ('#' and '%' too: in the URL loadSong fetches they'd start a fragment or an escape)
const safe = (name: string) => name.replace(/[\\/:*?"<>|#%]+/g, '-').trim() || 'song';
/** A string as a JS literal that's safe inside an HTML <script> ('</script>' can't end it) */
const scriptString = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c');

export async function buildRuntimeKit(project: ProjectSnapshot): Promise<Blob> {
  const sounds = await embedSounds(referencedSoundIds(project));
  const songFile = `${safe(project.name)}.json`;
  const song = JSON.stringify(serializeProject({ ...project, sounds }));
  const states = (project.markers ?? []).filter((m) => m.anchor === 'bar').map((m) => m.name);
  const first = states[0] ?? 'Start';
  const second = states[1] ?? first;
  const sting = project.stingers?.[0]?.name;
  const example = `<!doctype html>
<meta charset="utf-8">
<title>${project.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}: music test</title>
<button id="start">Load and play</button> <progress id="bar" max="1" value="0"></progress>
<div id="pads"></div>
<script type="module">
  import { loadSong } from './bos-player.js';
  document.getElementById('start').onclick = async () => {
    const music = await loadSong(${scriptString('./' + songFile)}, { onProgress: (f) => (document.getElementById('bar').value = f) });
    music.play(${scriptString(first)});
    for (const s of music.data.states) {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.onclick = () => music.setState(s.name);
      document.getElementById('pads').append(b);
    }
    for (const s of music.data.stingers) {
      const b = document.createElement('button');
      b.textContent = '★ ' + s.name;
      b.onclick = () => music.stinger(s.name);
      document.getElementById('pads').append(b);
    }
    if (music.data.intensity.groups.length) {
      const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.01, value: music.intensity });
      r.oninput = () => music.setIntensity(Number(r.value));
      document.getElementById('pads').append(' Intensity ', r);
    }
  };
</script>
`;
  const readme = `${project.name}: web runtime kit, made with Fledgetone
${'='.repeat(project.name.length + 46)}

For web games where download size matters. Instead of audio files, the game loads the song as
its project file (${songFile}, ${Math.round(song.length / 1024)} KB) and bos-player.js
(${Math.round(runtimeSource.length / 1024)} KB, about ${Math.round(runtimeSource.length / 4200)} KB gzipped by a web server), which synthesizes the
music in the player's browser when the game loads: every state (and its stems, if the song has
stem groups), the stingers and the transitions, with the same engine as Fledgetone. Then it
plays like the game kit's player: transitions by your rules, on the beat, and intensity.

    import { loadSong } from './bos-player.js';
    const music = await loadSong(${JSON.stringify('./' + songFile)}, { onProgress: (f) => console.log(f) });
    music.play(${JSON.stringify(first)});          // after the player clicks or presses a key
    music.setState(${JSON.stringify(second)});
    music.setIntensity(0.7);${sting ? `\n    music.stinger(${JSON.stringify(sting)});` : ''}

loadSong takes a few seconds per minute of music (more on slow devices), so start it while the
game loads and show a progress bar. Pass { context: yourAudioContext } to share the game's
AudioContext, and { destination: someGainNode } to route the music through your own mixer.

Recorded instruments download their samples from the same public libraries the app uses, so
they need a connection; synth instruments need nothing. Sounds your clips play are inside the
song file.

index.html is a small test page: serve this folder (for example "npx serve") and open it.
`;
  return createZip([
    { name: songFile, data: new Blob([song], { type: 'application/json' }) },
    { name: 'bos-player.js', data: new Blob([runtimeSource], { type: 'text/javascript' }) },
    { name: 'index.html', data: new Blob([example], { type: 'text/html' }) },
    { name: 'README.txt', data: new Blob([readme], { type: 'text/plain' }) },
    { name: EXPORTED_FILES_LICENCE_NAME, data: new Blob([EXPORTED_FILES_LICENCE], { type: 'text/plain' }) },
  ]);
}
