import React, { useRef, useState } from 'react';
import { Download, FilePlus2, FolderOpen, History, Music2, Save, X } from 'lucide-react';
import { AlertTriangle, HardDrive } from 'lucide-react';
import { currentProject, lastSession, retryAutosave, useTimelineStore } from '../../store/timelineStore';
import { clearPreviousSession, parseProject, safeFileName, serializeProject } from '../../store/project';
import { downloadBlob } from '../../audio/exportWav';
import { ExportDialog } from './ExportDialog';
import { Modal } from './Modal';

const barButton =
  'h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg text-xs font-mono text-forge-muted hover:text-forge-text hover:border-forge-borderLight transition-colors';

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

const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The day of `at` in words: "today", "yesterday", or "on 3 Oct" (with the year if it isn't this year). */
function onDay(at: number): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (at >= startOfToday.getTime()) return 'today';
  if (at >= startOfYesterday.getTime()) return 'yesterday';
  const d = new Date(at);
  const sameYear = d.getFullYear() === startOfToday.getFullYear();
  return `on ${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })}`;
}

/**
 * When a session was saved, in words (in the local clock style): "saved today at 14:02",
 * "saved yesterday at 18:30", "saved on 3 Oct at 9:15". An autosave from an older version only
 * says when it was set aside: "saved before 14:02 today".
 */
function savedWhen({ savedAt, keptAt }: { savedAt: number | null; keptAt: number | null }): string | null {
  if (savedAt !== null) return `saved ${onDay(savedAt)} at ${clockTime(savedAt)}`;
  if (keptAt !== null) return `saved before ${clockTime(keptAt)} ${onDay(keptAt)}`;
  return null;
}

/**
 * The app always opens on an empty timeline. If the last session had work in it, offer to
 * bring it back. The session was set aside at startup, so the offer survives reloads until
 * Restore or Dismiss (or until a newer session with clips takes its place).
 */
export const RestoreSessionBanner: React.FC = () => {
  const [open, setOpen] = useState(lastSession !== null);
  if (!open || !lastSession) return null;
  const { project } = lastSession;
  // What's in it: its clips, or the markers of a session that has only those
  const markers = project.markers?.length ?? 0;
  const [n, what] = project.clips.length > 0 || markers === 0 ? [project.clips.length, 'clip'] : [markers, 'marker'];
  const when = savedWhen(lastSession);
  const close = (dismissed: boolean) => {
    clearPreviousSession(dismissed);
    // Its space is free now, so an autosave that didn't fit may fit
    retryAutosave();
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-b border-forge-border bg-cyan-500/10 text-xs">
      <History className="w-4 h-4 text-cyan-300 shrink-0" />
      <span className="text-forge-text">
        Your last session, <b>{project.name}</b> ({n} {what}{n === 1 ? '' : 's'}
        {when && `, ${when}`}), can be restored.
      </span>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          className={`${barButton} !text-cyan-200 !border-cyan-400/60`}
          onClick={() => {
            useTimelineStore.getState().loadProject(project);
            close(false);
          }}
          title="Replace the current timeline with your last session"
        >
          Restore
        </button>
        <button type="button" className={barButton} onClick={() => close(true)} title="Forget your last session">
          Dismiss
        </button>
      </div>
    </div>
  );
};

/**
 * Whether the browser copy is up to date: "Saved in this browser" with the time of the last
 * autosave, or a red warning when it no longer fits (or the browser blocks storage).
 */
const AutosaveStatusChip: React.FC = () => {
  const status = useTimelineStore((s) => s.autosaveStatus);
  if (!status) return null;
  if (status.ok) {
    return (
      <span
        className="flex items-center gap-1 px-1 text-[11px] font-mono text-forge-muted"
        title="Your work is saved in this browser half a second after every change. Use Save to keep a file."
      >
        <HardDrive className="w-3 h-3" />
        Saved in this browser · {clockTime(status.at)}
      </span>
    );
  }
  return (
    <span role="status" className="basis-full flex items-center gap-1.5 text-[11px] text-red-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {status.reason === 'full'
        ? 'Not autosaved: browser storage is full. Use Save, or Dismiss your last session below to make room.'
        : status.reason === 'too-big'
          ? 'Not autosaved: this project is too big for browser storage. Use Save.'
          : 'Not autosaved: this browser is blocking storage for this site. Use Save.'}
    </span>
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
    const project = currentProject();
    const blob = new Blob([JSON.stringify(serializeProject(project), null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFileName(project.name)}.beatbox.json`);
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
        title="Render and download the song, or the loop, as WAV audio (the mix, or one file per track)"
      >
        <Download className="w-3.5 h-3.5" /> Export WAV
      </button>
      <AutosaveStatusChip />
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
