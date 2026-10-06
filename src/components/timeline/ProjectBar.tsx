import React, { useRef, useState } from 'react';
import { Download, FilePlus2, FolderOpen, History, Loader2, Music2, Save, X } from 'lucide-react';
import { lastSession, useTimelineStore } from '../../store/timelineStore';
import { parseProject, safeFileName, serializeProject } from '../../store/project';
import { downloadBlob, encodeWav, renderArrangement } from '../../audio/exportWav';
import { formatSmpte } from '../../audio/transport';

const barButton =
  'h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg text-xs font-mono text-forge-muted hover:text-forge-text hover:border-forge-borderLight transition-colors';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ title, onClose, children }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    onKeyDown={(e) => e.key === 'Escape' && onClose()}
  >
    <div role="dialog" aria-label={title} className="w-full max-w-md rounded-xl border border-forge-borderLight bg-forge-panel shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
        <h3 className="text-sm font-semibold text-forge-text">{title}</h3>
        <button type="button" onClick={onClose} className="text-forge-muted hover:text-forge-text" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 flex flex-col gap-3 text-xs text-forge-muted">{children}</div>
    </div>
  </div>
);

const ChoiceButton: React.FC<{ title: string; detail: string; onClick: () => void; disabled?: boolean; autoFocus?: boolean }> = ({
  title,
  detail,
  onClick,
  disabled,
  autoFocus,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    autoFocus={autoFocus}
    className="text-left rounded-lg border border-forge-border bg-forge-bg px-3 py-2.5 hover:border-cyan-500/70 hover:bg-cyan-500/10 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:border-cyan-500"
  >
    <div className="text-sm font-semibold text-forge-text">{title}</div>
    <div className="mt-0.5 text-[11px] text-forge-muted">{detail}</div>
  </button>
);

/** Duration label for a bar range at the current tempo, e.g. "0:16". */
function lengthLabel(bars: number, bpm: number): string {
  const tc = formatSmpte(bars + 1, bpm); // HH:MM:SS:FF
  const [hh, mm, ss] = tc.split(':').map(Number);
  return `${hh * 60 + mm}:${String(ss).padStart(2, '0')}`;
}

const NewProjectDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const choose = (template: 'blank' | 'demo') => {
    useTimelineStore.getState().newProject(template);
    onClose();
  };
  return (
    <Modal title="New arrangement" onClose={onClose}>
      <p>
        This replaces the current timeline and clears undo history. Save it first if you want to keep it. Copied clips
        stay on the clipboard, so you can paste them into the new arrangement.
      </p>
      <ChoiceButton
        title="Blank timeline"
        detail="Four empty tracks. Right-click a lane to insert a pattern, or paste copied clips."
        onClick={() => choose('blank')}
        autoFocus
      />
      <ChoiceButton title="Demo song" detail="Sunset Stroll: a 12-bar neo-soul groove at 88 BPM (intro, groove, horn hook)." onClick={() => choose('demo')} />
    </Modal>
  );
};

const ExportDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const clips = useTimelineStore((s) => s.clips);
  const bpm = useTimelineStore((s) => s.bpm);
  const loop = useTimelineStore((s) => s.loopRegion);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'error'>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);

  const songEnd = clips.length ? Math.max(...clips.map((c) => c.startBar + c.lengthBars)) : 1;
  const songBars = songEnd - 1;
  const loopBars = loop.outBar - loop.inBar;

  const render = async (startBar: number, endBar: number) => {
    const s = useTimelineStore.getState();
    // The render swaps the global audio context while it sets up, so halt live playback first
    s.pause();
    setStatus('rendering');
    setProgress(0);
    try {
      const audio = await renderArrangement(
        {
          tracks: s.tracks,
          clips: s.clips,
          bpm: s.bpm,
          swing: s.swing,
          startBar,
          endBar,
          masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
        },
        setProgress
      );
      downloadBlob(encodeWav(audio), `${safeFileName(s.projectName)}.wav`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  return (
    <Modal title="Export audio (WAV)" onClose={status === 'rendering' ? () => {} : onClose}>
      {status === 'rendering' ? (
        <div className="flex items-center gap-2 py-4 text-forge-text">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          Rendering… {Math.round(progress * 100)}%
        </div>
      ) : (
        <>
          <p>Renders a 44.1 kHz 16-bit stereo WAV with the current mix (volume, pan, mute, solo and every effect), plus room for reverb tails to ring out. Peaks are kept just under full scale so nothing clips.</p>
          <ChoiceButton
            title="Whole song"
            detail={songBars > 0 ? `Bar 1 to the end of the last clip: ${songBars} bars, ${lengthLabel(songBars, bpm)}` : 'The timeline is empty'}
            onClick={() => void render(1, songEnd)}
            disabled={songBars <= 0}
            autoFocus
          />
          <ChoiceButton
            title="Loop region (In → Out)"
            detail={`Bars ${loop.inBar} to ${loop.outBar}: ${loopBars} bars, ${lengthLabel(loopBars, bpm)}, played once`}
            onClick={() => void render(loop.inBar, loop.outBar)}
          />
          {status === 'error' && <p className="text-red-400">Export failed: {error}</p>}
        </>
      )}
    </Modal>
  );
};

/**
 * The app always opens on an empty timeline. If the last session had work in it, offer to
 * bring it back (it lives in memory until dismissed, even after autosave moves on).
 */
export const RestoreSessionBanner: React.FC = () => {
  const [open, setOpen] = useState(lastSession !== null);
  if (!open || !lastSession) return null;
  const session = lastSession;
  const n = session.clips.length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-b border-forge-border bg-cyan-500/10 text-xs">
      <History className="w-4 h-4 text-cyan-300 shrink-0" />
      <span className="text-forge-text">
        Your last session, <b>{session.name}</b> ({n} clip{n === 1 ? '' : 's'}), can be restored.
      </span>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          className={`${barButton} !text-cyan-200 !border-cyan-400/60`}
          onClick={() => {
            useTimelineStore.getState().loadProject(session);
            setOpen(false);
          }}
          title="Replace the current timeline with your last session"
        >
          Restore
        </button>
        <button type="button" className={barButton} onClick={() => setOpen(false)}>
          Dismiss
        </button>
      </div>
    </div>
  );
};

/**
 * Project controls in the timeline header: editable name, New, Open / Save project file,
 * and WAV export. The arrangement also autosaves to this browser.
 */
export const ProjectBar: React.FC = () => {
  const projectName = useTimelineStore((s) => s.projectName);
  const [dialog, setDialog] = useState<'new' | 'export' | null>(null);
  const [openError, setOpenError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const save = () => {
    const s = useTimelineStore.getState();
    const data = serializeProject({
      name: s.projectName,
      bpm: s.bpm,
      swing: s.swing,
      loopRegion: s.loopRegion,
      tracks: s.tracks,
      clips: s.clips,
      masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFileName(s.projectName)}.beatbox.json`);
  };

  const open = async (file: File) => {
    try {
      const project = parseProject(JSON.parse(await file.text()));
      useTimelineStore.getState().loadProject(project);
      setOpenError('');
    } catch (err) {
      const reason = err instanceof SyntaxError ? 'the file is not valid JSON' : err instanceof Error ? err.message : String(err);
      setOpenError(`Couldn't open ${file.name}: ${reason}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex items-center gap-1.5 mr-1" title="Project name (used for file names)">
        <Music2 className="w-3.5 h-3.5 text-forge-muted" />
        <input
          value={projectName}
          onChange={(e) => useTimelineStore.getState().setProjectName(e.target.value)}
          onBlur={(e) => !e.target.value.trim() && useTimelineStore.getState().setProjectName('Untitled')}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-8 w-44 bg-transparent border border-transparent hover:border-forge-border focus:border-cyan-500 rounded-md px-2 text-sm font-semibold text-forge-text focus:outline-none"
          aria-label="Project name"
        />
      </label>
      <button type="button" className={barButton} onClick={() => setDialog('new')} title="New arrangement">
        <FilePlus2 className="w-3.5 h-3.5" /> New
      </button>
      <button type="button" className={barButton} onClick={() => fileInput.current?.click()} title="Open a .beatbox.json project file">
        <FolderOpen className="w-3.5 h-3.5" /> Open
      </button>
      <button type="button" className={barButton} onClick={save} title="Download this arrangement as a project file">
        <Save className="w-3.5 h-3.5" /> Save
      </button>
      <button
        type="button"
        className={`${barButton} !text-emerald-300 !border-emerald-500/50 hover:!bg-emerald-500/10`}
        onClick={() => setDialog('export')}
        title="Render and download the song as a WAV file"
      >
        <Download className="w-3.5 h-3.5" /> Export WAV
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void open(file);
        }}
      />

      {openError && (
        <span className="basis-full text-[11px] text-red-400 flex items-center gap-2">
          {openError}
          <button type="button" onClick={() => setOpenError('')} className="text-forge-muted hover:text-forge-text">
            <X className="w-3 h-3" />
          </button>
        </span>
      )}

      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
    </div>
  );
};
