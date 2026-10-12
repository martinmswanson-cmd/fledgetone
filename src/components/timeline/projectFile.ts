import { currentProject, onProjectReplaced, useTimelineStore } from '../../store/timelineStore';
import { parseProject, safeFileName, serializeProject } from '../../store/project';
import { referencedSoundIds } from '../../store/audioClips';
import { embedSounds } from '../../audio/soundLibrary';
import { downloadBlob } from '../../audio/exportWav';
import { showToast } from './toastStore';
import { projectVideoForFile } from '../../store/videoStore';
import { create } from 'zustand';

/**
 * Project files on disk. Where the browser lets a page write files (Chrome and Edge on a
 * computer: the File System Access API), Save As asks where to save and what to call it, and from
 * then on Save writes to that same file, as a desktop DAW does; Open uses the same picker, so
 * Save updates the file that was opened. Elsewhere (Safari, Firefox, phones) Save downloads the
 * file, to wherever the browser keeps downloads.
 */

interface WritableFile {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface FileHandle {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<WritableFile>;
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
}
type PickerTypes = Array<{ description: string; accept: Record<string, string[]> }>;
interface FilePickers {
  showSaveFilePicker?: (opts: { suggestedName?: string; id?: string; startIn?: FileHandle | string; types?: PickerTypes }) => Promise<FileHandle>;
  showOpenFilePicker?: (opts: { id?: string; startIn?: FileHandle | string; types?: PickerTypes; multiple?: boolean }) => Promise<FileHandle[]>;
}

const pickers = () => window as unknown as FilePickers;
/** Whether this browser can save to a chosen place on disk (and save to it again). */
export const canChooseSaveLocation = (): boolean => typeof pickers().showSaveFilePicker === 'function';

const TYPES: PickerTypes = [{ description: "Bo's Beatbox project", accept: { 'application/json': ['.json'] } }];
/** The picker remembers its last folder under this id (one for projects, apart from exports). */
const PICKER_ID = 'beatbox-projects';

/** The file the open project saves to (null: none yet, so Save asks where). */
export const useProjectFile = create<{ handle: FileHandle | null }>(() => ({ handle: null }));

// Another song (New, a link, Restore) isn't the file's song: the next Save asks where again
onProjectReplaced(() => useProjectFile.setState({ handle: null }));

/** The project file's contents: the arrangement and the sounds it plays (and the reference video, when small enough). */
async function projectBlob(): Promise<Blob> {
  const project = currentProject();
  const sounds = await embedSounds(referencedSoundIds(project));
  const video = await projectVideoForFile();
  return new Blob([JSON.stringify(serializeProject({ ...project, sounds, video }), null, 2)], { type: 'application/json' });
}

const fileName = () => `${safeFileName(currentProject().name)}.beatbox.json`;

/** Write the project into `handle` (asking for permission again if the browser dropped it). */
async function writeTo(handle: FileHandle): Promise<void> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('the browser was not allowed to write to the file');
  }
  const blob = await projectBlob();
  const out = await handle.createWritable();
  await out.write(blob);
  await out.close();
}

/**
 * Save the project: to its file when it has one, else Save As (where the browser can choose a
 * place), else a download.
 */
export async function saveProjectFile(): Promise<void> {
  const { handle } = useProjectFile.getState();
  if (handle) {
    try {
      await writeTo(handle);
      showToast(`Saved to ${handle.name}`);
      return;
    } catch (err) {
      showToast(`Couldn't save to ${handle.name} (${err instanceof Error ? err.message : String(err)}): choose where to save it`);
      useProjectFile.setState({ handle: null });
    }
  }
  await saveProjectAs();
}

/** Save As: choose the folder and name (the picker opens where the last project was saved), then Save keeps writing there. */
export async function saveProjectAs(): Promise<void> {
  const pick = pickers().showSaveFilePicker;
  if (!pick) {
    downloadBlob(await projectBlob(), fileName());
    showToast('Downloaded the project file (this browser saves to its downloads folder: Chrome or Edge on a computer can choose where)');
    return;
  }
  let handle: FileHandle;
  try {
    const last = useProjectFile.getState().handle;
    handle = await pick({ suggestedName: last?.name ?? fileName(), id: PICKER_ID, types: TYPES, ...(last ? { startIn: last } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return; // cancelled
    throw err;
  }
  await writeTo(handle);
  useProjectFile.setState({ handle });
  showToast(`Saved to ${handle.name}. Save (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}S) now keeps it up to date`);
}

/** Open a .beatbox.json file. Returns why it couldn't, or null. */
export async function openProjectFromFile(file: File, handle: FileHandle | null = null): Promise<string | null> {
  try {
    const project = parseProject(JSON.parse(await file.text()));
    useTimelineStore.getState().loadProject(project);
    // (After loading: loading another song forgets the file it saved to)
    if (handle) useProjectFile.setState({ handle });
    return null;
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
    return `Couldn't open ${file.name}: ${reason}`;
  }
}

/** Ask for a project file and open it (errors in a toast). With the file picker, Save then writes back to that file. */
export function pickProjectFile(): void {
  const open = pickers().showOpenFilePicker;
  if (open) {
    void open({ id: PICKER_ID, types: TYPES }).then(
      async ([handle]) => {
        if (!handle) return;
        const error = await openProjectFromFile(await handle.getFile(), handle);
        if (error) showToast(error);
      },
      (err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) showToast(`Couldn't open the file: ${err instanceof Error ? err.message : String(err)}`);
      }
    );
    return;
  }
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
