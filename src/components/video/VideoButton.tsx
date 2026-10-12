import React, { useRef } from 'react';
import { Clapperboard, Loader2 } from 'lucide-react';
import { useVideoStore } from '../../store/videoStore';
import { showToast } from '../timeline/toastStore';

/** Load a video to score to (or drop one on the page). */
export const VideoButton: React.FC = () => {
  const input = useRef<HTMLInputElement>(null);
  const loading = useVideoStore((s) => s.loading);
  const video = useVideoStore((s) => s.video);
  return (
    <>
      <button
        type="button"
        title={video ? `Scoring to ${video.name}: load a different video` : 'Load a video to score to (gameplay, a trailer): it plays in sync with the playhead'}
        onClick={() => input.current?.click()}
        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-[11px] font-bold transition ${video ? 'border-amber-400/70 text-amber-200 bg-amber-500/10' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
        Video
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.m4v"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          await useVideoStore.getState().load(file);
          const err = useVideoStore.getState().error;
          if (err) showToast(`Couldn't load the video: ${err}`);
        }}
      />
    </>
  );
};
