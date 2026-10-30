/**
 * One suggestion on the Suggestions panel: marked as from the agent that made it (by the name it had
 * then, whoever is paired now), with its title and why quoted
 * (plain text), what it changes in plain words, its cautions in amber and its notes plain, a
 * before-and-after to hear (Now / Suggested, the same bars looped, switched in step), and Accept
 * (one undo step) or Dismiss. Accept and Dismiss answer only to a real click or key press on a card
 * that stayed where it was (cardGuard.ts), and a press that doesn't count says why. Its
 * before-and-after plays every bar it changes (a change too long to hear at once: its first bars,
 * and it says which it leaves out). It says whether it was heard, or heard only in part; one the song changed under
 * is made again when it's heard, and goes in unheard only after a second press of Accept; one out
 * of date or made for another song can't be accepted (its Accept stays, marked unavailable, so a
 * focus on it stays). Stop is there whenever it's being heard. A focus inside the card when its
 * buttons go (the agent withdrew it) comes to the card, never left on the page.
 * "Ask about this" ties the musician's next message to it (the message box takes the focus).
 */
import React from 'react';
import { Check, Headphones, MessageSquareReply, Square, X } from 'lucide-react';
import { useAudition, stopAudition, hearAudition } from '../../audio/auditionPlayer';
import { acceptSuggestion, dismissSuggestion } from '../../agent/accept';
import { auditionCurrent, hearSuggestion } from '../../agent/songWatch';
import { announce, ARMED_MS, barWords, isArmed, isOpen, updateSuggestion, useSuggestions, type Suggestion } from '../../agent/suggestionsStore';
import { GUARD_WORDS, guardClick, guardDown, guardKey, guardKeyPress, guardKeyUp } from './cardGuard';
import { focusAfterAnswer } from './returnFocus';
import { useConversation } from '../../agent/conversation';
import { fromYourAgent, louderWords, STATUS_WORDS } from './words';

/** An agent's title in quotes, once (one that poses as the app comes quoted already). */
const quoted = (t: string) => (t.startsWith('“') && t.endsWith('”') ? t : `“${t}”`);

const bars = barWords;

/** The line under the buttons: where it is, and whether what Accept puts in was heard. */
function statusLine(s: Suggestion): string {
  const part = isOpen(s) && s.heard !== s.version && s.partHeard === s.version && s.unheard ? `Heard only in part: ${bars(s.unheard)} ${s.unheard.toBar - s.unheard.fromBar > 1 ? 'weren’t' : 'wasn’t'} heard.` : null;
  if (s.status === 'changed') return s.heard === s.version && !s.stale ? 'The song changed since it was suggested. You heard it as it is now.' : (part ?? 'The song changed since it was suggested: hear it again before you accept.');
  if (s.status === 'waiting') return s.heard === s.version ? 'Heard.' : (part ?? 'Not heard yet.');
  const words = STATUS_WORDS[s.status];
  return words[0].toUpperCase() + words.slice(1) + '.';
}

export const SuggestionCard: React.FC<{ suggestion: Suggestion }> = ({ suggestion: s }) => {
  const audition = useAudition();
  const mine = audition.key === s.id;
  // The last press's answer, kept only until the suggestion's status or version moves on
  const [said, setSaid] = React.useState<{ text: string; at: string } | null>(null);
  const key = (x: Pick<Suggestion, 'status' | 'version' | 'armed'>) => `${x.status}:${x.version}:${x.armed?.at ?? ''}`;
  const here = key(s);
  const message = said && said.at === here ? said.text : null;
  // An answer to a press: shown on the card, and said for screen readers (one live region for the panel)
  const say = (text: string | null) => {
    // (kept for the suggestion as the press left it: Accept may have made it again)
    const after = useSuggestions.getState().suggestions.find((x) => x.id === s.id);
    setSaid(text ? { text, at: after ? key(after) : here } : null);
    announce(text ?? `${quoted(s.title)} accepted.`, true);
  };
  // "Accept without listening" lasts ARMED_MS: then it's Accept again
  const armed = isOpen(s) && isArmed(s);
  React.useEffect(() => {
    const at = s.armed?.at;
    if (at === undefined) return;
    const t = window.setTimeout(() => updateSuggestion(s.id, (x) => (x.armed?.at === at ? { ...x, armed: null } : x)), Math.max(0, at + ARMED_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [s.id, s.armed?.at]);
  const open = isOpen(s);
  // (every bar it changes, and the agent's focus with them if that fits: see hearingRange)
  const range = s.audition;
  const playing = mine && audition.phase === 'playing';

  const hear = (which: 'a' | 'b') => {
    // (switched in step only while what plays is this version on the song as it is: else it's made and rendered again)
    if (playing && auditionCurrent(s, audition)) return hearAudition(which);
    void hearSuggestion(s.id, which);
  };

  const focus = () => useSuggestions.setState({ focusId: s.id });
  const unfocus = () => useSuggestions.getState().focusId === s.id && useSuggestions.setState({ focusId: null });
  /** A second press of Accept too soon after the first to be a separate one. */
  const tooSoon = 'That came too soon after the first press to count as a second one: press Accept without listening again.';

  // The keyboard focus inside this card when its buttons go (the agent withdrew it, say): it
  // comes to the card itself, never left on the page's body
  const card = React.useRef<HTMLElement>(null);
  const focusInside = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = card.current;
    const now = document.activeElement;
    if (el && focusInside.current && (!now || now === document.body || !now.isConnected)) el.focus({ preventScroll: true });
  }, [s.status]);

  return (
    <article
      ref={card}
      aria-label={`Suggestion from your agent: ${s.title}`}
      data-suggestion={s.id}
      // (focus can come here, never to a button, after the card before it is answered from the keyboard)
      tabIndex={-1}
      onMouseEnter={focus}
      onMouseLeave={unfocus}
      onFocus={() => {
        focusInside.current = true;
        focus();
      }}
      onBlur={(e) => {
        // (a button taken away under the focus isn't the musician moving it: that's told by where it went)
        const gone = e.target;
        if (e.relatedTarget && card.current?.contains(e.relatedTarget as Node)) return;
        window.setTimeout(() => {
          if (gone.isConnected || (document.activeElement && document.activeElement !== document.body)) focusInside.current = !!card.current?.contains(document.activeElement);
        }, 0);
      }}
      className={`rounded-lg border p-3 flex flex-col gap-2 outline-none focus:ring-1 focus:ring-cyan-400/60 ${open ? 'border-forge-border bg-forge-bg/60' : 'border-forge-border/50 bg-forge-bg/30 opacity-80'}`}
    >
      <header className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-forge-muted">{fromYourAgent(s.agent)}</p>
          <h3 className="text-[13px] font-semibold text-forge-text break-words">{quoted(s.title)}</h3>
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
          {open && s.unheard && (
            <span data-unheard="" className="w-full text-[11px] text-amber-300">
              It changes more than can be heard at once (90 seconds): you hear its first bars, {bars(range)}, not {bars(s.unheard)}.
            </span>
          )}
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
              // (not disabled: a button that's focused stays focused when the suggestion goes out of date)
              aria-disabled={!open}
              onPointerDown={guardDown}
              onKeyDown={guardKey}
              onKeyUp={guardKeyUp}
              onClick={(e) => {
                if (!open) return;
                const press = guardClick(e, s.id);
                // (a press that doesn't count always says why)
                if (press !== 'ok') return say(GUARD_WORDS[press]);
                const answer = acceptSuggestion(s.id, e.nativeEvent);
                // ('' : a second press too soon to be a separate one)
                say(answer === '' ? tooSoon : answer);
                if (answer === null && e.detail === 0) focusAfterAnswer(s.id);
              }}
              data-accept={s.id}
              className="h-8 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/25 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-cyan-500/15 flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" aria-hidden /> {armed ? 'Accept without listening' : 'Accept'}
            </button>
            <button
              type="button"
              onPointerDown={guardDown}
              onKeyDown={guardKeyPress}
              onKeyUp={guardKeyUp}
              onClick={(e) => {
                const press = guardClick(e, s.id);
                if (press === 'ok') {
                  dismissSuggestion(s.id, e.nativeEvent);
                  if (e.detail === 0) focusAfterAnswer(s.id);
                } else say(GUARD_WORDS[press]);
              }}
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
        <button
          type="button"
          data-keep-focus=""
          data-ask-about={s.id}
          onClick={() => {
            // (the musician's own press: the message box takes the focus, to write the question)
            useConversation.setState({ about: s.id });
            window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-agent-compose] textarea')?.focus({ preventScroll: true }), 0);
          }}
          aria-label={`Ask about this: “${s.title}”`}
          className="ml-auto h-7 px-2 rounded-md border border-forge-border text-[11px] text-forge-muted hover:text-forge-text hover:border-cyan-500/60 flex items-center gap-1"
        >
          <MessageSquareReply className="w-3 h-3" aria-hidden /> Ask about this
        </button>
      </footer>
    </article>
  );
};
