/**
 * The beat-store package producers sell a beat with, as pure pieces (no Web Audio, so Node tests
 * them; BeatStoreDialog does the rendering): file names that carry the tempo and key, where a
 * producer tag plays in the preview (at the start and/or every N seconds), and laying the tag
 * over the beat with the beat dipped a little under it, so the tag is heard and the beat can't be
 * used without it.
 */

/** "Title - 140 BPM - A minor" (the key left out when unknown), safe as a file name. */
export function beatFileBase(title: string, bpm: number, key: string | null): string {
  const clean = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  const tempo = `${Math.round(bpm * 100) / 100} BPM`;
  const name = clean(title).slice(0, 60) || 'Untitled';
  return [name, tempo, key ? clean(key) : null].filter(Boolean).join(' - ');
}

/**
 * Where the tag plays, seconds into a preview `seconds` long: at `firstAt` if `atStart`, then every
 * `every` seconds after (0: only the first), never so late that it would run off the end.
 */
export function tagTimes(seconds: number, tagSeconds: number, opts: { atStart: boolean; every: number; firstAt?: number }): number[] {
  const first = opts.firstAt ?? 0.5;
  const times: number[] = [];
  if (opts.atStart) times.push(first);
  if (opts.every > 0) {
    const step = Math.max(opts.every, tagSeconds + 1);
    for (let t = opts.atStart ? first + step : Math.max(first, step); t + tagSeconds <= seconds; t += step) times.push(t);
  }
  return times.filter((t) => t + Math.min(tagSeconds, 0.5) <= seconds);
}

/**
 * Lay `tag` (one or two channels) over `beat` (changed in place) at each of `times` (seconds), at
 * `tagDb`, with the beat dipped by `duckDb` while the tag plays (in and out over 50 ms).
 */
export function layTag(beat: Float32Array[], sampleRate: number, tag: Float32Array[], times: readonly number[], tagDb = 0, duckDb = 4): void {
  const tagGain = 10 ** (tagDb / 20);
  const dip = 10 ** (-Math.max(0, duckDb) / 20);
  const n = beat[0].length;
  const len = tag[0].length;
  const ramp = Math.max(1, Math.round(0.05 * sampleRate));
  for (const t of times) {
    const at = Math.round(t * sampleRate);
    // The dip: down over `ramp` before the tag, back up over `ramp` after it
    const from = Math.max(0, at - ramp);
    const to = Math.min(n, at + len + ramp);
    for (let i = from; i < to; i++) {
      const into = Math.min(1, (i - (at - ramp)) / ramp);
      const out = Math.min(1, (at + len + ramp - i) / ramp);
      const g = 1 - (1 - dip) * Math.max(0, Math.min(into, out));
      for (const ch of beat) ch[i] *= g;
    }
    for (let c = 0; c < beat.length; c++) {
      const src = tag[Math.min(c, tag.length - 1)];
      const dst = beat[c];
      for (let i = 0; i < len && at + i < n; i++) if (at + i >= 0) dst[at + i] += src[i] * tagGain;
    }
  }
}

/** The file extension for a cover image's type (jpg, png or webp), or null for one that isn't an image we take. */
export function coverExtension(type: string, name = ''): string | null {
  const t = type.toLowerCase();
  if (t === 'image/jpeg' || /\.jpe?g$/i.test(name)) return 'jpg';
  if (t === 'image/png' || /\.png$/i.test(name)) return 'png';
  if (t === 'image/webp' || /\.webp$/i.test(name)) return 'webp';
  return null;
}
