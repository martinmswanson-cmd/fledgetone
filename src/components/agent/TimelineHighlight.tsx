/**
 * What the timeline shows of the agent: the bars of the tracks a suggestion changes, tinted while
 * its card has the pointer or focus or its before-and-after plays (with a mark at the lanes' left
 * edge, so the tracks show even with those bars scrolled away), and what the agent points at
 * (point_at: a track, a clip, some bars or a marker), ringed for a few seconds with its note
 * (marked "From your agent (name)" and quoted, as on the panel, so it never reads as the app's own).
 * Drawn over the lanes only (never the track headers, the ruler, the Suggestions panel or anything
 * outside the timeline) from where the lanes and clips are on screen (found by their data-lane and
 * data-clip-id attributes), so the timeline itself doesn't change; it follows scrolling and zoom
 * while it shows, and takes no clicks. What's pointed at off screen is scrolled to (the lanes
 * only, never the focus, and not while the musician is scrolling, clicking or typing, nor while
 * the song plays); while it's still off screen, the note sits at the lanes' edge and says where it
 * is ("Bars 7–8 →"), never over other bars. A control pointed at (rung as the search does) gets
 * the agent's ring and note next to it. Screen readers hear of a highlight from the agent's live
 * region.
 */
import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { TOTAL_BARS } from '../../store/timelineTypes';
import { useSuggestions, type Highlight } from '../../agent/suggestionsStore';
import { useAudition } from '../../audio/auditionPlayer';
import { FromYourAgent } from './Named';
import { textName } from '../../agent/names';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: 'tint' | 'ring' | 'edge';
}

type Rect = { left: number; top: number; right: number; bottom: number };

/** The part of `r` inside `clip`, or null. */
function within(r: Rect, clip: Rect): Omit<Box, 'kind'> | null {
  const left = Math.max(r.left, clip.left);
  const right = Math.min(r.right, clip.right);
  const top = Math.max(r.top, clip.top);
  const bottom = Math.min(r.bottom, clip.bottom);
  return right - left > 1 && bottom - top > 1 ? { left, top, width: right - left, height: bottom - top } : null;
}

/** Where bars [from, to) of a lane are on screen. */
function laneBars(lane: Element, from: number, to: number, zoom: number) {
  const r = lane.getBoundingClientRect();
  return { left: r.left + (from - 1) * zoom, right: r.left + (to - 1) * zoom, top: r.top, bottom: r.bottom };
}

/**
 * The lanes' part of the timeline on screen: right of the track headers, under the ruler, left of
 * the Suggestions panel where it lies over them. Null without a timeline.
 */
function lanesView(): Rect | null {
  const scroll = document.querySelector('[data-timeline-scroll]');
  if (!scroll) return null;
  const whole = scroll.getBoundingClientRect();
  const ruler = scroll.querySelector('[data-timeline-ruler]');
  const rr = ruler?.getBoundingClientRect();
  const corner = ruler?.firstElementChild?.getBoundingClientRect();
  const left = corner ? corner.right : whole.left;
  const top = rr ? Math.max(whole.top, rr.bottom) : whole.top;
  let right = whole.right;
  const panel = document.querySelector('[data-agent-panel]')?.getBoundingClientRect();
  if (panel && panel.left < right && panel.right > left && panel.top < whole.bottom && panel.bottom > top) right = Math.max(left, panel.left);
  return { left, top, right, bottom: whole.bottom };
}

/** Bars [from, to) in words: "bar 7", "bars 7–8" (to not included). */
function barsWords(from: number, to: number): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const last = Number.isInteger(from) && Number.isInteger(to) ? to - 1 : to;
  return last <= from ? `bar ${n(from)}` : `bars ${n(from)}–${n(last)}`;
}

/** The bars a highlight's target covers in the song ([from, to)), or null (a track, a control). */
function targetBars(t: Highlight['target']): { from: number; to: number } | null {
  const s = useTimelineStore.getState();
  if (t.bars) return { from: t.bars.fromBar, to: t.bars.toBar };
  if (t.clip) {
    const c = s.clips.find((x) => x.id === t.clip);
    return c ? { from: c.startBar, to: c.startBar + c.lengthBars } : null;
  }
  if (t.marker) {
    const m = s.markers.find((x) => x.id === t.marker);
    return m ? { from: m.bar, to: m.bar } : null;
  }
  return null;
}

/** What a highlight points at, in words, for the note at the lanes' edge when it's off screen. */
function targetWords(t: Highlight['target']): string {
  const s = useTimelineStore.getState();
  if (t.bars) return barsWords(t.bars.fromBar, t.bars.toBar).replace(/^b/, 'B');
  if (t.clip) return `Clip “${textName(s.clips.find((x) => x.id === t.clip)?.name)}”`;
  if (t.marker) return `Marker “${textName(s.markers.find((x) => x.id === t.marker)?.name)}”`;
  if (t.track) return `Track “${textName(s.tracks.find((x) => x.id === t.track)?.name)}”`;
  return '';
}

// The musician's own hands on the page: the lanes aren't scrolled for the agent while they're busy
let lastInput = -Infinity;
let buttons = 0;
const QUIET_MS = 1500;
const onInput = (e: Event) => {
  lastInput = performance.now();
  if (e.type === 'pointerdown') buttons++;
  else if (e.type === 'pointerup' || e.type === 'pointercancel') buttons = Math.max(0, buttons - 1);
};
const INPUTS = ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'touchmove'] as const;
/** Whether the musician is scrolling, clicking or typing (or was a moment ago). */
const musicianBusy = () => performance.now() - lastInput < (buttons > 0 ? 10_000 : QUIET_MS);

/**
 * Bring a highlight's bars into the lanes' view, if they're off screen (not while the song plays:
 * the view follows the playhead then). Only the lanes scroll: the focus stays where it is.
 */
function scrollTo(h: Highlight): void {
  const range = targetBars(h.target);
  const s = useTimelineStore.getState();
  const view = lanesView();
  if (!range || !view || s.isPlaying) return;
  const width = Math.max(0, view.right - view.left);
  const from = (range.from - 1) * s.zoom;
  const to = (range.to - 1) * s.zoom;
  if (from >= s.viewLeft && to <= s.viewLeft + width) return;
  const left = Math.max(0, Math.min(TOTAL_BARS * s.zoom - s.viewWidth, from - Math.min(48, width / 4)));
  if (Math.abs(left - s.viewLeft) < 1) return;
  useTimelineStore.setState({ viewLeft: left, viewJumps: s.viewJumps + 1 });
}

const NOTE_W = 204;

export const TimelineHighlight: React.FC = () => {
  const highlight = useSuggestions((s) => s.highlight);
  const agent = useSuggestions((s) => s.connection.agent);
  const focusId = useSuggestions((s) => s.focusId);
  const auditionKey = useAudition((s) => (s.phase !== 'idle' ? s.key : null));
  // (one made for another song has nothing to show in this one)
  const focused = useSuggestions((s) => s.suggestions.find((x) => x.id === (focusId ?? auditionKey) && x.status !== 'other_song') ?? null);
  const [boxes, setBoxes] = React.useState<Box[]>([]);
  const [note, setNote] = React.useState<{ text: string; where: string; left: number; top: number } | null>(null);

  React.useEffect(() => {
    for (const t of INPUTS) window.addEventListener(t, onInput, { capture: true, passive: true });
    return () => {
      for (const t of INPUTS) window.removeEventListener(t, onInput, { capture: true });
    };
  }, []);

  // Pointed at off screen: the lanes scroll to it, once, as soon as the musician's hands are still
  // (and never once they've touched anything since it came: they're doing something of their own)
  const scroll = React.useRef<{ for: Highlight; arrived: number; done: boolean } | null>(null);
  React.useEffect(() => {
    scroll.current = highlight && !highlight.target.control ? { for: highlight, arrived: performance.now(), done: false } : null;
  }, [highlight]);

  const active = !!highlight || !!focused;
  React.useEffect(() => {
    if (!active) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const view = lanesView();
      if (!view) {
        setBoxes([]);
        setNote(null);
        return;
      }
      const { zoom, markers } = useTimelineStore.getState();
      const out: Box[] = [];
      const lanes = [...document.querySelectorAll('[data-lane]')];
      const laneOf = (id: string) => lanes.find((l) => (l as HTMLElement).dataset.lane === id);
      const add = (r: Rect | null, kind: Box['kind'], area: Rect = view) => {
        const b = r && within(r, area);
        if (b) out.push({ ...b, kind });
        return b;
      };
      if (focused) {
        const tracks = focused.touchedTracks.length ? focused.touchedTracks : lanes.map((l) => (l as HTMLElement).dataset.lane!);
        for (const id of tracks) {
          const lane = laneOf(id);
          if (!lane) continue;
          add(focused.bars ? laneBars(lane, focused.bars.fromBar, focused.bars.toBar, zoom) : lane.getBoundingClientRect(), 'tint');
          // A mark at the lanes' left edge, always in view (the bars may be scrolled away)
          const lr = lane.getBoundingClientRect();
          add({ left: view.left, right: view.left + 4, top: lr.top, bottom: lr.bottom }, 'edge');
        }
      }
      let anchor: { left: number; top: number; where: string } | null = null;
      const h = highlight && highlight.until > Date.now() ? highlight : null;
      const sc = scroll.current;
      if (h && sc && sc.for === h && !sc.done) {
        if (lastInput > sc.arrived) sc.done = true;
        else if (!musicianBusy()) {
          sc.done = true;
          scrollTo(h);
        }
      }
      if (h) {
        const t = h.target;
        let r: Rect | null = null;
        if (t.control) {
          // A control: ringed where it is, anywhere on the page, the note next to it
          const el = h.element?.isConnected ? h.element : null;
          const screen = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
          const shown = el ? add(el.getBoundingClientRect(), 'ring', screen) : null;
          if (shown) {
            const below = shown.top + shown.height + 6;
            anchor = {
              left: Math.max(4, Math.min(shown.left, screen.right - NOTE_W)),
              top: below + 56 <= screen.bottom ? below + 4 : Math.max(4, shown.top - 60),
              where: '',
            };
          }
        } else {
          if (t.track) r = laneOf(t.track)?.getBoundingClientRect() ?? null;
          else if (t.clip) r = document.querySelector(`[data-clip-id="${CSS.escape(t.clip)}"]`)?.getBoundingClientRect() ?? null;
          else if (t.bars && lanes.length) {
            const first = laneBars(lanes[0], t.bars.fromBar, t.bars.toBar, zoom);
            const last = lanes[lanes.length - 1].getBoundingClientRect();
            r = { ...first, bottom: last.bottom };
          } else if (t.marker && lanes.length) {
            const m = markers.find((x) => x.id === t.marker);
            if (m) {
              const x = laneBars(lanes[0], m.bar, m.bar, zoom).left;
              r = { left: x - 2, right: x + 2, top: view.top, bottom: view.bottom };
            }
          }
          const shown = add(r, 'ring');
          const clampTop = (y: number) => Math.max(view.top + 4, Math.min(y, view.bottom - 56));
          // The note sits inside the lanes, at the top left of what of it is in view
          if (shown) anchor = { left: Math.max(view.left + 4, Math.min(shown.left + 4, view.right - NOTE_W)), top: clampTop(shown.top + 4), where: '' };
          else if (r) {
            // Off screen: at the lanes' edge on its side, saying where it is (never over other bars)
            const what = targetWords(t);
            if (r.left >= view.right) anchor = { left: Math.max(view.left + 4, view.right - NOTE_W), top: clampTop(r.top + 4), where: `${what} →` };
            else if (r.right <= view.left) anchor = { left: view.left + 4, top: clampTop(r.top + 4), where: `← ${what}` };
            else if (r.top >= view.bottom) anchor = { left: Math.max(view.left + 4, Math.min(r.left + 4, view.right - NOTE_W)), top: view.bottom - 56, where: `${what} ↓` };
            else anchor = { left: Math.max(view.left + 4, Math.min(r.left + 4, view.right - NOTE_W)), top: view.top + 4, where: `${what} ↑` };
          }
        }
      }
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
      const next = h && anchor && (h.note || anchor.where) ? { text: h.note ?? '', ...anchor } : null;
      setNote((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      if (highlight && !h) useSuggestions.setState({ highlight: null });
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [active, highlight, focused]);

  if (!active || (!boxes.length && !note)) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[40]" data-agent-highlight="">
      {boxes.map((b, i) => (
        <div
          key={i}
          className={
            b.kind === 'ring' ? 'absolute rounded-md border-2 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.6)]' : b.kind === 'edge' ? 'absolute bg-cyan-400/70' : 'absolute bg-cyan-400/10 border-y border-cyan-400/30'
          }
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
      {note && (
        <div className="absolute max-w-[200px] rounded bg-forge-panel border border-cyan-400/60 px-2 py-1" style={{ left: note.left, top: note.top - 4 }} data-agent-note="">
          <p className="text-[9px] font-mono uppercase tracking-wider text-forge-muted"><FromYourAgent name={agent} /></p>
          {note.text && <p className="text-[11px] text-forge-text whitespace-pre-wrap break-words">“{note.text}”</p>}
          {note.where && (
            <p className="text-[11px] font-semibold text-cyan-200" data-agent-note-where="">
              {note.where}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
