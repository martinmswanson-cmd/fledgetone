import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Hand, X } from 'lucide-react';
import { lessonById, type LessonStep } from '../../tour/lessons';
import { useTourStore } from '../../tour/tourStore';

/**
 * The running tour or tutorial: the part of the screen a step is about, lit up (the rest dimmed),
 * and a card next to it explaining it. A step with a task shows "Your turn" and moves on by itself
 * once it's done; the app stays fully usable underneath (nothing here takes clicks or keys, and the
 * card isn't a dialog, so keyboard shortcuts keep working). Back, Next and Skip are always there.
 */

const PAD = 6;
const CARD_W = 340;
const GAP = 12;

/** **bold** and *italic* in a step's text. */
function rich(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('**') ? (
      <strong key={i} className="text-forge-text font-semibold">{part.slice(2, -2)}</strong>
    ) : part.startsWith('*') && part.length > 2 ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      part
    )
  );
}

const selectorOf = (step: LessonStep): string | null => (typeof step.target === 'function' ? step.target() : step.target ?? null);

/** The first element the selector finds that is actually showing. */
function findTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export const TourOverlay: React.FC = () => {
  const active = useTourStore((s) => s.active);
  const lesson = active ? lessonById(active.lesson) : undefined;
  const step = lesson && active ? lesson.steps[active.step] : undefined;
  const [rect, setRect] = useState<DOMRect | null>(null);
  /** The step whose task has been done (lesson:step), so a new step starts not done */
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const stepKey = active ? `${active.lesson}:${active.step}` : '';
  const done = doneFor === stepKey;
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);

  /** How things stood when the step began, for its task */
  const begun = useRef<unknown>(undefined);

  // Set the scene, note how things stand for the task, scroll the target into view
  useEffect(() => {
    if (!step) return;
    step.before?.();
    begun.current = step.task?.begin?.();
    const t = window.setTimeout(() => findTarget(selectorOf(step))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    return () => clearTimeout(t);
  }, [step]);

  // Follow the target as the page scrolls, panels open and dialogs come and go
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = findTarget(selectorOf(step));
      const r = el?.getBoundingClientRect() ?? null;
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) {
        last = key;
        setRect(r);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // A task moves on by itself once it's done (after a moment to see the tick)
  useEffect(() => {
    if (!step?.task || done) return;
    const id = window.setInterval(() => {
      let ok = false;
      try {
        ok = step.task!.done(begun.current);
      } catch {
        ok = false;
      }
      if (ok) setDoneFor(stepKey);
    }, 250);
    return () => clearInterval(id);
  }, [step, done, stepKey]);

  useEffect(() => {
    if (!done || !active || !lesson) return;
    const t = window.setTimeout(() => {
      if (active.step + 1 < lesson.steps.length) useTourStore.getState().goTo(active.step + 1);
      else useTourStore.getState().stop(true);
    }, 900);
    return () => clearTimeout(t);
  }, [done, active, lesson]);

  // The card's height decides whether it fits above or below the target
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  if (!active || !lesson || !step) return null;

  const last = active.step === lesson.steps.length - 1;
  const next = () => (last ? useTourStore.getState().stop(true) : useTourStore.getState().goTo(active.step + 1));
  const back = () => active.step > 0 && useTourStore.getState().goTo(active.step - 1);

  // The card goes below the target, or above it, or (a big target) in the bottom-right corner
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 16);
  let left = (vw - w) / 2;
  let top = (vh - cardH) / 2;
  if (rect) {
    const below = vh - rect.bottom - GAP - PAD;
    const above = rect.top - GAP - PAD;
    if (below >= cardH) top = rect.bottom + PAD + GAP;
    else if (above >= cardH) top = rect.top - PAD - GAP - cardH;
    else top = vh - cardH - 16;
    left = Math.max(8, Math.min(vw - w - 8, rect.left + rect.width / 2 - w / 2));
    if (below < cardH && above < cardH) left = vw - w - 16;
  }
  const task = step.task;

  return (
    <>
      {/* The spotlight: everything else dimmed, lighter while there's something to do */}
      <div
        aria-hidden
        className="fixed z-[75] pointer-events-none rounded-lg transition-all duration-200"
        style={
          rect
            ? {
                left: rect.left - PAD,
                top: rect.top - PAD,
                width: rect.width + PAD * 2,
                height: rect.height + PAD * 2,
                boxShadow: `0 0 0 2px #22d3ee, 0 0 18px rgba(34,211,238,0.5), 0 0 0 9999px rgba(0,0,0,${task ? 0.35 : 0.55})`,
              }
            : { left: vw / 2, top: vh / 2, width: 0, height: 0, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }
        }
      />
      <div
        ref={cardRef}
        role="region"
        aria-label={`${lesson.title}: step ${active.step + 1} of ${lesson.steps.length}`}
        aria-live="polite"
        className="fixed z-[76] rounded-xl border border-cyan-500/60 bg-forge-panel shadow-2xl p-4 flex flex-col gap-2.5 text-xs text-forge-muted"
        style={{ left, top: Math.max(8, top), width: w }}
      >
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200">{lesson.level}</span>
          <span className="truncate">{lesson.title}</span>
          <span className="ml-auto tabular-nums">
            {active.step + 1} / {lesson.steps.length}
          </span>
          <button type="button" onClick={() => useTourStore.getState().stop()} className="text-forge-muted hover:text-forge-text" aria-label="Close tutorial" title="Close (you can pick up where you left off from LEARN)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="h-1 rounded bg-forge-bg overflow-hidden">
          <div className="h-full bg-cyan-400 transition-all" style={{ width: `${((active.step + 1) / lesson.steps.length) * 100}%` }} />
        </div>
        <h3 className="text-sm font-semibold text-forge-text">{step.title}</h3>
        <p className="leading-relaxed">{rich(step.body)}</p>
        {task && (
          <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${done ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/50 bg-amber-500/10 text-amber-100'}`}>
            {done ? <Check className="w-4 h-4 shrink-0" /> : <Hand className="w-4 h-4 shrink-0" />}
            <span>{done ? 'Done!' : <>Your turn: <strong>{task.hint}</strong></>}</span>
          </div>
        )}
        {!rect && step.target && <p className="text-[11px] italic">(That part isn't on screen right now.)</p>}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={back} disabled={active.step === 0} className="h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border hover:border-forge-borderLight disabled:opacity-30">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="flex-1" />
          {task && !done && (
            <button type="button" onClick={next} className="h-7 px-2 rounded-md text-forge-muted hover:text-forge-text" title="Move on without doing this step">
              Skip
            </button>
          )}
          {(!task || done) && (
            <button type="button" onClick={next} className="h-7 px-3 flex items-center gap-1 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25">
              {last ? 'Finish' : 'Next'} {!last && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    </>
  );
};
