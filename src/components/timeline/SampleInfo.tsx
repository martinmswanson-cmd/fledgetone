/**
 * A sample's tempo and key as heard (sampleAnalysis.ts), with how sure, and the one-click matches:
 * the song to the sample's tempo, or the sample (an audio clip) stretched to the song's tempo and
 * moved into its key. Also the small badge an audio clip shows once its sound has been heard.
 */
import React, { useState } from 'react';
import { Gauge, KeyRound } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { useSampleAnalysis, useSoundAnalysis } from '../../audio/sampleAnalysisStore';
import { shortKey } from '../../audio/sampleAnalysis';
import { matchSongTempo, setBassCut, shiftClip, shiftToSong, stretchClipToSong } from '../../store/flipActions';
import { BASS_CUT_HZ, hasBassCut } from '../../store/sampleFlip';
import { showToast } from './toastStore';

const pct = (c: number) => `${Math.round(c * 100)}%`;
/** Under this a guess is shown as a guess. */
const UNSURE = 0.45;
const button = 'h-6 px-1.5 rounded border border-forge-border text-[10px] font-mono text-forge-muted hover:text-forge-text hover:border-cyan-500 disabled:opacity-40 disabled:pointer-events-none';
const fmtShift = (st: number) => `${st > 0 ? '+' : ''}${Math.abs(st - Math.round(st)) < 0.005 ? Math.round(st) : st.toFixed(2)} st`;

/**
 * The tempo and key line for a sound (`soundId`: the original, before any key move), with buttons.
 * Given an audio clip, it also offers to stretch it to the song's tempo and move it into the song's key.
 */
export const SampleInfo: React.FC<{ soundId: string; clipId?: string; compact?: boolean }> = ({ soundId, clipId, compact }) => {
  const state = useSoundAnalysis(soundId);
  const songBpm = useTimelineStore((s) => s.bpm);
  const clip = useTimelineStore((s) => (clipId ? s.clips.find((c) => c.id === clipId) : undefined));
  const [busy, setBusy] = useState(false);
  if (!state || state === 'busy') return <span className="text-[10px] font-mono text-forge-muted">Listening for its tempo and key…</span>;
  if (state === 'failed') return <span className="text-[10px] font-mono text-forge-muted">Couldn't read this sound's tempo and key.</span>;
  const { tempo, key } = state;
  const audio = clip?.audio;
  const target = key ? shiftToSong(key.key, key.cents) : null;
  const shift = async (semitones: number) => {
    if (!clipId) return;
    setBusy(true);
    try {
      await shiftClip(clipId, semitones);
      showToast(Math.abs(semitones) < 0.01 ? 'Back to the sample as it was.' : `Moved ${fmtShift(semitones)}${target ? ` into ${target.key.name}` : ''}: same length and timing (Undo to go back).`);
    } catch (err) {
      showToast(`Couldn't move it: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-forge-muted ${compact ? '' : 'py-0.5'}`} role="group" aria-label="Sample tempo and key">
      <span className="flex items-center gap-1" title={tempo ? `Heard at ${tempo.bpm} BPM (or ${tempo.alternative}, counted the other way)${tempo.loop ? '; it lasts a whole number of bars at this tempo' : ''}. How sure: ${pct(tempo.confidence)}` : 'No steady beat heard'}>
        <Gauge className="w-3 h-3" />
        {tempo ? (
          <span className={tempo.confidence < UNSURE ? 'text-amber-300' : 'text-forge-text'}>
            {tempo.bpm} BPM <span className="text-forge-muted">{pct(tempo.confidence)}</span>
          </span>
        ) : (
          'no clear beat'
        )}
      </span>
      {tempo && (
        <>
          <button type="button" className={button} disabled={Math.abs(songBpm - tempo.bpm) < 0.01} onClick={() => (matchSongTempo(tempo.bpm), showToast(`Song tempo set to ${tempo.bpm} BPM, the sample's.`))} title="Set the song's tempo to the sample's">
            Song to {tempo.bpm}
          </button>
          <button type="button" className={button} disabled={Math.abs(songBpm - tempo.alternative) < 0.01} onClick={() => (matchSongTempo(tempo.alternative), showToast(`Song tempo set to ${tempo.alternative} BPM (the sample counted the other way).`))} title="Half or double: the same beat counted the other way">
            {tempo.alternative}
          </button>
          {audio && (
            <button type="button" className={button} disabled={audio.stretchBpm === tempo.bpm} onClick={() => stretchClipToSong(clipId!, tempo.bpm)} title={`Time-stretch the clip to the song's tempo (${songBpm} BPM), same pitch: it follows the tempo from here on`}>
              Stretch to song
            </button>
          )}
        </>
      )}
      <span className="mx-0.5 h-4 w-px bg-forge-border" />
      <span className="flex items-center gap-1" title={key ? `Heard in ${key.key.name} (next likeliest: ${key.runnerUp.name}); tuned ${key.cents >= 0 ? '+' : ''}${key.cents} cents from A440. How sure: ${pct(key.confidence)}` : 'No clear key heard'}>
        <KeyRound className="w-3 h-3" />
        {key ? (
          <span className={key.confidence < UNSURE ? 'text-amber-300' : 'text-forge-text'}>
            {shortKey(key.key)} <span className="text-forge-muted">{pct(key.confidence)}</span>
            {key.confidence < 0.75 && <span className="text-forge-muted"> (or {shortKey(key.runnerUp)})</span>}
          </span>
        ) : (
          'no clear key'
        )}
      </span>
      {key && audio && (
        <>
          {target && (
            <button type="button" className={button} disabled={busy || (Math.abs(target.semitones - (audio.shift ?? 0)) < 0.01)} onClick={() => void shift(target.semitones)} title={`Re-pitch the sample (same length) into the song's key, ${target.key.name}: ${fmtShift(target.semitones)}`}>
              {busy ? 'Moving…' : `Into ${shortKey(target.key)} (${fmtShift(target.semitones)})`}
            </button>
          )}
          {!target && <span title="Write some notes and the song's key is worked out from them">song has no key yet</span>}
          {audio.shiftedFrom && (
            <button type="button" className={button} disabled={busy} onClick={() => void shift(0)} title="Play the sample at its own pitch again">
              Original key ({fmtShift(audio.shift ?? 0)} now)
            </button>
          )}
        </>
      )}
    </div>
  );
};

/** "Filter out the bass" for a sample's track: a steep low cut on its Filter insert, to lay your own 808 under it. */
export const BassCutToggle: React.FC<{ trackId: string }> = ({ trackId }) => {
  const on = useTimelineStore((s) => {
    const fx = s.tracks.find((t) => t.id === trackId)?.fx;
    return fx ? hasBassCut(fx) : false;
  });
  return (
    <label className="flex items-center gap-1.5 text-[10px] font-mono text-forge-muted cursor-pointer" title={`Cut the sample's bass and kick under ${BASS_CUT_HZ} Hz (the track's Filter insert as a steep high-pass), so your own 808 has the low end to itself`}>
      <input type="checkbox" checked={on} onChange={(e) => setBassCut(trackId, e.target.checked)} aria-label="Filter out the bass" />
      FILTER OUT THE BASS <span className="text-forge-muted/70">(for your 808)</span>
    </label>
  );
};

/** The tempo and key on an audio clip, once its sound has been heard (a key move shown after it). */
export const SampleBadge: React.FC<{ soundId: string; shift?: number }> = ({ soundId, shift }) => {
  const state = useSampleAnalysis((s) => s.results[soundId]);
  if (!state || typeof state === 'string') return null;
  const parts = [state.tempo && state.tempo.confidence >= UNSURE ? `${Math.round(state.tempo.bpm)}` : null, state.key && state.key.confidence >= UNSURE ? shortKey(state.key.key) : null].filter(Boolean);
  if (!parts.length) return null;
  return (
    <span className="absolute left-1 bottom-0.5 text-[8px] font-mono text-white/75" title="The sample's tempo and key, as heard">
      {parts.join(' · ')}
      {shift ? ` ${shift > 0 ? '+' : ''}${Math.round(shift * 100) / 100}` : ''}
    </span>
  );
};
