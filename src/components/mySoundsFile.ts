/**
 * My sounds as a file, to keep them safe or take them to another browser or computer: the saved
 * sounds and starred instruments (mySounds.ts), with the recordings the sounds play (a Sampler's,
 * a Drum Rack's...) inside it as a project file carries them. Opening one adds its sounds and
 * stars to this browser's; a sound of the same name is replaced, as saving it again would.
 * One track's sound can go in a file of its own too (Share this sound, "<name>.fledgetone-sound.json"),
 * to send to someone: opening it adds it to My sounds and puts it on the track it's opened on.
 */
import { MY_SOUNDS_FORMAT, mySoundIds, parseMySoundsFile, soundFile, soundFileName, soundOf, soundRecordingIds, useMySounds, type MySound, type MySoundsFile } from '../store/mySounds';
import { useTimelineStore } from '../store/timelineStore';
import { uid } from '../store/timelineTypes';
import { captureWamStates } from '../audio/wamHost';
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

/** Download one track's sound (its instrument with every setting, a plugin's knobs included) as a file of its own. */
export async function shareTrackSound(trackId: string): Promise<void> {
  const before = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  if (!before) return;
  // A plugin's knobs are read now, so the file has what was just turned
  if (before.plugin || before.pluginFx?.length) await captureWamStates();
  const track = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  if (!track) return;
  const sound: MySound = { id: uid('sound'), name: track.name.trim().slice(0, 60) || 'Sound', settings: soundOf(track) };
  const name = soundFileName(sound.name);
  downloadBlob(new Blob([JSON.stringify(soundFile(sound, await embedSounds(soundRecordingIds(sound))))], { type: 'application/json' }), name);
  showToast(`Saved "${sound.name}" as ${name} (in your downloads): send it to anyone, and Open a sound file puts it on their track.`);
}

/**
 * Open a sound file (or a My sounds file): its sounds go into My sounds, and a file of one sound
 * goes on track `trackId` too (one undo step). Returns what happened, for a message.
 */
export async function openSoundFile(file: File, trackId?: string): Promise<string> {
  try {
    const { sounds, favourites, recordings } = parseMySoundsFile(JSON.parse(await file.text()));
    if (!sounds.length) return `${file.name} has no sounds in it.`;
    if (recordings.length) await importEmbeddedSounds(recordings);
    const done = useMySounds.getState().importSounds(sounds, favourites);
    const track = trackId ? useTimelineStore.getState().tracks.find((t) => t.id === trackId) : undefined;
    if (track && sounds.length === 1) {
      useTimelineStore.getState().setTrackSound(track.id, sounds[0]);
      return `${track.name} plays "${sounds[0].name}" now${done ? ', and it’s in My sounds' : ''} (Undo puts the old sound back).`;
    }
    if (!done) return "The browser wouldn't keep them (its storage is full or blocked).";
    return `Added ${plural(done.added, 'sound')}${done.replaced ? `, updated ${done.replaced}` : ''} to My sounds from ${file.name}.`;
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
    return `Couldn't open ${file.name}: ${reason}`;
  }
}

/** Ask for a sound file and open it onto track `trackId` (the result in a message). */
export function pickSoundFile(trackId?: string): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) showToast(await openSoundFile(file, trackId));
  };
  input.click();
}
