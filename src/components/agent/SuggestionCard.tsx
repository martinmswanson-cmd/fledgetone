/**
 * One suggestion on the Suggestions panel: the agent's title and why (as plain text), what it
 * changes in plain words, its cautions in amber and its notes plain, a before-and-after to hear
 * (Now / Suggested, the same bars looped, switched in step), and Accept (one undo step) or Dismiss.
 * Accept and Dismiss answer only to a real click or key press. A suggestion the song changed
 * under says so: heard again, or out of date (it can't be accepted).
 */
import React from 'react';
import { Check, Headphones, Square, X } from 'lucide-react';
import { useAudition, startAudition, stopAudition, hearAudition } from '../../audio/auditionPlayer';
import { acceptSuggestion, dismissSuggestion } from '../../agent/accept';
import { listenSnapshot } from '../../agent/handlers';
import { currentProject, useTimelineStore } from '../../store/timelineStore';
import { isOpen, useSuggestions, type Suggestion } from '../../agent/suggestionsStore';

const STATUS: Record<Suggestion['status'], string> = {
  waiting: 'Waiting for you',
  changed: 'The song changed since: listen again before you accept',
  out_of_date: 'Out of date',
  accepted: 'Accepted (Undo takes it out)',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn by the agent',
};

const bars = (r: { fromBar: number; toBar: number }) => {
  const a = Math.floor(r.fromBar);
  const b = Math.max(a, Math.ceil(r.toBar) - 1);
  return a === b ? `bar ${a}` : `bars ${a}-${b}`;
};

export const SuggestionCard: React.FC<{ suggestion: Suggestion }> = ({ suggestion: s }) => {
  const audition = useAudition();
  const mine = audition.key === s.id;
  // The last press's answer, kept only until the suggestion's status or revision moves on
  const [said, setSaid] = React.useState<{ text: string | null; at: string } | null>(null);
  const here = `${s.status}:${s.revision}`;
  const message = said && said.at === here ? said.text : null;
  const setMessage = (text: string | null) => setSaid({ text, at: here });
  const open = isOpen(s);
  const range = s.focus ?? s.audition;

  const hear = (which: 'a' | 'b') => {
    if (mine && audition.phase === 'playing') return hearAudition(which);
    // The song's own playback stops first: the two can't play at once
    useTimelineStore.getState().pause();
    void startAudition({ key: s.id, now: listenSnapshot(currentProject()), suggested: listenSnapshot(s.song), fromBar: range.fromBar, toBar: range.toBar, hearing: which });
  };

  const focus = () => useSuggestions.setState({ focusId: s.id });
  const unfocus = () => useSuggestions.getState().focusId === s.id && useSuggestions.setState({ focusId: null });

  return (
    <article
      aria-label={`Suggestion: ${s.title}`}
      data-suggestion={s.id}
      onMouseEnter={focus}
      onMouseLeave={unfocus}
      onFocus={focus}
      className={`rounded-lg border p-3 flex flex-col gap-2 ${open ? 'border-forge-border bg-forge-bg/60' : 'border-forge-border/50 bg-forge-bg/30 opacity-80'}`}
    >
      <header className="flex items-start gap-2">
        <h3 className="flex-1 text-[13px] font-semibold text-forge-text break-words">{s.title}</h3>
        <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wider ${s.status === 'out_of_date' ? 'text-amber-300' : 'text-forge-muted'}`}>{s.status.replace(/_/g, ' ')}</span>
      </header>
      {s.explanation && <p className="text-[12px] text-forge-muted whitespace-pre-wrap break-words">{s.explanation}</p>}

      <div>
        <h4 className="text-[10px] font-mono uppercase tracking-wider text-forge-muted">What changes{s.bars ? ` (${bars(s.bars)})` : ''}</h4>
        <ul className="mt-1 list-disc pl-4 text-[12px] text-forge-text space-y-0.5">
          {s.changes.map((c, i) => (
            <li key={i} className="break-words">
              {c}
            </li>
          ))}
        </ul>
      </div>
      {s.warnings.length > 0 && (
        <ul aria-label="Cautions" className="text-[12px] text-amber-300 space-y-0.5">
          {s.warnings.map((w, i) => (
            <li key={i} className="break-words">
              {w}
            </li>
          ))}
        </ul>
      )}
      {s.notes.length > 0 && (
        <ul aria-label="Notes" className="text-[12px] text-forge-muted space-y-0.5">
          {s.notes.map((n, i) => (
            <li key={i} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      )}
      {s.status === 'out_of_date' && s.outOfDate && <p className="text-[12px] text-amber-300">It can’t be accepted: {s.outOfDate.join('; ')}.</p>}

      {open && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Hear ${bars(range)} before and after`}>
          <Headphones className="w-3.5 h-3.5 text-forge-muted" aria-hidden />
          {(['a', 'b'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => hear(k)}
              aria-pressed={mine && audition.phase === 'playing' && audition.hearing === k}
              data-hear={k === 'a' ? 'now' : 'suggested'}
              className={`h-7 px-2.5 rounded-md border text-[12px] ${mine && audition.phase === 'playing' && audition.hearing === k ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-forge-border text-forge-text hover:border-cyan-500/60'}`}
            >
              {k === 'a' ? 'Now' : 'Suggested'}
            </button>
          ))}
          {mine && audition.phase !== 'idle' && (
            <button type="button" onClick={stopAudition} className="h-7 px-2 rounded-md border border-forge-border text-forge-text" aria-label="Stop hearing">
              <Square className="w-3 h-3" />
            </button>
          )}
          <span className="text-[11px] text-forge-muted">{bars(range)}</span>
          {mine && audition.phase === 'rendering' && (
            <span className="w-full h-1 rounded bg-forge-border overflow-hidden" role="progressbar" aria-label="Rendering the before and after" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(audition.progress * 100)}>
              <span className="block h-full bg-cyan-500" style={{ width: `${Math.round(audition.progress * 100)}%` }} />
            </span>
          )}
          {mine && audition.phase === 'playing' && audition.levelDiff !== null && (
            <span className="w-full text-[11px] text-forge-muted">
              Suggested is {Math.abs(audition.levelDiff) < 0.1 ? 'as loud as now' : `${Math.abs(audition.levelDiff).toFixed(1)} LU ${audition.levelDiff > 0 ? 'louder' : 'quieter'}`}.
            </span>
          )}
          {mine && audition.note && <span className="w-full text-[11px] text-amber-300">{audition.note}</span>}
          {mine && audition.error && <span className="w-full text-[11px] text-amber-300">Couldn’t render it: {audition.error}</span>}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {(open || s.status === 'out_of_date') && (
          <>
            <button
              type="button"
              disabled={!open}
              onClick={(e) => setMessage(acceptSuggestion(s.id, e.nativeEvent))}
              data-accept={s.id}
              className="h-8 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" aria-hidden /> Accept
            </button>
            <button
              type="button"
              onClick={(e) => dismissSuggestion(s.id, e.nativeEvent)}
              data-dismiss={s.id}
              className="h-8 px-3 rounded-md border border-forge-border text-[12px] text-forge-text hover:border-red-400/60 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" aria-hidden /> Dismiss
            </button>
          </>
        )}
        <span role="status" aria-live="polite" className={`text-[11px] ${s.status === 'changed' ? 'text-amber-300' : 'text-forge-muted'}`}>
          {message ?? STATUS[s.status]}
        </span>
      </footer>
    </article>
  );
};
