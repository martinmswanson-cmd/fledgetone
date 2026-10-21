/**
 * The Mix check panel (Master tab): renders the song and each track, then lists what could be
 * better in plain words, with buttons that select the track to look at (mixStudio.ts, mixCheck.ts).
 * Under it, "Does it hit?" holds the loop or the song against a style (HitCheckSection.tsx).
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Stethoscope } from 'lucide-react';
import { cancelMixRender, runMixCheck, useMixStudio, ANALYSE_SECONDS } from '../../audio/mixStudio';
import { LOUDNESS_TARGETS } from '../../audio/loudnessTarget';
import { useTimelineStore } from '../../store/timelineStore';
import { formatDbtp, formatLufs } from '../../audio/loudness';
import { HitCheckSection } from './HitCheckSection';

export const MixCheckPanel: React.FC = () => {
  const findings = useMixStudio((s) => s.findings);
  const analysis = useMixStudio((s) => s.analysis);
  const busy = useMixStudio((s) => s.busy);
  const error = useMixStudio((s) => s.error);
  const targetId = useMixStudio((s) => s.targetId);
  const tracks = useTimelineStore((s) => s.tracks);
  const nameOf = (id: string) => tracks.find((t) => t.id === id)?.name;

  return (
    <div data-search="mix check problems muddy harsh masking" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center gap-1.5">
        <Stethoscope className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Mix check</span>
      </div>
      <p className="text-[10px] text-forge-muted">
        Renders the song (up to {ANALYSE_SECONDS / 60} minutes) and each track, then points out what to fix: bass that isn't in the middle, the kick and bass fighting, muddy or harsh
        spots, parts covering each other, the level and the master working too hard.
      </p>
      <label className="flex items-center gap-2 text-[10px] text-forge-text">
        Going to
        <select
          value={targetId}
          onChange={(e) => useMixStudio.setState({ targetId: e.target.value })}
          className="flex-1 min-w-0 h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px]"
        >
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {busy ? (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 rounded bg-black/40 overflow-hidden" role="progressbar" aria-valuenow={Math.round(busy.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-amber-400" style={{ width: `${busy.progress * 100}%` }} />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-forge-muted">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span className="flex-1 truncate">{busy.what}</span>
            <button type="button" onClick={cancelMixRender} className="px-1.5 rounded border border-forge-border hover:text-white">
              Stop
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="mix-check-run"
          onClick={() => void runMixCheck(targetId)}
          className="py-1 rounded border border-amber-400/60 bg-amber-500/10 text-amber-100 text-[11px] font-mono font-bold hover:bg-amber-500/20"
        >
          {findings ? 'Check again' : 'Check the mix'}
        </button>
      )}
      {error && <p className="text-[10px] text-red-300">The check failed: {error}</p>}
      {findings && !busy && (
        <div className="flex flex-col gap-1.5" data-testid="mix-check-findings">
          {analysis && (
            <p className="text-[10px] font-mono text-forge-muted">
              {formatLufs(analysis.lufs)}, peak {formatDbtp(analysis.truePeakDb)}
            </p>
          )}
          {findings.length === 0 ? (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
              Nothing to flag: the balance, the low end and the level all look healthy.
            </p>
          ) : (
            findings.map((f, i) => (
              <div key={i} className={`rounded border p-1.5 ${f.level === 'problem' ? 'border-red-400/50 bg-red-500/5' : 'border-amber-400/40 bg-amber-500/5'}`}>
                <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${f.level === 'problem' ? 'text-red-200' : 'text-amber-100'}`}>
                  {f.level === 'problem' ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Info className="w-3.5 h-3.5 shrink-0" />}
                  {f.title}
                </div>
                <p className="text-[10px] text-forge-muted mt-0.5">{f.detail}</p>
                {f.trackIds.some(nameOf) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {f.trackIds.filter(nameOf).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => useTimelineStore.getState().selectTrack(id)}
                        className="px-1.5 py-0.5 rounded border border-forge-border text-[10px] text-forge-text hover:border-amber-400/70"
                        title="Select this track"
                      >
                        {nameOf(id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <HitCheckSection />
    </div>
  );
};
