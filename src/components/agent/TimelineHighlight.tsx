/**
 * What the timeline shows of the agent: the bars of the tracks a suggestion changes, tinted while
 * its card has the pointer or focus or its before-and-after plays (with a mark at the lanes' left
 * edge, so the tracks show even with those bars scrolled away), and what the agent points at
 * (point_at: a track, a clip, some bars or a marker), ringed for a few seconds with its note
 * (marked "From your agent (name)" and quoted, as on the panel, so it never reads as the app's own).
 * Drawn over the lanes only (never the track headers, the ruler or anything outside the timeline)
 * from where the lanes and clips are on screen (found by their data-lane and data-clip-id
 * attributes), so the timeline itself doesn't change; it follows scrolling and zoom while it
 * shows, and takes no clicks. Screen readers hear of a highlight from the agent's live region.
 */
import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useSuggestions } from '../../agent/suggestionsStore';
import { useAudition } from '../../audio/auditionPlayer';
import { fromYourAgent } from './words';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: 'tint' | 'ring' | 'edge';
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
  const agent = useSuggestions((s) => s.connection.agent);
  const focusId = useSuggestions((s) => s.focusId);
  const auditionKey = useAudition((s) => (s.phase !== 'idle' ? s.key : null));
  // (one made for another song has nothing to show in this one)
  const focused = useSuggestions((s) => s.suggestions.find((x) => x.id === (focusId ?? auditionKey) && x.status !== 'other_song') ?? null);
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
      // The lanes' part of the timeline: right of the track headers, under the ruler
      const whole = scroll.getBoundingClientRect();
      const ruler = scroll.querySelector('[data-timeline-ruler]');
      const rr = ruler?.getBoundingClientRect();
      const corner = ruler?.firstElementChild?.getBoundingClientRect();
      const view = new DOMRect(corner ? corner.right : whole.left, rr ? Math.max(whole.top, rr.bottom) : whole.top, 0, 0);
      view.width = Math.max(0, whole.right - view.left);
      view.height = Math.max(0, whole.bottom - view.top);
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
          // A mark at the lanes' left edge, always in view (the bars may be scrolled away)
          const lr = lane.getBoundingClientRect();
          add({ left: view.left, right: view.left + 4, top: lr.top, bottom: lr.bottom }, 'edge');
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
        // The note sits inside the lanes, at the top left of what it's about
        if (r) anchor = { left: Math.max(view.left + 4, Math.min(r.left + 4, view.right - 204)), top: Math.max(view.top + 4, Math.min(r.top + 4, view.bottom - 56)) };
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
          className={
            b.kind === 'ring' ? 'absolute rounded-md border-2 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.6)]' : b.kind === 'edge' ? 'absolute bg-cyan-400/70' : 'absolute bg-cyan-400/10 border-y border-cyan-400/30'
          }
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
      {note && (
        <div className="absolute max-w-[200px] rounded bg-forge-panel border border-cyan-400/60 px-2 py-1" style={{ left: note.left, top: note.top - 4 }} data-agent-note="">
          <p className="text-[9px] font-mono uppercase tracking-wider text-forge-muted">{fromYourAgent(agent)}</p>
          <p className="text-[11px] text-forge-text whitespace-pre-wrap break-words">“{note.text}”</p>
        </div>
      )}
    </div>
  );
};
