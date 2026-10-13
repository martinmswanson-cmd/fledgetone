/**
 * Drop a .beatbox.json project file anywhere on the page to open it (asking first when there's
 * work on the timeline).
 */
import React, { useEffect, useState } from 'react';
import { isVideoFile, useVideoStore } from '../store/videoStore';
import { FolderOpen } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { hasWork, parseProject } from '../store/project';
import { showToast } from './timeline/toastStore';
import { Modal } from './timeline/Modal';
import { ChoiceButton } from './timeline/ProjectBar';

/** A dragged item that is (or may be) a project file: browsers give a type but no name while it's in the air. */
const draggingProjectFile = (dt: DataTransfer | null): boolean =>
  !!dt && Array.from(dt.items).some((item) => item.kind === 'file' && (/json/.test(item.type) || item.type.startsWith('video/')));
const draggingVideo = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.items).some((item) => item.kind === 'file' && item.type.startsWith('video/'));

const isProjectFile = (file: File): boolean => /\.json$/i.test(file.name) || /json/.test(file.type);

/**
 * Drop a `.beatbox.json` project file anywhere on the page to open it, as the Open button does.
 * The page's own drop zones (sound files onto the lanes) never see a project file: the drop is
 * taken on the way down. Opening replaces what's on screen, so when there is work on the
 * timeline a dialog asks first.
 */
export const ProjectDrop: React.FC = () => {
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [video, setVideo] = useState(false);

  useEffect(() => {
    // Enter and leave fire for every element passed over: count them to know when the drag has left the window
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!draggingProjectFile(e.dataTransfer)) return;
      depth++;
      setOver(true);
      setVideo(draggingVideo(e.dataTransfer));
    };
    const leave = (e: DragEvent) => {
      if (!draggingProjectFile(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const dragOver = (e: DragEvent) => {
      if (!draggingProjectFile(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      depth = 0;
      setOver(false);
      // A video is the reference to score to (see videoStore.ts)
      const clip = files.find(isVideoFile);
      if (clip && !files.some(isProjectFile)) {
        e.preventDefault();
        e.stopPropagation();
        void useVideoStore.getState().load(clip);
        return;
      }
      const file = files.find(isProjectFile);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      if (hasWork(useTimelineStore.getState())) setPending(file);
      else void openProjectFile(file);
    };
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('dragover', dragOver, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter, true);
      window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('dragover', dragOver, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  return (
    <>
      {over && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6 pointer-events-auto">
          <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-cyan-400 bg-forge-panel/90 px-6 py-4 text-sm font-semibold text-cyan-200 shadow-2xl">
            <FolderOpen className="w-5 h-5" />
            {video ? 'Drop to load the video to score to' : 'Drop to open the project file'}
          </div>
        </div>
      )}
      {pending && (
        <Modal title={`Open ${pending.name}?`} onClose={() => setPending(null)}>
          <p>It replaces what's on the timeline and clears undo. What's there now stays in this browser as the last session, which the banner offers to restore after a reload.</p>
          <ChoiceButton
            title="Open it"
            detail="Replace the current arrangement with this file."
            autoFocus
            onClick={() => {
              const file = pending;
              setPending(null);
              void openProjectFile(file);
            }}
          />
          <ChoiceButton title="Keep what's here" detail="Close this and leave the timeline as it is." onClick={() => setPending(null)} />
        </Modal>
      )}
    </>
  );
};

/** Open a project file as the Open button does; a file that can't be read says why at the bottom of the screen. */
async function openProjectFile(file: File): Promise<void> {
  try {
    const project = parseProject(JSON.parse(await file.text()));
    useTimelineStore.getState().loadProject(project);
    showToast(`Opened ${file.name}`);
  } catch (err) {
    const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
    showToast(`Couldn't open ${file.name}: ${reason}`);
  }
}
