import React, { useRef, useState } from 'react';
import { Download, FilePlus2, FolderOpen, History, Music2, Save, X } from 'lucide-react';
import { currentProject, lastSession, useTimelineStore } from '../../store/timelineStore';
import { parseProject, safeFileName, serializeProject } from '../../store/project';
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
