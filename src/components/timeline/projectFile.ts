import { currentProject, useTimelineStore } from '../../store/timelineStore';
import { parseProject, safeFileName, serializeProject } from '../../store/project';
import { referencedSoundIds } from '../../store/audioClips';
import { embedSounds } from '../../audio/soundLibrary';
import { downloadBlob } from '../../audio/exportWav';
import { showToast } from './toastStore';

/** Download the arrangement as a project file, with the sound files its clips and instruments play. */
export async function saveProjectFile(): Promise<void> {
  const project = currentProject();
  const sounds = await embedSounds(referencedSoundIds(project));
  const blob = new Blob([JSON.stringify(serializeProject({ ...project, sounds }), null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(project.name)}.beatbox.json`);
}

/** Open a .beatbox.json file. Returns why it couldn't, or null. */
export async function openProjectFromFile(file: File): Promise<string | null> {
  try {
    const project = parseProject(JSON.parse(await file.text()));
    useTimelineStore.getState().loadProject(project);
    return null;
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
    return `Couldn't open ${file.name}: ${reason}`;
  }
}

/** Ask for a project file and open it (errors in a toast). */
export function pickProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const error = await openProjectFromFile(file);
    if (error) showToast(error);
  };
  input.click();
}
