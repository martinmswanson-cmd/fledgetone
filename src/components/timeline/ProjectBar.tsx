/**
 * The project bar in the header: the song's name, Save, Export and Share, the autosave status, the
 * New dialog (genre starters; opened from the File menu), and the banner offering to restore the
 * last session.
 */
import React, { useState } from 'react';
import { Download, History, Music2, Save, Share2 } from 'lucide-react';
import { AlertTriangle, HardDrive } from 'lucide-react';
import { retryAutosave, useLastSession, useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { autosaveUnreadable, clearPreviousSession } from '../../store/project';
import { saveProjectFile, useProjectFile } from './projectFile';
import { ExportDialog } from './ExportDialog';
import { BeatStoreDialog } from './BeatStoreDialog';
import { ShareDialog } from './ShareDialog';
import { Modal } from './Modal';
import { STARTER_GROUPS, STARTERS } from '../../store/starters';
import type { StarterId } from '../../store/starters';

const barButton =
  'h-8 px-2.5 flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg text-xs font-mono text-forge-muted hover:text-forge-text hover:border-forge-borderLight transition-colors';

export const ChoiceButton: React.FC<{ title: string; detail: string; onClick: () => void; disabled?: boolean; autoFocus?: boolean; searchId?: string }> = ({
  title,
  detail,
  onClick,
  disabled,
  autoFocus,
  searchId,
}) => (
  <button
    type="button"
    data-search={searchId}
    onClick={onClick}
    disabled={disabled}
    autoFocus={autoFocus}
    className="text-left rounded-lg border border-forge-border bg-forge-bg px-3 py-2.5 hover:border-cyan-500/70 hover:bg-cyan-500/10 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:border-cyan-500"
  >
    <div className="text-sm font-semibold text-forge-text">{title}</div>
    <div className="mt-0.5 text-[11px] text-forge-muted">{detail}</div>
  </button>
);

/** The Classics are listed with the demo song (complete pieces to listen to), not among the starter groups. */
const DEMO_GROUP = 'Classics';
const DEMO_SONGS = STARTERS.filter((s) => s.group === DEMO_GROUP);

const NewProjectDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [filter, setFilter] = useState('');
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const found = STARTERS.filter((s) => words.every((w) => `${s.name} ${s.group} ${s.detail}`.toLowerCase().includes(w)));
  const choose = (template: 'blank' | 'demo' | StarterId) => {
    useTimelineStore.getState().newProject(template);
    onClose();
  };
  return (
    <Modal title="New arrangement" onClose={onClose} wide>
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
      {/* Demo songs: the demo groove, then the Classics (complete public-domain pieces) to listen to */}
      <h4 className="pt-1 text-[9px] uppercase tracking-widest text-forge-muted font-mono">Demo songs: press Play and listen</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" aria-label="Demo songs">
        <ChoiceButton title="Sunset Stroll" detail="The demo song: a 12-bar neo-soul groove at 88 BPM (intro, groove, horn hook)." onClick={() => choose('demo')} />
        {DEMO_SONGS.map((s) => (
          <ChoiceButton key={s.id} title={s.name} detail={s.detail} onClick={() => choose(s.id)} searchId={`starter-${s.id}`} />
        ))}
      </div>
      <h4 className="pt-1 text-[9px] uppercase tracking-widest text-forge-muted font-mono">Starters: sections marked, the master set up; game ones come with states, layers and stingers</h4>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Find a starter (${STARTERS.length - DEMO_SONGS.length}) or demo song: boss, cozy, 140, minor…`}
        aria-label="Find a starter"
        className="h-8 w-full bg-forge-bg border border-forge-border rounded-md px-2.5 text-xs text-forge-text focus:outline-none focus:border-cyan-500"
      />
      {words.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" aria-label="Starters found">
          {found.map((s) => (
            <ChoiceButton key={s.id} title={s.name} detail={`${s.group}. ${s.detail}`} onClick={() => choose(s.id)} searchId={`starter-${s.id}`} />
          ))}
          {!found.length && <p className="text-xs text-forge-muted p-2">No starter matches.</p>}
        </div>
      ) : (
        STARTER_GROUPS.filter((g) => g !== DEMO_GROUP).map((group) => {
          const list = STARTERS.filter((s) => s.group === group);
          return (
            <details key={group} aria-label={group} className="group rounded-lg border border-forge-border bg-forge-bg/40 open:bg-transparent">
              <summary className="cursor-pointer select-none list-none flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 rounded-lg">
                <span className="text-forge-muted transition-transform group-open:rotate-90">▸</span>
                <span className="font-semibold text-forge-text">{group}</span>
                <span className="text-[10px] font-mono text-forge-muted">{list.length}</span>
                <span className="ml-auto truncate text-[10px] text-forge-muted hidden sm:block group-open:hidden">{list.map((s) => s.name).join(' · ')}</span>
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2 pt-0">
                {list.map((s) => (
                  <ChoiceButton key={s.id} title={s.name} detail={s.detail} onClick={() => choose(s.id)} searchId={`starter-${s.id}`} />
                ))}
              </div>
            </details>
          );
        })
      )}
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
  const lastSession = useLastSession((s) => s.session);
  const [unreadableSeen, setUnreadableSeen] = useState(false);
  if (!lastSession && autosaveUnreadable && !unreadableSeen)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-b border-forge-border bg-amber-500/10 text-xs">
        <History className="w-4 h-4 text-amber-300 shrink-0" />
        <span className="text-forge-text">
          Your last session couldn't be read (it may be damaged, or from a newer version of Fledgetone). It's kept in this browser, apart, so nothing overwrites it.
        </span>
        <button type="button" className={`${barButton} ml-auto`} onClick={() => setUnreadableSeen(true)}>
          OK
        </button>
      </div>
    );
  if (!lastSession) return null;
  const { project } = lastSession;
  // What's in it: its clips, or the markers of a session that has only those
  const markers = project.markers?.length ?? 0;
  const [n, what] = project.clips.length > 0 || markers === 0 ? [project.clips.length, 'clip'] : [markers, 'marker'];
  const when = savedWhen(lastSession);
  const close = (dismissed: boolean) => {
    clearPreviousSession(dismissed);
    // Its space is free now, so an autosave that didn't fit may fit
    retryAutosave();
    useLastSession.setState({ session: null });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-b border-forge-border bg-cyan-500/10 text-xs">
      <History className="w-4 h-4 text-cyan-300 shrink-0" />
      <span className="text-forge-text">
        {lastSession.replaced ? 'The song you replaced' : 'Your last session'}, <b>{project.name}</b> ({n} {what}{n === 1 ? '' : 's'}
        {when && `, ${when}`}), can be restored.
      </span>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          className={`${barButton} !text-cyan-200 !border-cyan-400/60`}
          onClick={() => {
            // (Loading sets the current song aside in its place, so Restore can be undone the same way)
            close(false);
            useTimelineStore.getState().loadProject(project);
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
    <span role="status" className="flex items-center gap-1.5 text-[11px] text-red-400">
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
 * Project controls in the top bar: the editable name, Save, Export and Share (New and Open are in
 * the File menu). The arrangement also autosaves to this browser.
 */
export const ProjectBar: React.FC = () => {
  const projectName = useTimelineStore((s) => s.projectName);
  const savedTo = useProjectFile((s) => s.handle?.name ?? null);
  const dialog = useUiStore((s) => s.dialog);
  const setDialog = useUiStore.getState().setDialog;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AutosaveStatusChip />
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
      <button
        type="button"
        className={barButton}
        id="btn-save-project"
        onClick={() => void saveProjectFile()}
        title={savedTo ? `Save to ${savedTo} (File › Save As… to save somewhere else)` : 'Save this arrangement as a project file, with its sounds: choose where (File › Save As… later saves a copy elsewhere)'}
      >
        <Save className="w-3.5 h-3.5" /> Save
      </button>
      <button
        type="button"
        className={`${barButton} !text-emerald-300 !border-emerald-500/50 hover:!bg-emerald-500/10`}
        onClick={() => setDialog('export')}
        title="Render the song or the loop as WAV, MP3, OGG or an MP4 video (the mix, one file per track, or an intro + loop for games)"
      >
        <Download className="w-3.5 h-3.5" /> Export
      </button>
      <button type="button" className={barButton} onClick={() => setDialog('share')} title="Share the song: a link that opens it, an MP3, or the project file">
        <Share2 className="w-3.5 h-3.5" /> Share
      </button>

      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'beatStore' && <BeatStoreDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
    </div>
  );
};
