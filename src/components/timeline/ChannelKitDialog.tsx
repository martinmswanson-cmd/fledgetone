/**
 * The channel kit dialog: what the kit will hold (each piece and the bars it comes from), where its
 * loudness goes, and the button that makes the .zip (audio/channelKit.ts renders it).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Loader2, Package } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { buildChannelKit, channelKitPieces } from '../../audio/channelKit';
import { downloadBlob } from '../../audio/exportWav';
import { LOUDNESS_TARGETS } from '../../audio/loudnessTarget';
import { countedRender } from '../../audio/renderBusy';
import { barToSeconds } from '../../audio/tempoMap';
import { safeFileName } from '../../store/project';
import { formatBarCount } from '../../store/timelineTypes';
import { gameKitSong } from './gameKitSong';
import { showToast } from './toastStore';

const TARGET_KEY = 'fledgetone.channelKit.target';

function loadTarget(): string {
  try {
    const t = localStorage.getItem(TARGET_KEY);
    if (t && LOUDNESS_TARGETS.some((x) => x.id === t)) return t;
  } catch {
    // Storage blocked: the default
  }
  return 'streaming';
}

type Status = { kind: 'idle'; error?: string } | { kind: 'busy'; what: string; progress: number };

export const ChannelKitDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const markers = useTimelineStore((s) => s.markers);
  const bpm = useTimelineStore((s) => s.bpm);
  const tempoPoints = useTimelineStore((s) => s.tempoPoints);
  const projectName = useTimelineStore((s) => s.projectName);
  const [target, setTarget] = useState(loadTarget);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  // (The list follows the song: worked out again when its notes, tracks or markers change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pieces = useMemo(() => channelKitPieces(gameKitSong()), [clips, tracks, markers, bpm, tempoPoints]);
  const tempo = { bpm, points: tempoPoints };
  const seconds = (from: number, to: number) => Math.round(barToSeconds(to, tempo) - barToSeconds(from, tempo));
  const fileName = `${safeFileName(projectName || 'Untitled')} channel kit.zip`;

  const build = () =>
    countedRender(async () => {
      try {
        localStorage.setItem(TARGET_KEY, target);
      } catch {
        // Not remembered (storage blocked)
      }
      const s = useTimelineStore.getState();
      s.pause();
      const controller = new AbortController();
      abort.current = controller;
      setStatus({ kind: 'busy', what: 'Starting', progress: 0 });
      try {
        const zip = await buildChannelKit(gameKitSong(), { target, intensity: { value: s.intensity, curves: s.intensityCurves }, signal: controller.signal }, (progress, what) =>
          setStatus({ kind: 'busy', what, progress })
        );
        controller.signal.throwIfAborted();
        downloadBlob(zip, fileName);
        showToast(`Made ${fileName}`);
        onClose();
      } catch (err) {
        setStatus(controller.signal.aborted ? { kind: 'idle' } : { kind: 'idle', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    });

  if (status.kind === 'busy') {
    return (
      <Modal title="Channel kit" onClose={onClose}>
        <div className="flex items-center gap-2 text-forge-text">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          <span className="min-w-0 truncate">{status.what}…</span>
        </div>
        <div className="h-1.5 rounded-full bg-forge-bg border border-forge-border overflow-hidden" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-cyan-400" style={{ width: `${status.progress * 100}%` }} />
        </div>
        <button type="button" onClick={() => abort.current?.abort()} className="self-end h-8 px-3 rounded-md border border-forge-border text-xs font-mono hover:text-red-300">
          Cancel
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Channel kit" onClose={onClose}>
      <p>
        Music for the start, the breaks and the end of your streams and videos, all from this song, in one .zip: an intro and an outro, loops for your stream's screens, alerts and a
        transition whoosh. The loops repeat with no gap (in OBS, a Media Source with Loop on).
      </p>
      {pieces.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="channel-kit-pieces">
          {pieces.map((p) => (
            <li key={p.file} className="flex flex-col">
              <span className="text-forge-text font-mono text-[11px]">{p.file}</span>
              <span className="text-forge-muted">
                {p.what}
                {p.range ? ` (bars ${formatBarCount(p.range.from)} to ${formatBarCount(p.range.to)}, ${seconds(p.range.from, p.range.to)} s)` : ''}.
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-amber-200">The timeline is empty: write or load a song first.</p>
      )}
      <label className="flex items-center gap-2 text-forge-text">
        Loudness
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 bg-forge-bg border border-forge-border rounded px-1">
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-forge-muted">
        The main part is the busiest of your song's sections (between its markers, or 8-bar phrases without any). Be right back leaves out the lead melody: name a track "Lead" to choose
        which. Your song's stingers, if it has any, become the alerts.
      </p>
      {status.error && <p className="text-red-400">It didn't work: {status.error}</p>}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-forge-border">
        <span className="min-w-0 truncate text-forge-muted">{fileName}</span>
        <button
          type="button"
          data-testid="channel-kit-make"
          disabled={!pieces.length}
          onClick={() => void build()}
          className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-xs font-mono text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Package className="w-3.5 h-3.5" />
          Make the kit
        </button>
      </div>
    </Modal>
  );
};
