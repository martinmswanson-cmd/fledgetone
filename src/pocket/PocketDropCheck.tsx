/**
 * Pocket's "Check the drop": the short version of the studio's "Does it hit?" (HitCheckSection.tsx).
 * It renders the selected section and says, in a few plain lines (tap one for what to do), whether there are gaps between
 * the hits, whether the bass moves, whether the sub is right and whether it's loud enough for the
 * style picked (mixStudio.ts runHitCheck, hitTargets.ts headlines).
 */
import React, { useMemo } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { runHitCheck, useMixStudio, cancelMixRender } from '../audio/mixStudio';
import { HIT_STYLES, headlines, type HitStyleId } from '../audio/hitTargets';
import { useSelection } from './pocketCell';
import { pill } from './pocketUi';

/** `fill`: share the drawer with something above it, scrolling when there isn't room (the mixer). */
export const PocketDropCheck: React.FC<{ fill?: boolean }> = ({ fill = false }) => {
  const { sec } = useSelection();
  const hit = useMixStudio((s) => s.hit);
  const styleId = useMixStudio((s) => s.hitStyle);
  const busy = useMixStudio((s) => s.busy);
  const error = useMixStudio((s) => s.error);
  const lines = useMemo(() => (hit ? headlines(hit.report, styleId) : null), [hit, styleId]);
  const fresh = hit && sec && hit.bars[0] === sec.from;
  return (
    <div className={`flex flex-col gap-2 pt-1 ${fill ? 'min-h-0 overflow-y-auto flex-initial' : 'shrink-0'}`} data-testid="pocket-drop-check">
      <div className="flex items-center gap-2">
        <button type="button" className={`${pill} flex-1`} disabled={!sec || !!busy} onClick={() => sec && void runHitCheck(sec.from, sec.to)}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Checking…' : `Check the drop${sec ? ` (${sec.letter})` : ''}`}
        </button>
        {busy ? (
          <button type="button" className={pill} onClick={cancelMixRender}>
            Stop
          </button>
        ) : (
          <select
            aria-label="Style"
            value={styleId}
            onChange={(e) => useMixStudio.setState({ hitStyle: e.target.value as HitStyleId })}
            className="h-11 min-w-0 max-w-[45%] rounded-xl border border-forge-border bg-forge-panel px-2 text-[13px]"
          >
            {HIT_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && !busy && <p className="text-[12px] text-red-300">The check failed: {error}</p>}
      {lines && !busy && (
        <ul className="flex flex-col gap-1.5 text-[13px]" aria-label="What the check found">
          {!fresh && <li className="text-[11px] text-forge-muted">(Of an earlier section: check again for this one.)</li>}
          {lines.map((l) => (
            <li key={l.id} data-ok={l.ok}>
              <details>
                <summary className="flex items-start gap-2 cursor-pointer list-none min-h-7">
                  {l.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" /> : <X className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />}
                  <span className={l.ok ? 'text-forge-text' : 'text-amber-100 underline decoration-dotted underline-offset-4'}>{l.title}</span>
                </summary>
                <p className="ml-6 text-[12px] text-forge-muted">{l.text}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
