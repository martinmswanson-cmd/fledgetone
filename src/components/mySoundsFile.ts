/**
 * My sounds as a file, to keep them safe or take them to another browser or computer: the saved
 * sounds and starred instruments (mySounds.ts), with the recordings the sounds play (a Sampler's,
 * a Drum Rack's...) inside it as a project file carries them. Opening one adds its sounds and
 * stars to this browser's; a sound of the same name is replaced, as saving it again would.
 */
import { MY_SOUNDS_FORMAT, mySoundIds, parseMySoundsFile, useMySounds, type MySoundsFile } from '../store/mySounds';
import { embedSounds, importEmbeddedSounds } from '../audio/soundLibrary';
import { downloadBlob } from '../audio/exportWav';
import { showToast } from './timeline/toastStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Download this browser's saved sounds and stars as my-sounds.fledgetone-sounds.json. */
export async function exportMySounds(): Promise<void> {
  const { sounds, favourites } = useMySounds.getState();
  if (!sounds.length && !favourites.length) {
    showToast('Nothing to save yet: star an instrument, or save a sound with the bookmark beside the instrument in the Track Inspector.');
    return;
  }
  const file: MySoundsFile = { format: MY_SOUNDS_FORMAT, version: 1, favourites, sounds, recordings: await embedSounds(mySoundIds()) };
  downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), 'my-sounds.fledgetone-sounds.json');
  showToast(`Saved ${plural(sounds.length, 'sound')} and ${plural(favourites.length, 'favourite')} to my-sounds.fledgetone-sounds.json (in your downloads).`);
}

/** Add a My sounds file's sounds and stars to this browser's. Returns what happened, for a message. */
export async function importMySoundsFile(file: File): Promise<string> {
  try {
    const { sounds, favourites, recordings } = parseMySoundsFile(JSON.parse(await file.text()));
    if (recordings.length) await importEmbeddedSounds(recordings);
    const done = useMySounds.getState().importSounds(sounds, favourites);
    if (!done) return "The browser wouldn't keep them (its storage is full or blocked).";
    return `Added ${plural(done.added, 'sound')}${done.replaced ? `, updated ${done.replaced}` : ''} and ${plural(favourites.length, 'favourite')} from ${file.name}.`;
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
    return `Couldn't open ${file.name}: ${reason}`;
  }
}

/** Ask for a My sounds file and add it (the result in a message). */
export function pickMySoundsFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) showToast(await importMySoundsFile(file));
  };
  input.click();
}
