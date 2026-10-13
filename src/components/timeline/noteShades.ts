/**
 * A clip's note marks on the timeline as one SVG path per shade (velocity), instead of an element
 * per note.
 */
/** A note's mark in a clip on the timeline, in px from the clip's top left. */
export interface NoteRect {
  left: number;
  width: number;
  top: number;
  height: number;
  /** 0.45 to 1, from the note's velocity */
  opacity: number;
}

/** Note marks that share a shade, as one SVG path. */
export interface NoteShade {
  opacity: number;
  d: string;
}

/**
 * The note marks as one SVG path per shade (velocity), not an element per note: a dense clip has
 * hundreds of notes, and each element needed its style worked out when the clip came on screen. A
 * page turn of a dense song (a thousand notes coming into view) spent about 50 ms on that alone,
 * on the main thread, while playback was starting.
 */
export function shadeNotes(notes: NoteRect[]): NoteShade[] {
  const paths = new Map<number, string[]>();
  for (const n of notes) {
    // Hundredths of opacity are as fine as anyone can see, and keep the paths few
    const opacity = Math.round(n.opacity * 100) / 100;
    let list = paths.get(opacity);
    if (!list) paths.set(opacity, (list = []));
    // On whole pixels (at least one), as the browser drew each note's own element, so the edges stay sharp
    const x = Math.round(n.left);
    const y = Math.round(n.top);
    list.push(`M${x} ${y}H${Math.max(x + 1, Math.round(n.left + n.width))}V${Math.max(y + 1, Math.round(n.top + n.height))}H${x}z`);
  }
  return [...paths].map(([opacity, parts]) => ({ opacity, d: parts.join('') }));
}
