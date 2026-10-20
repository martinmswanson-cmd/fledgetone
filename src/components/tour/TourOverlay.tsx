import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, GripHorizontal, Hand, Maximize2, Minus, X } from 'lucide-react';
import { lessonById, type LessonStep } from '../../tour/lessons';
import { useTourStore } from '../../tour/tourStore';

/**
 * The running tour or tutorial: a ring round the part of the screen a step is about, and a card
 * explaining it. A step with a task shows "Your turn" and moves on by itself once it's done; the app
 * stays fully usable underneath (nothing here takes clicks or keys, and the card isn't a dialog, so
 * keyboard shortcuts keep working). Back, Next and Skip are always there.
 *
 * The card keeps out of the way: it sits in a corner clear of the step's target and of any menu,
 * picker or dialog the task opens, and stays where it is until one of those would end up under it
 * (so it doesn't follow things around). It can be dragged anywhere, or shrunk to one line. Only
 * read-only steps dim the rest of the screen; during a task everything stays bright.
 */

const PAD = 6;
const CARD_W = 340;
const MARGIN = 16;

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

const showing = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The first element the selector finds that is actually showing. */
function findTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) if (showing(el)) return el;
  return null;
}

/** Menus, pickers and dialogs open right now (the card keeps clear of them: they're what a task is done in). */
function openPopups(card: HTMLElement | null): DOMRect[] {
  const out: DOMRect[] = [];
  for (const el of document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')) {
    if (card?.contains(el) || !showing(el)) continue;
    out.push(el.getBoundingClientRect());
  }
  return out;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

const inflate = (r: Box, by: number): Box => ({ left: r.left - by, top: r.top - by, width: r.width + by * 2, height: r.height + by * 2 });

/** How much of the things to keep clear a card at `pos` would cover. */
const covered = (pos: { left: number; top: number }, size: { w: number; h: number }, avoid: Box[]) =>
  avoid.reduce((n, r) => n + overlap({ left: pos.left, top: pos.top, width: size.w, height: size.h }, inflate(r, 10)), 0);

/** Where the card covers the least of `avoid`: a screen corner or the middle of a side, in that order of preference. */
function placeCard(size: { w: number; h: number }, avoid: Box[]): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const right = vw - size.w - MARGIN;
  const bottom = vh - size.h - MARGIN;
  const middle = Math.max(MARGIN, (vh - size.h) / 2);
  const spots = [
    { left: right, top: bottom },
    { left: MARGIN, top: bottom },
    { left: right, top: MARGIN + 56 },
    { left: MARGIN, top: MARGIN + 56 },
    { left: right, top: middle },
    { left: MARGIN, top: middle },
    { left: (vw - size.w) / 2, top: bottom },
  ];
  let best = spots[0];
  let least = Infinity;
  for (const spot of spots) {
    const c = covered(spot, size, avoid);
    if (c < least) {
      least = c;
      best = spot;
    }
    if (c === 0) break;
  }
  return best;
}

/** Keep a dragged card on screen (after a resize, or a card that grew). */
const clampToScreen = (pos: { left: number; top: number }, size: { w: number; h: number }) => ({
  left: Math.max(8, Math.min(window.innerWidth - size.w - 8, pos.left)),
  top: Math.max(8, Math.min(window.innerHeight - size.h - 8, pos.top)),
});

export const TourOverlay: React.FC = () => {
  const lesson = useTourStore((s) => s.active?.lesson);
  // Each lesson gets a fresh card: placed afresh, open, not pinned
  return lesson ? <LessonOverlay key={lesson} /> : null;
};

const LessonOverlay: React.FC = () => {
  const active = useTourStore((s) => s.active);
  const lesson = active ? lessonById(active.lesson) : undefined;
  const step = lesson && active ? lesson.steps[active.step] : undefined;
  const [rect, setRect] = useState<DOMRect | null>(null);
  /** Whether a menu, picker or dialog is open (the screen isn't dimmed over it) */
  const [popupOpen, setPopupOpen] = useState(false);
  /** The step whose task has been done (lesson:step), so a new step starts not done */
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const stepKey = active ? `${active.lesson}:${active.step}` : '';
  const done = doneFor === stepKey;
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** Where the card is. It stays put until it would cover what the step is about, so it doesn't hop around */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** Put somewhere by hand (dragged): then it stays there for the rest of the lesson */
  const [pinned, setPinned] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // The frame loop and handlers read these without restarting
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  const pinnedRef = useRef(pinned);
  useEffect(() => {
    posRef.current = pos;
    sizeRef.current = size;
    pinnedRef.current = pinned;
  }, [pos, size, pinned]);

  /** How things stood when the step began, for its task */
  const begun = useRef<unknown>(undefined);

  // Set the scene, note how things stand for the task, and bring the target into view if it's off screen
  useEffect(() => {
    if (!step) return;
    step.before?.();
    begun.current = step.task?.begin?.();
    const t = window.setTimeout(() => {
      const el = findTarget(selectorOf(step));
      if (!el) return;
      const r = el.getBoundingClientRect();
      const visible = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      if (!visible) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 80);
    return () => clearTimeout(t);
  }, [step]);

  // Follow the target and the open menus; move the card only when it would cover one of them
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let last = '';
    let lastPopups = '';
    const tick = () => {
      const el = findTarget(selectorOf(step));
      const r = el?.getBoundingClientRect() ?? null;
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) {
        last = key;
        setRect(r);
      }
      const popups = openPopups(cardRef.current);
      const popupKey = popups.map((p) => `${Math.round(p.left)},${Math.round(p.top)},${Math.round(p.width)},${Math.round(p.height)}`).join('|');
      if (popupKey !== lastPopups) {
        lastPopups = popupKey;
        setPopupOpen(popups.length > 0);
      }
      const sz = sizeRef.current;
      if (sz && !pinnedRef.current) {
        const avoid: Box[] = [...popups, ...(r ? [r] : [])];
        const here = posRef.current;
        if (!here || covered(here, sz, avoid) > 0) {
          const next = placeCard(sz, avoid);
          if (!here || next.left !== here.left || next.top !== here.top) setPos(next);
        }
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

  // The card's size, for placing it (and keeping a dragged one on screen)
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => {
      const sz = sizeRef.current;
      const here = posRef.current;
      if (sz && here) setPos(pinnedRef.current ? clampToScreen(here, sz) : null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Drag the card by its top row to put it anywhere */
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !posRef.current || !sizeRef.current) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY, ...posRef.current };
    const move = (ev: PointerEvent) => {
      setPinned(true);
      pinnedRef.current = true;
      setPos(clampToScreen({ left: from.left + ev.clientX - from.x, top: from.top + ev.clientY - from.y }, sizeRef.current!));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (!active || !lesson || !step) return null;

  const last = active.step === lesson.steps.length - 1;
  const next = () => (last ? useTourStore.getState().stop(true) : useTourStore.getState().goTo(active.step + 1));
  const back = () => active.step > 0 && useTourStore.getState().goTo(active.step - 1);
  const task = step.task;
  const vw = window.innerWidth;
  const w = Math.min(CARD_W, vw - 16);
  // Dimmed only while there's nothing to do and nothing open: a task's menus and dialogs stay bright
  const dim = !task && !popupOpen;

  // On screen even when this step's card is taller than the one it was placed for
  const shown = pos && size ? clampToScreen(pos, size) : pos;
  return (
    <>
      {/* The spotlight: a ring round the part the step is about, which follows it exactly (no easing to lag behind) */}
      {(rect || dim) && (
        <div
          aria-hidden
          data-tour-spotlight
          className="fixed z-[75] pointer-events-none rounded-lg"
          style={
            rect
              ? {
                  left: rect.left - PAD,
                  top: rect.top - PAD,
                  width: rect.width + PAD * 2,
                  height: rect.height + PAD * 2,
                  boxShadow: `0 0 0 2px #22d3ee, 0 0 18px rgba(34,211,238,0.5)${dim ? ', 0 0 0 9999px rgba(0,0,0,0.5)' : ''}`,
                }
              : { left: vw / 2, top: 0, width: 0, height: 0, boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }
          }
        />
      )}
      <div
        ref={cardRef}
        role="region"
        aria-label={`${lesson.title}: step ${active.step + 1} of ${lesson.steps.length}`}
        aria-live="polite"
        data-tour-card
        className="fixed z-[76] rounded-xl border border-cyan-500/60 bg-forge-panel shadow-2xl text-xs text-forge-muted"
        style={{ left: shown?.left ?? 0, top: shown?.top ?? 0, width: collapsed ? 'auto' : w, maxWidth: w, visibility: pos ? 'visible' : 'hidden' }}
      >
        <div
          onPointerDown={drag}
          className="flex items-center gap-2 px-3 pt-2.5 pb-2 text-[10px] font-mono uppercase tracking-wider cursor-move select-none touch-none"
          title="Drag to move this card"
        >
          <GripHorizontal className="w-3.5 h-3.5 shrink-0 opacity-60" />
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200">{lesson.level}</span>
          {!collapsed && <span className="truncate min-w-0">{lesson.title}</span>}
          <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums">
            {active.step + 1} / {lesson.steps.length}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-forge-muted hover:text-forge-text"
            aria-label={collapsed ? 'Show the tutorial card' : 'Shrink the tutorial card'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Show the step' : 'Shrink this card out of the way'}
          >
            {collapsed ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
          <button type="button" onClick={() => useTourStore.getState().stop()} className="text-forge-muted hover:text-forge-text" aria-label="Close tutorial" title="Close (you can pick up where you left off from LEARN)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {collapsed ? (
          <div className="flex items-center gap-2 px-3 pb-2.5">
            {task ? (
              <span className={`flex items-center gap-1.5 ${done ? 'text-emerald-200' : 'text-amber-100'}`}>
                {done ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Hand className="w-3.5 h-3.5 shrink-0" />}
                {done ? 'Done!' : task.hint}
              </span>
            ) : (
              <span className="text-forge-text font-semibold truncate">{step.title}</span>
            )}
            {(!task || done) && (
              <button type="button" onClick={next} className="ml-auto h-6 px-2 flex items-center gap-1 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25">
                {last ? 'Finish' : 'Next'}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 pb-4 flex flex-col gap-2.5">
            <div className="h-1 rounded bg-forge-bg overflow-hidden">
              <div className="h-full bg-cyan-400" style={{ width: `${((active.step + 1) / lesson.steps.length) * 100}%` }} />
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
        )}
      </div>
    </>
  );
};
