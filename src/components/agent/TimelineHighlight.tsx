/**
 * What the timeline shows of the agent: the tracks (their headers and the bars) a suggestion changes, tinted while its
 * card has the pointer or focus or its before-and-after plays, and what the agent points at
 * (point_at: a track, a clip, some bars or a marker), ringed for a few seconds with its note.
 * Drawn over the timeline from where its lanes and clips are on screen (found by their data-lane
 * and data-clip-id attributes), so the timeline itself doesn't change; it follows scrolling and
 * zoom while it shows, and takes no clicks.
 */
import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useSuggestions } from '../../agent/suggestionsStore';
import { useAudition } from '../../audio/auditionPlayer';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: 'tint' | 'ring';
}

/** The part of `r` inside `clip`, or null. */
function within(r: { left: number; top: number; right: number; bottom: number }, clip: DOMRect): Omit<Box, 'kind'> | null {
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

export const TimelineHighlight: React.FC = () => {
  const highlight = useSuggestions((s) => s.highlight);
  const focusId = useSuggestions((s) => s.focusId);
  const auditionKey = useAudition((s) => (s.phase !== 'idle' ? s.key : null));
  const focused = useSuggestions((s) => s.suggestions.find((x) => x.id === (focusId ?? auditionKey)) ?? null);
  const [boxes, setBoxes] = React.useState<Box[]>([]);
  const [note, setNote] = React.useState<{ text: string; left: number; top: number } | null>(null);

  const active = !!highlight || !!focused;
  React.useEffect(() => {
    if (!active) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const scroll = document.querySelector('[data-timeline-scroll]');
      if (!scroll) return setBoxes([]);
      const view = scroll.getBoundingClientRect();
      const { zoom, markers } = useTimelineStore.getState();
      const out: Box[] = [];
      const lanes = [...document.querySelectorAll('[data-lane]')];
      const laneOf = (id: string) => lanes.find((l) => (l as HTMLElement).dataset.lane === id);
      const add = (r: { left: number; top: number; right: number; bottom: number } | null, kind: Box['kind']) => {
        const b = r && within(r, view);
        if (b) out.push({ ...b, kind });
      };
      if (focused) {
        const range = focused.bars ?? focused.audition;
        const tracks = focused.touchedTracks.length ? focused.touchedTracks : lanes.map((l) => (l as HTMLElement).dataset.lane!);
        for (const id of tracks) {
          const lane = laneOf(id);
          if (!lane) continue;
          add(focused.bars ? laneBars(lane, range.fromBar, range.toBar, zoom) : lane.getBoundingClientRect(), 'tint');
          // Its header too, which is always on screen (the bars may be scrolled out of view)
          const header = lane.previousElementSibling;
          if (header) add(header.getBoundingClientRect(), 'tint');
        }
      }
      let anchor: { left: number; top: number } | null = null;
      const h = highlight && highlight.until > Date.now() ? highlight : null;
      if (h) {
        const t = h.target;
        let r: { left: number; top: number; right: number; bottom: number } | null = null;
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
        add(r, 'ring');
        if (r) anchor = { left: Math.max(view.left, Math.min(r.left, view.right - 200)), top: Math.max(view.top, r.top) };
      }
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
      setNote(h?.note && anchor ? { text: h.note, ...anchor } : null);
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
          className={b.kind === 'ring' ? 'absolute rounded-md border-2 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.6)]' : 'absolute bg-cyan-400/10 border-y border-cyan-400/30'}
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
      {note && (
        <div className="absolute max-w-[200px] -translate-y-full rounded bg-forge-panel border border-cyan-400/60 px-2 py-1 text-[11px] text-forge-text whitespace-pre-wrap break-words" style={{ left: note.left, top: note.top - 4 }}>
          {note.text}
        </div>
      )}
    </div>
  );
};
