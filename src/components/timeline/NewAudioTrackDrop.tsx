import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { snapBar } from '../../store/timelineTypes';
import { barFromClientX } from './Playhead';
import { dropAudioFiles, dropHasFolder, filesFromDrop, hasFiles } from './audioFiles';
import { importSamplePack } from './samplePackImport';

/** The strip under the tracks: drop sound files here for a new Audio track at the dropped bar. */
export const NewAudioTrackDrop: React.FC<{ originRef: React.RefObject<HTMLElement | null> }> = ({ originRef }) => {
  const [over, setOver] = useState(false);
  const snapped = (clientX: number, shift: boolean) => {
    const s = useTimelineStore.getState();
    const raw = barFromClientX(clientX, originRef.current);
    return shift ? raw : snapBar(raw, s.snapGrid, s);
  };
  return (
    <div
      className={`flex-1 bg-black/10 transition-[box-shadow] ${over ? 'shadow-[inset_0_0_0_2px_rgba(103,232,249,0.6)]' : ''}`}
      title="Drop sound files here for a new Audio track, or a sample pack's folder for kits and instruments"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        // A folder: a sample pack, sorted into kits and instruments (read now: the drop empties after this event)
        if (dropHasFolder(e.dataTransfer)) {
          void filesFromDrop(e.dataTransfer).then((files) => importSamplePack(files));
          return;
        }
        void dropAudioFiles(null, snapped(e.clientX, e.shiftKey), e.dataTransfer.files);
      }}
    />
  );
};
