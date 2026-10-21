/**
 * Pocket's Vocals screen: sing over the song. One big button records from the phone's microphone
 * while the song plays (from the loop's start when the loop is on, stopping by itself at its end;
 * else from the playhead until tapped again), and the take lands on a vocal track where it was
 * sung. Each vocal track wears one of the vocal chains (clean lead, aggressive, ad-lib...); each
 * take can be doubled, hard-tuned (the studio's Tune dialog), put on a pad (whole, or chopped at
 * its hits onto a new Drum Rack's pads) or deleted. In the drawer it's the
 * selected vocal track's (`trackId`), and the transport's Rec starts and stops it (singRequest).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Grid2x2, Loader2, Mic, Plus, Square, Trash2, AudioLines } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { isAudioKind } from '../audio/instrumentCatalog';
import { startMic, type MicSession } from '../audio/micRecorder';
import { transportStartsAt, getAudiblePositionBar } from '../audio/transport';
import { encodeChannels } from '../audio/exportWav';
import { importSoundFile, SoundError } from '../audio/soundLibrary';
import { VOCAL_CHAINS, matchingVocalChain, type VocalChainId } from '../store/vocalChains';
import { applyVocalChain, doubleClip } from '../store/vocalActions';
import { showToast } from '../components/timeline/toastStore';
import { TuneDialog } from '../components/timeline/TuneDialog';
import { Card, pill, pillOn } from './pocketUi';
import { usePocket } from './pocketStore';
import { chopClipToPads, clipToPad, placedMessage } from '../store/bounceToPadActions';

let takeCount = 0;

/** A new vocal track with the clean lead chain on. Returns its id. */
export function addVocalTrack(): string {
  const s = useTimelineStore.getState();
  const count = s.tracks.filter((t) => /^Vocals\b/.test(t.name)).length;
  const id = s.addTrack('audio', count ? `Vocals ${count + 1}` : 'Vocals');
  applyVocalChain(id, 'clean');
  // (addTrack and the chain are one undo step)
  useTimelineStore.setState((st) => ({ past: st.past.slice(0, -1) }));
  return id;
}

export const PocketVocals: React.FC<{ trackId?: string }> = ({ trackId: fixed }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const loop = useTimelineStore((s) => s.loopRegion);
  const vocalTracks = tracks.filter((t) => isAudioKind(t.instrumentKey));
  const [trackId, setTrackId] = useState<string | null>(null);
  const track = vocalTracks.find((t) => t.id === (fixed ?? trackId)) ?? (fixed ? null : vocalTracks[0]) ?? null;
  const singRequest = usePocket((p) => p.singRequest);
  const seenRequest = useRef(singRequest);
  const [session, setSession] = useState<MicSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [tuning, setTuning] = useState<string | null>(null);
  /** The take whose "to a pad" choices are open */
  const [padding, setPadding] = useState<string | null>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const playStart = useRef<{ at: number; bar: number } | null>(null);
  const stopping = useRef(false);

  const stop = async (sess: MicSession) => {
    if (stopping.current) return;
    stopping.current = true;
    let take = await sess.stop();
    const begun = playStart.current;
    // What the mic caught before the music started is cut, and the take starts on its bar
    if (take && begun && take.heardAt < begun.at) {
      const lead = Math.round((begun.at - take.heardAt) * take.sampleRate);
      take = lead >= take.channels[0].length ? null : { ...take, channels: take.channels.map((c) => c.slice(lead)), startBar: begun.bar, heardAt: begun.at };
    }
    setSession(null);
    const st = useTimelineStore.getState();
    if (st.isPlaying) st.pause();
    stopping.current = false;
    if (!take) return;
    setBusy(true);
    try {
      const name = `Vocal take ${++takeCount}`;
      const wav = encodeChannels(take.channels, take.sampleRate, 24);
      const sound = await importSoundFile(new Blob([wav], { type: 'audio/wav' }), `${name}.wav`);
      const target = useTimelineStore.getState().tracks.some((t) => t.id === track?.id) ? track!.id : addVocalTrack();
      const message = useTimelineStore.getState().addAudioClips(target, Math.max(1, take.startBar), [sound]);
      showToast(message ?? `Recorded ${name} (${(take.channels[0].length / take.sampleRate).toFixed(1)} s)`);
    } catch (err) {
      showToast(err instanceof SoundError ? err.message : `Couldn't keep the recording: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // While recording: the level meter, and (with the loop on) stopping at the loop's end
  useEffect(() => {
    if (!session) return;
    let raf = 0;
    const loopEnd = useTimelineStore.getState().loopRegion;
    const tick = () => {
      if (meter.current) meter.current.style.transform = `scaleX(${Math.min(1, session.level() * 1.4)})`;
      if (loopEnd.enabled && useTimelineStore.getState().isPlaying && getAudiblePositionBar() >= loopEnd.outBar - 0.01) {
        void stop(session);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const start = async () => {
    try {
      const sess = await startMic();
      const st = useTimelineStore.getState();
      if (st.isPlaying) st.pause();
      // From the loop's start when it's on (once through), else from the playhead
      const from = st.loopRegion.enabled ? st.loopRegion.inBar : st.playheadPosition;
      st.seek(from);
      await useTimelineStore.getState().play();
      const at = transportStartsAt();
      playStart.current = at === null ? null : { at, bar: from };
      setSession(sess);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError' ? 'the microphone was not allowed' : err instanceof Error ? err.message : String(err);
      showToast(`Couldn't start recording: ${msg}`);
    }
  };

  // The transport's Rec on a vocal track: start, or stop the take going
  useEffect(() => {
    if (singRequest === seenRequest.current) return;
    seenRequest.current = singRequest;
    if (busy) return;
    void (session ? stop(session) : start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singRequest]);

  const takes = clips.filter((c) => c.audio && (fixed ? c.trackId === fixed : vocalTracks.some((t) => t.id === c.trackId))).sort((a, b) => a.startBar - b.startBar);
  const chain = track ? matchingVocalChain(track) : null;

  return (
    <>
      <Card title="Record">
        <button
          type="button"
          disabled={busy}
          onClick={() => void (session ? stop(session) : start())}
          className={`w-full h-20 rounded-2xl border text-lg font-semibold flex items-center justify-center gap-3 ${session ? 'border-red-400 bg-red-500/25 text-red-100' : 'border-forge-border bg-forge-panel'}`}
        >
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : session ? <Square className="w-6 h-6 fill-current" /> : <Mic className="w-7 h-7 text-red-400" />}
          {busy ? 'Keeping the take' : session ? 'Stop' : 'Record'}
        </button>
        {session && (
          <div className="mt-2 h-2 rounded bg-black/50 overflow-hidden">
            <span ref={meter} className="block h-full origin-left bg-emerald-400" style={{ transform: 'scaleX(0)' }} />
          </div>
        )}
        <p className="text-[11px] text-forge-muted mt-2">
          {loop.enabled ? `Records the loop once (bars ${loop.inBar} to ${loop.outBar}), then stops.` : 'Records from the playhead until you tap Stop.'} Wear headphones, or the
          microphone records the song too.
        </p>
      </Card>
      <Card
        title={fixed ? 'Voice' : 'Vocal track'}
        right={
          fixed ? undefined : (
            <button type="button" className={`${pill} !h-9`} onClick={() => setTrackId(addVocalTrack())}>
              <Plus className="w-4 h-4" /> Track
            </button>
          )
        }
      >
        {!fixed && vocalTracks.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {vocalTracks.map((t) => (
              <button key={t.id} type="button" className={`${pill} shrink-0 ${t.id === track?.id ? pillOn : ''}`} onClick={() => setTrackId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        )}
        {track ? (
          <div className="grid grid-cols-2 gap-2">
            {VOCAL_CHAINS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rounded-xl border border-forge-border p-2 text-left ${chain === c.id ? pillOn : 'bg-forge-panel'}`}
                onClick={() => applyVocalChain(track.id, c.id as VocalChainId)}
              >
                <span className="block text-sm">{c.name}</span>
                <span className="block text-[11px] text-forge-muted line-clamp-2">{c.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-forge-muted">The first take makes a vocal track, with the Clean lead sound on.</p>
        )}
      </Card>
      {takes.length > 0 && (
        <Card title="Takes">
          <div className="space-y-2">
            {takes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-0 text-sm truncate">
                  {c.name} <span className="text-[11px] text-forge-muted">bar {Math.round(c.startBar * 10) / 10}</span>
                </span>
                <button type="button" aria-label={`Double ${c.name}`} className={`${pill} !h-10 !px-3`} onClick={() => void doubleClip(c.id).then(showToast)}>
                  <Copy className="w-4 h-4" />
                </button>
                <button type="button" aria-label={`Tune ${c.name}`} className={`${pill} !h-10 !px-3`} onClick={() => setTuning(c.id)}>
                  <AudioLines className="w-4 h-4" />
                </button>
                <button type="button" aria-label={`${c.name} to a pad`} aria-expanded={padding === c.id} className={`${pill} !h-10 !px-3 ${padding === c.id ? pillOn : ''}`} onClick={() => setPadding(padding === c.id ? null : c.id)}>
                  <Grid2x2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${c.name}`}
                  className={`${pill} !h-10 !px-3`}
                  onClick={() => {
                    const s = useTimelineStore.getState();
                    s.selectClip(c.id, false);
                    s.deleteSelectedClips();
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                {padding === c.id && (
                  <div className="basis-full flex gap-2">
                    <button
                      type="button"
                      className={`${pill} flex-1 !h-10 !px-2 text-xs`}
                      onClick={() => {
                        setPadding(null);
                        const placed = clipToPad(c.id, undefined, 'Your pads');
                        showToast(placed ? placedMessage(`"${c.name}"`, placed) : `${c.name}'s sound isn't loaded yet`);
                      }}
                    >
                      Whole take on a pad
                    </button>
                    <button
                      type="button"
                      className={`${pill} flex-1 !h-10 !px-2 text-xs`}
                      onClick={() => {
                        setPadding(null);
                        void chopClipToPads(c.id).then(
                          (r) => showToast(r ? `${r.chops} chops of "${c.name}" on the pads of a new track, ${c.name} chops: play them from its pads` : `Couldn't find hits in ${c.name}`),
                          (err) => showToast(`Couldn't chop ${c.name}: ${err instanceof Error ? err.message : String(err)}`)
                        );
                      }}
                    >
                      Chop onto pads
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-forge-muted mt-2">
            Double: a second and third performance either side, for a thicker vocal. Tune: pitch correction to the song's key, from gentle to robotic. Pad: the take on a pad of your
            pads (as recorded, without the vocal sound), or chopped at its words and hits onto a new set of pads.
          </p>
        </Card>
      )}
      {tuning && <TuneDialog clipId={tuning} onClose={() => setTuning(null)} />}
    </>
  );
};
