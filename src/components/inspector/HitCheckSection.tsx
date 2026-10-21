/**
 * "Does it hit?", the part of the Mix check panel that holds the loop (or the song) against a
 * style's targets measured from finished songs: pick a style, it renders the stretch and shows
 * each measurement as a meter against its target, with what to change when it's out (mixStudio.ts
 * runHitCheck, hitCheck.ts, hitTargets.ts).
 */
import React, { useMemo, useState } from 'react';
import { Gauge, Loader2 } from 'lucide-react';
import { runHitCheck, useMixStudio } from '../../audio/mixStudio';
import { HIT_STYLES, judgeHits, type HitJudgement, type HitStyleId } from '../../audio/hitTargets';
import { useTimelineStore } from '../../store/timelineStore';
import { audibleTracks } from '../../audio/exportWav';

const fmtBars = (a: number, b: number) => `bars ${Math.round(a * 100) / 100}-${Math.round((b - 1) * 100) / 100}`;

/** A meter: the scale, the target's stretch of it in green, the value as a mark. */
const Meter: React.FC<{ j: HitJudgement }> = ({ j }) => {
  const [a, b] = j.scale;
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100))}%`;
  const off = j.status === 'low' || j.status === 'high';
  return (
    <div className="relative h-2 rounded bg-black/40" aria-hidden>
      <div
        className="absolute inset-y-0 rounded bg-emerald-500/35"
        style={{
          left: at(j.target[0]),
          right: `calc(100% - ${at(j.target[1])})`,
        }}
      />
      {Number.isFinite(j.value) && <div className={`absolute -top-0.5 -bottom-0.5 w-1.5 -ml-[3px] rounded-sm ${off ? 'bg-amber-300' : 'bg-emerald-200'}`} style={{ left: at(j.value) }} />}
    </div>
  );
};

export const HitCheckSection: React.FC = () => {
  const hit = useMixStudio((s) => s.hit);
  const styleId = useMixStudio((s) => s.hitStyle);
  const busy = useMixStudio((s) => s.busy);
  const loop = useTimelineStore((s) => s.loopRegion);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const songEnd = useMemo(() => {
    const ids = new Set(audibleTracks(tracks).map((t) => t.id));
    return Math.max(2, ...clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
  }, [clips, tracks]);
  const [what, setWhat] = useState<'loop' | 'song' | null>(null);
  const range = what ?? (loop.enabled ? 'loop' : 'song');
  const [from, to] = range === 'loop' ? [loop.inBar, loop.outBar] : [1, songEnd];
  const judged = useMemo(() => (hit ? judgeHits(hit.report, styleId) : []), [hit, styleId]);
  const groups = useMemo(() => [...new Set(judged.map((j) => j.group))], [judged]);
  const off = judged.filter((j) => j.status === 'low' || j.status === 'high').length;
  const measuring = !!busy && /stretch|Measuring/.test(busy.what);

  return (
    <div data-search="does it hit drop loud punch gaps wobble sub pump style targets" className="flex flex-col gap-2 pt-2 mt-1 border-t border-forge-border">
      <div className="flex items-center gap-1.5">
        <Gauge className="w-3.5 h-3.5 text-amber-300" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Does it hit?</span>
      </div>
      <p className="text-[10px] text-forge-muted">
        Renders the loop or the song and holds it against finished songs of a style: the loudness, the balance and width, whether the sound holds up between the hits, whether the bass moves, the pump,
        and the drums.
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-[10px] text-forge-text">
        <span>Style</span>
        <select
          aria-label="Style to compare with"
          value={styleId}
          onChange={(e) => useMixStudio.setState({ hitStyle: e.target.value as HitStyleId })}
          className="min-w-0 h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px]"
        >
          {HIT_STYLES.map((s) => (
            <option key={s.id} value={s.id} title={s.blurb}>
              {s.name}
            </option>
          ))}
        </select>
        <span>Check</span>
        <select
          aria-label="What to check"
          value={range}
          onChange={(e) => setWhat(e.target.value as 'loop' | 'song')}
          className="min-w-0 h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px]"
        >
          <option value="loop">The loop ({fmtBars(loop.inBar, loop.outBar)})</option>
          <option value="song">The song (up to 64 bars)</option>
        </select>
      </div>
      <button
        type="button"
        data-testid="hit-check-run"
        disabled={!!busy}
        onClick={() => void runHitCheck(from, to)}
        className="py-1 rounded border border-amber-400/60 bg-amber-500/10 text-amber-100 text-[11px] font-mono font-bold hover:bg-amber-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {measuring && <Loader2 className="w-3 h-3 animate-spin" />}
        {measuring ? busy!.what : hit ? 'Check again' : 'Does it hit?'}
      </button>
      {hit && !measuring && (
        <div className="flex flex-col gap-2" data-testid="hit-check-results">
          <p className={`text-[10px] ${off ? 'text-amber-100' : 'text-emerald-300'}`}>
            {fmtBars(hit.bars[0], hit.bars[1])}:{' '}
            {off
              ? `${off} thing${off === 1 ? '' : 's'} away from ${HIT_STYLES.find((s) => s.id === styleId)?.name.toLowerCase()}.`
              : `everything in range for ${HIT_STYLES.find((s) => s.id === styleId)?.name.toLowerCase()}.`}
          </p>
          {groups.map((g) => (
            <div key={g} className="flex flex-col gap-1">
              <div className="text-[9px] font-mono uppercase tracking-wider text-forge-muted">{g}</div>
              {judged
                .filter((j) => j.group === g)
                .map((j) => (
                  <div key={j.id} className="flex flex-col gap-0.5" data-hit={j.id} data-status={j.status}>
                    <div className="flex items-baseline gap-1.5 text-[10px]">
                      <span className={`flex-1 min-w-0 truncate ${j.status === 'na' ? 'text-forge-muted' : 'text-forge-text'}`} title={`Target ${j.targetShown}`}>
                        {j.label}
                      </span>
                      <span className={`font-mono ${j.status === 'ok' ? 'text-emerald-300' : j.status === 'na' ? 'text-forge-muted' : 'text-amber-200'}`}>
                        {j.status === 'na' ? (j.group === 'Drums' ? 'no drum notes' : 'not measured') : j.shown}
                      </span>
                    </div>
                    {j.status !== 'na' && <Meter j={j} />}
                    {j.advice && <p className="text-[10px] text-forge-muted">{j.advice}</p>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
