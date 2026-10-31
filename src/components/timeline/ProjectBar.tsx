/**
 * The project bar in the header: the song's name, Save, Export and Share, the autosave status, the
 * New dialog (a blank timeline or a starter; opened from the File menu), and the banner offering to restore the
 * last session.
 */
import React, { useState } from 'react';
import { Download, Gamepad2, History, Music2, Save, Share2 } from 'lucide-react';
import { AlertTriangle, HardDrive } from 'lucide-react';
import { retryAutosave, useLastSession, useOtherTab, useTimelineStore } from '../../store/timelineStore';
import { sayWhatWasLeftOut } from '../../store/reopenLastSong';
import { useUiStore } from '../../store/uiStore';
import { useTourStore } from '../../tour/tourStore';
import { autosaveUnreadable, clearPreviousSession, hasWork as songHasWork } from '../../store/project';
import { saveProjectFile, useProjectFile } from './projectFile';
import { ExportDialog } from './ExportDialog';
import { BeatStoreDialog } from './BeatStoreDialog';
import { ChannelKitDialog } from './ChannelKitDialog';
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

const NewProjectDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // (an empty song has nothing to lose: no warning, just where to begin)
  const hasWork = useTimelineStore((s) => songHasWork(s));
  const choose = (template: 'blank' | StarterId) => {
    useTimelineStore.getState().newProject(template);
    onClose();
  };
  return (
    <Modal title="New arrangement" onClose={onClose} wide>
      {hasWork ? (
        <p>
          This replaces the current timeline and clears undo history. Save it first if you want to keep it. Copied clips
          stay on the clipboard, so you can paste them into the new arrangement.
        </p>
      ) : (
        <p>Pick a starter to hear something straight away, or begin from a blank timeline.</p>
      )}
      <ChoiceButton
        title="Blank timeline"
        detail="Four empty tracks. Double-click a lane to make a clip (right-click it for ready-made patterns), or paste copied clips."
        onClick={() => choose('blank')}
        autoFocus
      />
      {STARTER_GROUPS.map((group) => (
        <React.Fragment key={group}>
          <h4 className="pt-1 text-[9px] uppercase tracking-widest text-forge-muted font-mono">Starters: {group} (sections marked, the master set up)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" aria-label={group}>
            {STARTERS.filter((s) => s.group === group).map((s) => (
              <ChoiceButton key={s.id} title={s.name} detail={s.detail} onClick={() => choose(s.id)} searchId={`starter-${s.id}`} />
            ))}
          </div>
        </React.Fragment>
      ))}
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
 * The song New, Open or a shared link replaced, offered back (the last song itself opens again at
 * startup: reopenLastSong.ts). It's set aside in storage, so the offer survives reloads until
 * Restore or Dismiss (or until a newer replaced song takes its place).
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
  // What's in it: its clips, or the markers of a session that has only those, or its plugin
  // tracks (a sound built before any notes)
  const markers = project.markers?.length ?? 0;
  const pluginTracks = project.tracks.filter((t) => t.plugin || t.pluginFx?.length).length;
  const [n, what] = project.clips.length > 0 ? [project.clips.length, 'clip'] : markers > 0 ? [markers, 'marker'] : [pluginTracks, 'track'];
  // ("1 track with plugins", "2 tracks with plugins")
  const tail = what === 'track' ? ' with plugins' : '';
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
        {lastSession.replaced ? 'The song you replaced' : 'Your last session'}, <b>{project.name}</b> ({n} {what}{n === 1 ? '' : 's'}{tail}
        {when && `, ${when}`}), {lastSession.stopped ? "froze or stopped the studio last time it opened, so it wasn't opened again. It's kept, and " : ''}can be restored.
      </span>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          className={`${barButton} !text-cyan-200 !border-cyan-400/60`}
          onClick={() => {
            // (Loading sets the current song aside in its place, so Restore can be undone the same way)
            close(false);
            useTimelineStore.getState().loadProject(project);
            sayWhatWasLeftOut(project);
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
  // Before the first autosave, its room is kept, so the header doesn't jump (or wrap) when it appears
  if (!status || status.ok) {
    return (
      <span
        aria-hidden={!status}
        className={`flex items-center gap-1 px-1 text-[11px] font-mono text-forge-muted whitespace-nowrap ${status ? '' : 'invisible'}`}
        title="Your work is saved in this browser half a second after every change, in this browser only: clearing its data loses it. Use Save to keep a file."
      >
        <HardDrive className="w-3 h-3" />
        Saved<span className="hidden 2xl:inline"> in this browser</span> · {status ? clockTime(status.at) : '00:00 PM'}
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

/** Fledgetone open in another tab too (they share one autosave): what happens to each tab's changes. */
const OtherTabNotice: React.FC = () => {
  const song = useOtherTab((s) => s.song);
  if (!song) return null;
  return (
    <span role="status" className="flex items-center gap-1.5 text-[11px] text-amber-300" title="Both tabs save to the same place in this browser. Before this tab saves over the other tab's work, that work is kept as a version: File › Versions has it.">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      {song === 'same'
        ? 'This song is also open in another tab: its changes are kept as a separate version (File › Versions).'
        : 'Fledgetone is open in another tab with another song: that song is kept as a version (File › Versions).'}
    </span>
  );
};

const STORAGE_NOTICE_KEY = 'bosBeatbox.storageNoticeSeen';
const seenStorageNotice = () => {
  try {
    return localStorage.getItem(STORAGE_NOTICE_KEY) === '1';
  } catch {
    return true;
  }
};

/**
 * Once, after the first autosave (when playback stops): the work is kept in this browser only, and
 * Save keeps a file. A small card in the corner (clear of the header's buttons), not a dialog; Save
 * or Got it closes it for good.
 */
const StorageNotice: React.FC = () => {
  const ok = useTimelineStore((s) => s.autosaveStatus?.ok === true);
  const savedTo = useProjectFile((s) => s.handle?.name ?? null);
  const [seen, setSeen] = React.useState(seenStorageNotice);
  // (not over the transport while someone is listening: it waits for the stop)
  const playing = useTimelineStore((s) => s.isPlaying);
  // (nor under a tutorial's card: it shows after the tutorial)
  const touring = useTourStore((s) => s.active !== null);
  if (seen || !ok || savedTo || playing || touring) return null;
  const done = () => {
    try {
      localStorage.setItem(STORAGE_NOTICE_KEY, '1');
    } catch {
      // Storage blocked: it shows again next time
    }
    setSeen(true);
  };
  return (
    <div role="note" className="fixed bottom-4 left-4 z-40 w-[min(92vw,360px)] rounded-lg border border-cyan-500/50 bg-forge-panel shadow-xl p-3 text-xs flex flex-col gap-2">
      <p className="text-forge-text">
        <b>Your work is saved in this browser only.</b> Clearing your browsing data deletes it, and a private window, another browser or another computer won't have it.{' '}
        <b>Save</b> keeps a project file you own (with its sounds).
      </p>
      <div className="flex gap-2 justify-end">
        <button type="button" className="h-7 px-3 rounded-md border border-forge-border text-forge-muted hover:text-forge-text" onClick={done}>
          Got it
        </button>
        <button
          type="button"
          className="h-7 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25"
          onClick={() => {
            done();
            void saveProjectFile();
          }}
        >
          Save a file
        </button>
      </div>
    </div>
  );
};

/** The Game tools (states, intensity, stingers, game kits), one click from the header. */
const GameButton: React.FC = () => {
  const on = useUiStore((s) => s.dockOpen && s.dockTab === 'game');
  return (
    <button
      type="button"
      className={`${barButton} ${on ? '!text-violet-200 !border-violet-400/70 !bg-violet-500/15' : ''}`}
      onClick={() => (on ? useUiStore.getState().setDockOpen(false) : useUiStore.getState().openDock('game'))}
      aria-pressed={on}
      title="Game music: switch between states, change the intensity, fire stingers, try it in a game and export a kit for Godot, Unity or the web"
    >
      <Gamepad2 className="w-3.5 h-3.5" /> Game
    </button>
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
    <div className="relative flex flex-wrap items-center gap-1.5">
      <AutosaveStatusChip />
      <OtherTabNotice />
      <StorageNotice />
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
      <GameButton />

      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'beatStore' && <BeatStoreDialog onClose={() => setDialog(null)} />}
      {dialog === 'channelKit' && <ChannelKitDialog onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
    </div>
  );
};
