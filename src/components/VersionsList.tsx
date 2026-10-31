/**
 * The Versions list, in the studio's File › Versions dialog and in Pocket's Versions sheet: the
 * versions of your songs this browser keeps (versions.ts), this song's first, each with when it
 * was kept ("10 min ago", "yesterday 14:02"). Tap one to go back to it, after a confirm.
 */
import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { refreshVersions, useVersions, type VersionInfo } from '../store/versions';
import { versionWhen } from '../store/versionPolicy';
import { restoreVersion } from '../store/restoreVersion';
import { showToast } from './timeline/toastStore';

/** The plain promise, shown near the list. */
export const FILES_PROMISE = 'Your songs are files. If this app disappeared tomorrow, they would still open at fledgetone.com.';

const WHY: Record<VersionInfo['why'], string> = {
  editing: '',
  replaced: 'before another song opened',
  restore: 'before going back to a version',
  otherTab: 'from another tab',
  stopped: 'set aside: it stopped the app showing',
};

const summary = (v: VersionInfo) =>
  [`${v.tracks} track${v.tracks === 1 ? '' : 's'}`, `${v.bars} bar${v.bars === 1 ? '' : 's'}`, WHY[v.why]].filter(Boolean).join(' · ');

/**
 * The list. `touch` sizes it for a phone; `onRestored` is told once a version has opened (to close
 * the sheet or dialog).
 */
export const VersionsList: React.FC<{ touch?: boolean; onRestored: () => void }> = ({ touch = false, onRestored }) => {
  const { list, unavailable, readAt } = useVersions();
  const songId = useTimelineStore((s) => s.songId);
  const [tick, setTick] = useState(() => Date.now());
  // (The list may be newer than the last tick: times count from whichever is later)
  const now = Math.max(tick, readAt);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void refreshVersions();
    // "2 min ago" moves on while the list is open
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const goBack = async (v: VersionInfo) => {
    // (As the list says it)
    const when = versionWhen(v.savedAt, now);
    if (!window.confirm(`Go back to ${v.name} from ${when}?\n\nThe song open now is kept as a version too, so you can come back to it.`)) return;
    setBusy(true);
    try {
      const name = await restoreVersion(v.id);
      showToast(`Back to ${name} from ${when}.`);
      onRestored();
    } catch {
      showToast("That version couldn't be opened.");
    } finally {
      setBusy(false);
    }
  };

  const mine = (list ?? []).filter((v) => v.songId === songId);
  const others = (list ?? []).filter((v) => v.songId !== songId);
  const row = (v: VersionInfo) => (
    <li key={v.id}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void goBack(v)}
        className={`w-full min-w-0 text-left flex items-start gap-3 rounded-lg disabled:opacity-50 ${touch ? 'px-3 py-3 active:bg-white/5' : 'px-2 py-1.5 hover:bg-white/5'}`}
        title={new Date(v.savedAt).toLocaleString()}
      >
        <History className={`${touch ? 'w-5 h-5 mt-0.5' : 'w-3.5 h-3.5 mt-0.5'} text-cyan-300 shrink-0`} />
        <span className="min-w-0 flex-1">
          <span className={`flex items-baseline gap-2 ${touch ? 'text-sm' : 'text-xs'} text-forge-text`}>
            <b className="font-semibold">{versionWhen(v.savedAt, now)}</b>
            <span className="truncate">{v.name}</span>
          </span>
          <span className={`block ${touch ? 'text-xs' : 'text-[11px]'} text-forge-muted`}>{summary(v)}</span>
        </span>
      </button>
    </li>
  );
  const heading = `${touch ? 'text-xs px-3' : 'text-[11px] px-2'} font-semibold uppercase tracking-wide text-forge-muted mt-2 mb-1`;

  return (
    <div className="flex flex-col gap-1" data-versions>
      {unavailable ? (
        <p className={touch ? 'text-sm text-forge-muted px-1' : 'text-forge-muted'}>
          This browser isn't keeping versions (its storage is blocked, as in some private windows). The song still saves itself as you work; save the file to keep a copy.
        </p>
      ) : list && !list.length ? (
        <p className={touch ? 'text-sm text-forge-muted px-1' : 'text-forge-muted'}>
          No versions yet. While you work, one is kept every couple of minutes, and one just before another song opens.
        </p>
      ) : null}
      {mine.length > 0 && (
        <>
          <h3 className={heading}>This song</h3>
          <ul>{mine.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className={heading}>Other songs</h3>
          <ul>{others.map(row)}</ul>
        </>
      )}
      <p className={`${touch ? 'text-xs px-1' : 'text-[11px]'} text-forge-muted mt-2`}>{FILES_PROMISE}</p>
    </div>
  );
};
