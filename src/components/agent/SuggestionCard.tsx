/**
 * One suggestion on the Suggestions panel: marked as from the agent, with its title and why quoted
 * (plain text), what it changes in plain words, its cautions in amber and its notes plain, a
 * before-and-after to hear (Now / Suggested, the same bars looped, switched in step), and Accept
 * (one undo step) or Dismiss. Accept and Dismiss answer only to a real click or key press on a card
 * that stayed where it was (cardGuard.ts). It says whether it was heard; one the song changed under
 * is made again when it's heard, and goes in unheard only after a second press of Accept; one out
 * of date or made for another song can't be accepted. Stop is there whenever it's being heard.
 */
import React from 'react';
import { Check, Headphones, Square, X } from 'lucide-react';
import { useAudition, stopAudition, hearAudition } from '../../audio/auditionPlayer';
import { acceptSuggestion, dismissSuggestion } from '../../agent/accept';
import { hearSuggestion } from '../../agent/songWatch';
import { isOpen, useSuggestions, type Suggestion } from '../../agent/suggestionsStore';
import { guardClick, guardDown } from './cardGuard';
import { fromYourAgent, louderWords, STATUS_WORDS } from './words';

const bars = (r: { fromBar: number; toBar: number }) => {
  const a = Math.floor(r.fromBar);
  const b = Math.max(a, Math.ceil(r.toBar) - 1);
  return a === b ? `bar ${a}` : `bars ${a}-${b}`;
};

/** The line under the buttons: where it is, and whether what Accept puts in was heard. */
function statusLine(s: Suggestion): string {
  if (s.status === 'changed') return s.heard === s.version && !s.stale ? 'The song changed since it was suggested. You heard it as it is now.' : 'The song changed since it was suggested: hear it again before you accept.';
  if (s.status === 'waiting') return s.heard === null ? 'Not heard yet.' : 'Heard.';
  const words = STATUS_WORDS[s.status];
  return words[0].toUpperCase() + words.slice(1) + '.';
}

export const SuggestionCard: React.FC<{ suggestion: Suggestion; agent?: string }> = ({ suggestion: s, agent }) => {
  const audition = useAudition();
  const mine = audition.key === s.id;
  // The last press's answer, kept only until the suggestion's status or version moves on
  const [said, setSaid] = React.useState<{ text: string; at: string } | null>(null);
  const here = `${s.status}:${s.version}`;
  const message = said && said.at === here ? said.text : null;
  // An answer to a press: shown on the card, and said for screen readers (one live region for the panel)
  const say = (text: string | null) => {
    // (kept for the suggestion as the press left it: Accept may have made it again)
    const after = useSuggestions.getState().suggestions.find((x) => x.id === s.id);
    setSaid(text ? { text, at: after ? `${after.status}:${after.version}` : here } : null);
    useSuggestions.setState({ announcement: text ?? `“${s.title}” accepted.` });
  };
  const open = isOpen(s);
  const range = s.focus ?? s.audition;
  const playing = mine && audition.phase === 'playing';

  const hear = (which: 'a' | 'b') => {
    if (playing) return hearAudition(which);
    void hearSuggestion(s.id, which);
  };

  const focus = () => useSuggestions.setState({ focusId: s.id });
  const unfocus = () => useSuggestions.getState().focusId === s.id && useSuggestions.setState({ focusId: null });
  const unsettled = 'That card just appeared or moved: press again if you meant it.';

  return (
    <article
      aria-label={`Suggestion from your agent: ${s.title}`}
      data-suggestion={s.id}
      onMouseEnter={focus}
      onMouseLeave={unfocus}
      onFocus={focus}
      className={`rounded-lg border p-3 flex flex-col gap-2 ${open ? 'border-forge-border bg-forge-bg/60' : 'border-forge-border/50 bg-forge-bg/30 opacity-80'}`}
    >
      <header className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-forge-muted">{fromYourAgent(agent)}</p>
          <h3 className="text-[13px] font-semibold text-forge-text break-words">“{s.title}”</h3>
        </div>
        <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wider ${s.status === 'out_of_date' || s.status === 'other_song' ? 'text-amber-300' : 'text-forge-muted'}`}>{s.status.replace(/_/g, ' ')}</span>
      </header>
      {s.explanation && <blockquote className="border-l-2 border-cyan-500/50 pl-2 text-[12px] text-forge-muted whitespace-pre-wrap break-words">{s.explanation}</blockquote>}

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
      {s.status === 'other_song' && <p className="text-[12px] text-amber-300">It was made for the song that was open before, so it can’t go in this one.</p>}

      {(open || mine) && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Hear ${bars(range)} before and after`}>
          <Headphones className="w-3.5 h-3.5 text-forge-muted" aria-hidden />
          {open &&
            (['a', 'b'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => hear(k)}
                aria-pressed={playing && audition.hearing === k}
                data-hear={k === 'a' ? 'now' : 'suggested'}
                className={`h-7 px-2.5 rounded-md border text-[12px] ${playing && audition.hearing === k ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100' : 'border-forge-border text-forge-text hover:border-cyan-500/60'}`}
              >
                {k === 'a' ? 'Now' : 'Suggested'}
              </button>
            ))}
          {mine && audition.phase !== 'idle' && (
            <button type="button" onClick={stopAudition} data-stop="" className="h-7 px-2 rounded-md border border-forge-border text-forge-text flex items-center gap-1 text-[12px]" aria-label="Stop hearing">
              <Square className="w-3 h-3" aria-hidden /> Stop
            </button>
          )}
          <span className="text-[11px] text-forge-muted">{bars(range)}</span>
          {mine && audition.phase === 'rendering' && (
            <span className="w-full h-1 rounded bg-forge-border overflow-hidden" role="progressbar" aria-label="Rendering the before and after" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(audition.progress * 100)}>
              <span className="block h-full bg-cyan-500" style={{ width: `${Math.round(audition.progress * 100)}%` }} />
            </span>
          )}
          {playing && audition.levelDiff !== null && <span className="w-full text-[11px] text-forge-muted">Suggested is {louderWords(audition.levelDiff)}.</span>}
          {mine && audition.note && <span className="w-full text-[11px] text-amber-300">{audition.note}</span>}
          {mine && audition.error && <span className="w-full text-[11px] text-amber-300">Couldn’t render it: {audition.error}</span>}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {(open || s.status === 'out_of_date' || s.status === 'other_song') && (
          <>
            <button
              type="button"
              disabled={!open}
              onPointerDown={guardDown}
              onClick={(e) => say(guardClick(e, s.id) ? acceptSuggestion(s.id, e.nativeEvent) : unsettled)}
              data-accept={s.id}
              className="h-8 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" aria-hidden /> {open && s.confirmUnheard === s.version && s.heard !== s.version ? 'Accept unheard' : 'Accept'}
            </button>
            <button
              type="button"
              onPointerDown={guardDown}
              onClick={(e) => (guardClick(e, s.id) ? dismissSuggestion(s.id, e.nativeEvent) : say(unsettled))}
              data-dismiss={s.id}
              className="h-8 px-3 rounded-md border border-forge-border text-[12px] text-forge-text hover:border-red-400/60 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" aria-hidden /> Dismiss
            </button>
          </>
        )}
        <span data-card-status="" className={`text-[11px] ${s.status === 'changed' || s.status === 'other_song' || message ? 'text-amber-300' : 'text-forge-muted'}`}>
          {message ?? statusLine(s)}
        </span>
      </footer>
    </article>
  );
};
