import React, { useMemo, useState } from 'react';
import { Loader2, Package } from 'lucide-react';
import { Modal } from '../timeline/Modal';
import { useSongMeter, useTimelineStore } from '../../store/timelineStore';
import { buildEnginePackage, type EngineTarget } from '../../audio/enginePackage';
import { gameKitSong } from '../timeline/gameKitSong';
import { downloadBlob, type SampleRate } from '../../audio/exportWav';
import { songSections } from '../../store/cutToLength';
import { showToast } from '../timeline/toastStore';

/**
 * FMOD / Wwise package: the game music laid out for audio middleware (see enginePackage.ts): every
 * state as an exact loop with its stems, the stingers and transition sounds, the cue data, and a
 * script that builds it in FMOD Studio or Wwise.
 */
export const EnginesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState<EngineTarget>('both');
  const [rate, setRate] = useState<SampleRate>(48000);
  const [progress, setProgress] = useState<string | null>(null);
  const clips = useTimelineStore((s) => s.clips);
  const markers = useTimelineStore((s) => s.markers);
  const meter = useSongMeter();
  const sections = useMemo(() => songSections(clips, markers, meter), [clips, markers, meter]);
  const stems = useTimelineStore((s) => s.tracks.filter((t) => t.stemGroup).length);
  const stingers = useTimelineStore((s) => s.stingers.length);

  const build = async () => {
    setProgress('0%');
    try {
      const blob = await buildEnginePackage(gameKitSong(), target, (f, d) => setProgress(`${Math.round(f * 100)}% · ${d}`), rate);
      const name = useTimelineStore.getState().projectName || 'Untitled';
      downloadBlob(blob, `${name} ${target === 'fmod' ? 'FMOD' : target === 'wwise' ? 'Wwise' : 'FMOD-Wwise'}.zip`);
      onClose();
    } catch (err) {
      showToast(`Couldn't build the package: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      setProgress(null);
    }
  };

  const option = (value: EngineTarget, label: string) => (
    <label className="flex items-center gap-1.5">
      <input type="radio" name="engine" checked={target === value} onChange={() => setTarget(value)} />
      {label}
    </label>
  );

  return (
    <Modal title="FMOD / Wwise package" onClose={onClose}>
      <p>
        Your game music laid out for audio middleware: every state (section between markers) as an exact loop with its stems, the stingers and transition
        sounds, a cue sheet, and a script that builds it in the tool: in FMOD Studio an event with the states, loop regions, tempo and an Intensity
        parameter; in Wwise a Music Switch Container with a playlist per state, a State Group and an Intensity game parameter. The README says how to run
        it and what to finish by hand.
      </p>
      <p className="text-forge-text">
        {sections.length} state{sections.length === 1 ? '' : 's'}
        {stems ? `, stems by group (${stems} track${stems === 1 ? '' : 's'} grouped)` : ', one mix per state (give tracks a stem group in the Game tab for stems)'}
        {stingers ? `, ${stingers} stinger${stingers === 1 ? '' : 's'}` : ''}.
      </p>
      <div className="flex flex-wrap gap-4 text-forge-text">
        {option('both', 'FMOD and Wwise')}
        {option('fmod', 'FMOD Studio')}
        {option('wwise', 'Wwise')}
      </div>
      <label className="flex items-center gap-2">
        Sample rate
        <select value={rate} onChange={(e) => setRate(Number(e.target.value) as SampleRate)} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text">
          <option value={48000}>48 kHz (games usually)</option>
          <option value={44100}>44.1 kHz</option>
        </select>
      </label>
      <button
        type="button"
        disabled={progress !== null || !sections.length}
        onClick={() => void build()}
        className="h-9 px-3 flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-500/15 text-emerald-100 font-semibold hover:bg-emerald-500/25 disabled:opacity-50"
      >
        {progress === null ? <Package className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
        {progress === null ? (sections.length ? 'Build the package (.zip)' : 'Add some music first') : `Building… ${progress}`}
      </button>
    </Modal>
  );
};
