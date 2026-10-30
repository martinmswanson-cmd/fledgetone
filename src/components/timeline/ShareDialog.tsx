/**
 * The Share dialog: a link that opens the song (shareLink.ts), the mix as an MP3, or the project
 * file with its sounds, handed to the device's share sheet where the browser has one and
 * downloaded otherwise.
 */
import React, { useEffect, useState } from 'react';
import { Check, Copy, FileAudio, FileJson, Link2, Loader2, Share2 } from 'lucide-react';
import { currentProject, songMeterOf, useTimelineStore } from '../../store/timelineStore';
import { safeFileName, serializeProject } from '../../store/project';
import { referencedSoundIds } from '../../store/audioClips';
import { LONG_LINK, songLink, tracksNeedingFiles } from '../../store/shareLink';
import { captureWamStates } from '../../audio/wamHost';
import { APP_LINK_BASE, isNativeApp } from '../../native/nativeApp';
import { embedSounds } from '../../audio/soundLibrary';
import { audibleTracks, channelsOf, downloadBlob, renderArrangement } from '../../audio/exportWav';
import { encodeAudio } from '../../audio/encoders';
import { exportCeilingDbtp } from '../../audio/effects/limiter';
import { DEFAULT_MASTER_FX } from '../../store/timelineTypes';
import { Modal } from './Modal';
import { showToast } from './toastStore';

/**
 * Hand a file to the device's share sheet (phones, Windows, macOS Safari) where the browser can,
 * or download it. Resolves to what happened, for the message to show.
 */
async function shareOrDownload(file: File, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Refused (no user gesture left after a long render, a policy): download instead
    }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}

const section = 'flex flex-col gap-2 bg-forge-bg p-3 rounded-lg border border-forge-border';
const button =
  'h-8 px-3 flex items-center justify-center gap-1.5 rounded-md border border-forge-border bg-forge-panel text-xs font-mono text-forge-text hover:border-cyan-500/70 disabled:opacity-40 disabled:pointer-events-none';

/**
 * Share the song three ways: a link that opens it in Fledgetone (the song travels inside the
 * link, see shareLink.ts), the mix as an MP3, or the project file with its sounds.
 */
export const ShareDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const projectName = useTimelineStore((s) => s.projectName);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'' | 'audio' | 'file'>('');
  const project = currentProject();
  const needFiles = tracksNeedingFiles(project);
  const hasMusic = project.clips.some((c) => audibleTracks(project.tracks).some((t) => t.id === c.trackId));

  useEffect(() => {
    let live = true;
    // (The plugins' latest settings first: they reach the tracks every few seconds otherwise)
    captureWamStates().then(() => songLink(currentProject(), isNativeApp() ? APP_LINK_BASE : `${location.origin}${location.pathname}${location.search}`)).then(
      (url) => live && setLink(url),
      (err) => live && setLinkError(err instanceof Error ? err.message : String(err))
    );
    return () => {
      live = false;
    };
  }, []);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy: select the link and copy it yourself");
    }
  };

  const shareLink = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: projectName, text: `${projectName}, made with Fledgetone`, url: link });
    } catch {
      // Cancelled
    }
  };

  const shareAudio = async () => {
    setBusy('audio');
    try {
      const s = useTimelineStore.getState();
      s.pause();
      await captureWamStates();
      const p = currentProject();
      const ids = new Set(audibleTracks(p.tracks).map((t) => t.id));
      const end = Math.max(2, ...p.clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
      const audio = await renderArrangement({ tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, meter: songMeterOf(s), swing: p.swing, masterFx: p.masterFx ?? DEFAULT_MASTER_FX, master: p.master, startBar: 1, endBar: end, ending: 'ringOut', sampleRate: 44100, peakCeilingDbtp: exportCeilingDbtp('mp3'), markers: p.markers, intensity: { value: s.intensity, curves: s.intensityCurves } });
      const mp3 = await encodeAudio(channelsOf(audio), audio.sampleRate, 'mp3', { bitDepth: 16 });
      const file = new File([mp3], `${safeFileName(p.name)}.mp3`, { type: 'audio/mpeg' });
      const how = await shareOrDownload(file, p.name);
      if (how !== 'cancelled') showToast(how === 'shared' ? `Shared ${file.name}` : `Downloaded ${file.name}: send it however you like`);
    } catch (err) {
      showToast(`Couldn't make the MP3: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('');
    }
  };

  const shareFile = async () => {
    setBusy('file');
    try {
      await captureWamStates();
      const p = currentProject();
      const sounds = await embedSounds(referencedSoundIds(p));
      const json = JSON.stringify(serializeProject({ ...p, sounds }), null, 2);
      const file = new File([json], `${safeFileName(p.name)}.fledgetone.json`, { type: 'application/json' });
      const how = await shareOrDownload(file, p.name);
      if (how !== 'cancelled') showToast(how === 'shared' ? `Shared ${file.name}` : `Downloaded ${file.name}`);
    } catch (err) {
      showToast(`Couldn't make the project file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('');
    }
  };

  const canShareLink = typeof navigator.share === 'function';

  return (
    <Modal title="Share" onClose={onClose}>
      <div className={section}>
        <div className="flex items-center gap-1.5 text-forge-text font-semibold">
          <Link2 className="w-4 h-4 text-cyan-400" /> A link to this song
        </div>
        <p>
          Anyone who opens it gets the song in Fledgetone, ready to play and change. The whole song travels inside the link, so nothing is uploaded anywhere: it works as long as this
          site is online.
        </p>
        {link ? (
          <>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Song link" className="h-8 w-full rounded-md border border-forge-border bg-black/40 px-2 font-mono text-[11px] text-forge-text" />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={button} onClick={() => void copy()} autoFocus>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {canShareLink && (
                <button type="button" className={button} onClick={() => void shareLink()}>
                  <Share2 className="w-3.5 h-3.5" /> Share…
                </button>
              )}
            </div>
            <p className="text-[11px]">
              {link.length.toLocaleString()} characters.
              {link.length > LONG_LINK && ` That's too long for a Discord message (2,000) and some other chat apps: there, send the MP3 or the project file instead.`}
            </p>
          </>
        ) : linkError ? (
          <p className="text-red-400">Couldn't make the link: {linkError}</p>
        ) : (
          <p className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Making the link…
          </p>
        )}
        {needFiles.length > 0 && (
          <p className="text-amber-300 text-[11px]">
            Sound files can't go in a link, so {needFiles.join(', ')} will be silent for whoever opens it. Share the project file to include them.
          </p>
        )}
      </div>

      <div className={section}>
        <div className="flex items-center gap-1.5 text-forge-text font-semibold">
          <FileAudio className="w-4 h-4 text-emerald-400" /> The song as an MP3
        </div>
        <p>The whole song, mixed. On a phone or a computer that can, this opens your share menu (messages, email, Discord…); otherwise it downloads.</p>
        <button type="button" className={button} disabled={!!busy || !hasMusic} onClick={() => void shareAudio()}>
          {busy === 'audio' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          {busy === 'audio' ? 'Making the MP3…' : 'Share MP3'}
        </button>
      </div>

      <div className={section}>
        <div className="flex items-center gap-1.5 text-forge-text font-semibold">
          <FileJson className="w-4 h-4 text-amber-400" /> The project file
        </div>
        <p>Everything, sound files included, for someone to open with Open (or by dropping it on the page).</p>
        <button type="button" className={button} disabled={!!busy} onClick={() => void shareFile()}>
          {busy === 'file' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          Share project file
        </button>
      </div>
    </Modal>
  );
};
