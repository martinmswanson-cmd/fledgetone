/**
 * How much the browser's sound library holds, with Free unused (delete sounds no project here
 * refers to).
 */
import React, { useEffect, useState } from 'react';
import { loadTag } from '../../store/arrangeActions';
import { HardDrive } from 'lucide-react';
import { currentProject, useLastSession, useTimelineStore } from '../../store/timelineStore';
import { referencedSoundIds } from '../../store/audioClips';
import { freeUnusedSounds, librarySize, useSoundLibrary } from '../../audio/soundLibrary';
import { keptSoundIds } from '../../audio/keptSounds';
import { mySoundIds } from '../../store/mySounds';
import { showToast } from '../timeline/toastStore';

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * How much the browser's sound library holds, and "Free unused": delete the sounds that neither
 * this project, the restorable last session nor a kept version refers to (freeUnusedSounds
 * leaves those itself; sounds saved in project files come back when those are opened).
 */
export const SoundLibraryFooter: React.FC = () => {
  const [size, setSize] = useState<{ count: number; bytes: number } | null>(null);
  // Re-read after a load or a free (the library's metas change with both)
  const metas = useSoundLibrary((s) => s.metas);
  useEffect(() => {
    let live = true;
    librarySize().then((s) => live && setSize(s), () => live && setSize(null));
    return () => {
      live = false;
    };
  }, [metas]);

  const free = async () => {
    const keep = new Set(referencedSoundIds(currentProject()));
    const lastSession = useLastSession.getState().session;
    if (lastSession) referencedSoundIds(lastSession.project).forEach((id) => keep.add(id));
    // Frozen tracks' sounds too (they aren't saved in project files, so only this browser has them)
    for (const p of [currentProject(), lastSession?.project]) p?.tracks.forEach((t) => t.frozen && keep.add(t.frozen.soundId));
    // ...and whatever Undo, Redo or Paste can bring back
    const st = useTimelineStore.getState();
    for (const e of [...st.past, ...st.future]) {
      referencedSoundIds(e).forEach((id) => keep.add(id));
      e.tracks.forEach((t) => t.frozen && keep.add(t.frozen.soundId));
    }
    referencedSoundIds({ clips: st.clipboard, tracks: [] }).forEach((id) => keep.add(id));
    // ...and the producer tag, kept for every project
    const tag = loadTag();
    if (tag) keep.add(tag.soundId);
    // ...and the sounds this browser keeps for itself (the reference track, the producer tag)
    keptSoundIds().forEach((id) => keep.add(id));
    // ...and the recordings your saved sounds play (My sounds, in the instrument lists)
    mySoundIds().forEach((id) => keep.add(id));
    if (!window.confirm("Delete the sounds in this browser that neither this project, your last session nor a kept version (File › Versions) uses?\n\nProjects saved as files keep their sounds inside the file, so they come back when opened.")) return;
    try {
      const gone = await freeUnusedSounds(keep);
      showToast(gone.count ? `Freed ${gone.count} sound${gone.count === 1 ? '' : 's'} (${megabytes(gone.bytes)}).` : 'Every sound in this browser is in use.');
      setSize(await librarySize());
    } catch {
      showToast("Couldn't change the browser's sound storage.");
    }
  };

  return (
    <div className="flex items-center gap-2 text-[10px] font-mono text-forge-muted/80">
      <HardDrive className="w-3 h-3 shrink-0" />
      <span className="flex-1 min-w-0 truncate" title="Sound files are kept in this browser (IndexedDB) by content, shared between tracks and projects, and saved inside project files.">
        {size ? `${size.count} sound${size.count === 1 ? '' : 's'} in this browser (${megabytes(size.bytes)})` : 'Sounds kept in this browser'}
      </span>
      <button type="button" onClick={() => void free()} className="shrink-0 px-1.5 py-0.5 rounded border border-forge-border hover:text-forge-text hover:border-forge-borderLight" title="Delete the sounds no track or clip here uses">
        Free unused
      </button>
    </div>
  );
};
