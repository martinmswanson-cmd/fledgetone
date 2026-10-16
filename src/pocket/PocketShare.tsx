/**
 * Pocket's Share screen: the song as an MP3 (handed to the phone's share sheet where it has one,
 * else downloaded), a link that opens the song (in Pocket on a phone, in the studio on a computer),
 * the project file to save or open, and the switch to the full studio.
 */
import React, { useState } from 'react';
import { Download, FolderOpen, Link2, Loader2, Monitor, Save } from 'lucide-react';
import { currentProject } from '../store/timelineStore';
import { songLink } from '../store/shareLink';
import { downloadBlob } from '../audio/exportWav';
import { pickProjectFile, saveProjectFile } from '../components/timeline/projectFile';
import { showToast } from '../components/timeline/toastStore';
import { versionLabel } from '../version';
import { chooseInterface } from './pocketMode';
import { renderSongMp3 } from './pocketExport';
import { Card, pill } from './pocketUi';

/** Hand a file or a link to the phone's share sheet; false where there's none (or it was refused). */
async function shareSheet(data: ShareData): Promise<boolean> {
  if (typeof navigator.share !== 'function' || (navigator.canShare && !navigator.canShare(data))) return false;
  try {
    await navigator.share(data);
    return true;
  } catch (err) {
    // Closed without sharing: nothing more to do
    return err instanceof DOMException && err.name === 'AbortError';
  }
}

export const PocketShare: React.FC = () => {
  const [busy, setBusy] = useState<string | null>(null);

  const exportMp3 = async () => {
    setBusy('Starting');
    try {
      const out = await renderSongMp3((f, detail) => setBusy(f < 1 ? `${detail} (${Math.round(f * 100)}%)` : detail));
      if (!out) {
        showToast('The song is empty: write something first');
        return;
      }
      const file = new File([out.blob], out.name, { type: 'audio/mpeg' });
      if (!(await shareSheet({ files: [file], title: out.name }))) {
        downloadBlob(out.blob, out.name);
        showToast(`Saved ${out.name}`);
      }
    } catch (err) {
      showToast(`Couldn't make the MP3: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async () => {
    const url = await songLink(currentProject(), `${location.origin}${location.pathname}`);
    if (await shareSheet({ url, title: currentProject().name })) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied: anyone who opens it hears this song');
    } catch {
      showToast("Couldn't copy the link here");
    }
  };

  return (
    <>
      <Card title="Share the song">
        <div className="space-y-2">
          <button type="button" className={`${pill} w-full !border-cyan-400 text-cyan-200`} onClick={() => void exportMp3()} disabled={busy !== null}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ?? 'Export an MP3'}
          </button>
          <button type="button" className={`${pill} w-full`} onClick={() => void shareLink()}>
            <Link2 className="w-4 h-4" /> Share a link to the song
          </button>
          <p className="text-[11px] text-forge-muted">A link opens the song in Fledgetone, on a phone or a computer, to listen to and change. Recorded sounds aren't in links: save the file for those.</p>
        </div>
      </Card>
      <Card title="Project file">
        <div className="flex gap-2">
          <button type="button" className={`${pill} flex-1`} onClick={() => void saveProjectFile()}>
            <Save className="w-4 h-4" /> Save
          </button>
          <button type="button" className={`${pill} flex-1`} onClick={() => pickProjectFile()}>
            <FolderOpen className="w-4 h-4" /> Open
          </button>
        </div>
        <p className="text-[11px] text-forge-muted mt-2">The song also saves itself in this browser as you work.</p>
      </Card>
      <Card title="On a computer">
        <p className="text-sm text-forge-muted mb-3">
          This is Fledgetone Pocket, the phone version. The full studio has the rest: automation, plugins, effects, video, game music. Your song opens there as it is.
        </p>
        <button type="button" className={`${pill} w-full`} onClick={() => chooseInterface('studio')}>
          <Monitor className="w-4 h-4" /> Use the full studio here
        </button>
      </Card>
      <p className="text-center text-[11px] text-forge-muted font-mono">Fledgetone {versionLabel()}</p>
    </>
  );
};
