import { liveContext } from '../audio/liveContext';
import { chosenPlaybackMode } from '../audio/playbackMode';
import { usePerfStore } from '../audio/perfMonitor';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';

/**
 * Reporting a problem to Two Birds Workshop: the address it goes to, and the technical details a
 * report can carry (browser, audio, the size of the song, recent errors). The song itself is never
 * included; the person can attach a saved project file if they want to.
 */

export const CONTACT_EMAIL = 'martin@twobirdsworkshop.com';
/** The site's contact form, opened as a problem report about Fledgetone. */
export const CONTACT_PAGE = `https://twobirdsworkshop.com/contact?broken=${encodeURIComponent("Fledgetone")}`;

const MAX_ERRORS = 5;
const errors: string[] = [];

const remember = (text: string) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${text.replace(/\s+/g, ' ').slice(0, 160)}`;
  if (errors[errors.length - 1] === line) return;
  errors.push(line);
  if (errors.length > MAX_ERRORS) errors.shift();
};

/** Keep the last few uncaught errors, for a report. Call once at startup. */
export function startErrorLog(): void {
  window.addEventListener('error', (e) => remember(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    remember(r instanceof Error ? `${r.name}: ${r.message}` : String(r));
  });
}

/** The technical details a report carries, one per line. */
export function technicalDetails(): string {
  const s = useTimelineStore.getState();
  const perf = usePerfStore.getState();
  const instruments = [...new Set(s.tracks.map((t) => INSTRUMENTS[t.instrumentKey]?.name ?? t.instrumentKey))];
  const notes = s.clips.reduce((n, c) => n + c.notes.length, 0);
  const lines = [
    `Page: ${location.origin}${location.pathname}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x`,
    `Audio: ${useAudioStore.getState().audioState}, ${liveContext.sampleRate} Hz, ${chosenPlaybackMode()} playback`,
    `Song: ${s.tracks.length} tracks, ${s.clips.length} clips, ${notes} notes, ${s.bpm} BPM`,
    `Instruments: ${instruments.join(', ') || 'none'}`,
    `Performance: ${perf.lagging ? 'lagging' : 'keeping up'}${perf.memoryMB !== null ? `, ${perf.memoryMB} MB in use` : ''}`,
    `Recent errors: ${errors.length ? '' : 'none'}`,
    ...errors.map((e) => `  ${e}`),
  ];
  return lines.join('\n');
}

export interface ProblemReport {
  what: string;
  email: string;
  details: string | null;
}

export function reportText({ what, email, details }: ProblemReport): string {
  const parts = [what.trim()];
  if (email.trim()) parts.push(`Reply to: ${email.trim()}`);
  if (details) parts.push(`---\n${details}`);
  return parts.join('\n\n');
}

/** Mail programs cut long links: keep the message well under that. */
const MAILTO_MAX = 1800;

export function mailtoLink(report: ProblemReport): string {
  let body = reportText(report);
  if (body.length > MAILTO_MAX) body = `${body.slice(0, MAILTO_MAX)}\n[cut short]`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Fledgetone problem report")}&body=${encodeURIComponent(body)}`;
}
