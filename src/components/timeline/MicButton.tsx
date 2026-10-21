/**
 * The microphone record button: records the audio input onto an Audio track from the playhead,
 * with punch in / out and loop takes. Bluetooth headphones (a slow output) are warned about as a
 * take starts; a take going when the phone app goes to the background is stopped and kept.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { songTempo, useTimelineStore } from '../../store/timelineStore';
import { recordedPieces } from '../../store/takes';
import { secondsBetween, secondsToBar, barToSeconds } from '../../audio/tempoMap';
import { isAudioKind } from '../../audio/instrumentCatalog';
import { holdTake, startMic } from '../../audio/micRecorder';
import { likelyBluetooth } from '../../audio/lineUp';
import { outputLatencySeconds } from '../../audio/latency';
import { isNativeApp } from '../../native/nativeApp';
import { transportStartsAt } from '../../audio/transport';
import type { MicSession } from '../../audio/micRecorder';
import { encodeChannels } from '../../audio/exportWav';
import { importSoundFile, SoundError } from '../../audio/soundLibrary';
import { showToast } from './toastStore';

let takeCount = 0;

/**
 * Record from the microphone (or the computer's audio input) onto an Audio track: click to start
 * (playback starts with it, from the playhead), click again to stop. The take lands where it was
 * played, on the selected Audio track or a new one. Punch in/out keeps only the punch range; with
 * takes on, each loop pass is a take (one recording, each take a stretch of it).
 */
export const MicButton: React.FC = () => {
  const [session, setSession] = useState<MicSession | null>(null);
  const [busy, setBusy] = useState(false);
  const meter = useRef<HTMLSpanElement>(null);
  /** When and where playback started with the recording (null: it was already playing) */
  const playStart = useRef<{ at: number; bar: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    let raf = 0;
    const tick = () => {
      if (meter.current) meter.current.style.transform = `scaleY(${Math.min(1, session.level() * 1.4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const start = async () => {
    try {
      const s = await startMic();
      setSession(s);
      if (likelyBluetooth(outputLatencySeconds(), s.inputLabel)) showToast('Bluetooth adds delay; use wired headphones to record.');
      const st = useTimelineStore.getState();
      if (!st.isPlaying) {
        const bar = st.playheadPosition;
        await st.play();
        // Where and when the music starts: what's caught before then (the mic opens first) is cut,
        // and the take starts at that bar (the Transport reads bar 1 before it has started)
        const at = transportStartsAt();
        playStart.current = at === null ? null : { at, bar };
      } else playStart.current = null;
    } catch (err) {
      const app = "Fledgetone isn't allowed to use the microphone (allow it in the phone's Settings, Apps, Fledgetone, Permissions)";
      const msg = err instanceof DOMException && err.name === 'NotAllowedError' ? (isNativeApp() ? app : 'the browser was not allowed to use the microphone') : err instanceof Error ? err.message : String(err);
      showToast(`Couldn't start recording: ${msg}`);
    }
  };

  const stop = async () => {
    if (!session) return;
    let take = await session.stop();
    const begun = playStart.current;
    if (take && begun && take.heardAt < begun.at) {
      const lead = Math.round((begun.at - take.heardAt) * take.sampleRate);
      take = lead >= take.channels[0].length ? null : { ...take, channels: take.channels.map((c) => c.slice(lead)), startBar: begun.bar, heardAt: begun.at };
    }
    setSession(null);
    const st = useTimelineStore.getState();
    if (st.isPlaying) st.pause();
    if (!take) return;
    setBusy(true);
    try {
      const name = `Mic take ${++takeCount}`;
      const wav = encodeChannels(take.channels, take.sampleRate, 24);
      const sound = await importSoundFile(new Blob([wav], { type: 'audio/wav' }), `${name}.wav`);
      const s = useTimelineStore.getState();
      const selected = s.tracks.find((t) => t.id === s.selectedTrackId);
      const target = selected && isAudioKind(selected.instrumentKey) ? selected.id : null;
      const seconds = take.channels[0].length / take.sampleRate;
      const startBar = Math.max(1, take.startBar);
      const punch = s.punch.enabled ? s.punch : null;
      // Straight onto the track, unless it went round the loop (keep a pass), is punched, or makes takes
      const looped = s.loopRegion.enabled && startBar < s.loopRegion.outBar && secondsToBar(barToSeconds(startBar, songTempo(s)) + seconds, songTempo(s)) > s.loopRegion.outBar;
      if (!punch && !s.recordOptions.takes && !looped) {
        const message = s.addAudioClips(target, startBar, [sound]);
        showToast(message ?? `Recorded ${name} (${seconds.toFixed(1)} s)`);
        return;
      }
      const tempo = songTempo(s);
      const pieces = recordedPieces(
        startBar,
        seconds,
        s.loopRegion.enabled ? s.loopRegion : null,
        punch,
        s.recordOptions.takes,
        (a, b) => secondsBetween(a, b, tempo),
        (bar, sec) => secondsToBar(barToSeconds(bar, tempo) + sec, tempo)
      );
      if (!pieces.length) {
        showToast('Nothing was recorded inside the punch range');
        return;
      }
      const audio = (from: number) => ({ soundId: sound.id, offset: from, gain: 0, fadeIn: 0, fadeOut: 0 });
      s.addAudioTakes(target, pieces[0].startBar, pieces[0].lengthBars, pieces.map((p, i) => ({ audio: audio(p.from), name: pieces.length > 1 ? `Pass ${i + 1}` : undefined })), name);
      showToast(pieces.length > 1 ? `Recorded ${name}: ${pieces.length} takes (right-click the clip, Takes, to comp them)` : `Recorded ${name}${punch ? ' (punched in)' : ''}`);
    } catch (err) {
      showToast(err instanceof SoundError ? err.message : `Couldn't keep the recording: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // The phone app going to the background stops and keeps the take (stop reads the session it was rendered with)
  useEffect(() => (session ? holdTake(() => stop()) : undefined), [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const recording = !!session;
  return (
    <button
      type="button"
      onClick={() => void (recording ? stop() : start())}
      disabled={busy}
      title={recording ? 'Stop recording (the take goes on the selected Audio track, or a new one)' : 'Record from the microphone: playback starts from the playhead, click again to stop'}
      className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-[11px] font-bold transition ${recording ? 'border-red-400 bg-red-500/20 text-red-100' : 'border-forge-border text-forge-muted hover:text-forge-text'} disabled:opacity-50`}
      aria-pressed={recording}
    >
      {recording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
      {recording ? 'Stop' : 'Mic'}
      {recording && (
        <span className="relative w-1.5 h-4 rounded-sm bg-black/50 overflow-hidden" aria-hidden>
          <span ref={meter} className="absolute inset-0 origin-bottom bg-emerald-400" style={{ transform: 'scaleY(0)' }} />
        </span>
      )}
    </button>
  );
};
