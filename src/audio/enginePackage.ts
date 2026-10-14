import { buildGameKitParts, MAIN_STEM, type GameKitSong } from './gameKit';
import { engineReadme, fmodScript, stateLayout, wwiseScript, type EngineTarget } from './engineScripts';
import { createZip, type ZipEntry } from './zip';
import type { SampleRate } from './exportWav';

/**
 * The FMOD / Wwise package: the game kit's audio (every state as an exact loop and its stems, the
 * stingers, the transition sounds) laid out for audio middleware, with
 * - cues.json: the same description as the game kit's manifest, plus each state's place on one
 *   timeline (for FMOD's single-event layout);
 * - fmod/Fledgetone_<song>.js: an FMOD Studio script (Scripts menu) that builds the event: a track
 *   per stem group, every state laid out with a loop region and a marker, the tempo, and an
 *   Intensity parameter driving each group's volume along its curve;
 * - wwise/import_<song>.py: a Wwise Authoring API script that imports the states into a Music
 *   Switch Container (a playlist per state, a segment per loop, a track per stem), a State Group
 *   with a state per section, and an Intensity game parameter;
 * - README.md: how to run them, and the steps each tool doesn't let a script do.
 * The scripts try each step and say what worked, so a step a version of the tool doesn't support
 * is reported rather than stopping the rest.
 */

export type { EngineTarget };

/** Render and package everything for FMOD and / or Wwise. */
export async function buildEnginePackage(song: GameKitSong, target: EngineTarget, onProgress?: (fraction: number, detail: string) => void, sampleRate: SampleRate = 48000): Promise<Blob> {
  // (FMOD and Wwise get the states as written: costumes and shuffled pieces are the game kit players')
  const { manifest, files } = await buildGameKitParts({ ...song, costumes: [], stateOptions: {}, gameParams: [] }, (f, d) => onProgress?.(f * 0.97, d), sampleRate);
  const slug = manifest.name.replace(/[^A-Za-z0-9]+/g, '_');
  const out: ZipEntry[] = files.map((f) => ({ ...f, name: `Audio/${f.name}` }));
  const cues = { ...manifest, format: 'bos-beatbox-cues', mainStem: MAIN_STEM, timeline: stateLayout(manifest) };
  out.push({ name: 'cues.json', data: new Blob([JSON.stringify(cues, null, 2)], { type: 'application/json' }) });
  if (target !== 'wwise') out.push({ name: `fmod/Fledgetone_${slug}.js`, data: new Blob([fmodScript(manifest)], { type: 'text/javascript' }) });
  if (target !== 'fmod') out.push({ name: `wwise/import_${slug}.py`, data: new Blob([wwiseScript(manifest)], { type: 'text/x-python' }) });
  out.push({ name: 'README.md', data: new Blob([engineReadme(manifest, target)], { type: 'text/markdown' }) });
  onProgress?.(1, 'zip');
  return createZip(out);
}
