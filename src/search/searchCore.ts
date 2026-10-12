/**
 * Matching typed words against things to find (instruments, settings, guide sections). Every word
 * typed has to be found somewhere (so more words narrow the list), and where it's found decides the
 * order: in the name beats in the keywords, which beats in the description. One slip of the
 * fingers in a longer word is forgiven ("viloin" finds the violin), so is a missing space or hyphen
 * between words ("8bit", "buildup").
 */

export interface SearchFields {
  /** What it's called: the strongest match */
  title: string;
  /** Other words people might look for it by (genres, synonyms) */
  keywords?: string;
  /** A description, or a guide section's text: the weakest match */
  detail?: string;
}

/** Lower case, accents off, punctuation to spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const words = (text: string) => (text ? text.split(' ') : []);

/** True when a and b differ by at most one letter added, dropped, changed or swapped with its neighbour. */
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // A changed letter, or two neighbours swapped
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

interface Prepared {
  title: string;
  titleWords: string[];
  /** The title with its spaces taken out, so "8bit" finds "8 bit" */
  titleJoined: string;
  keywordWords: string[];
  detail: string;
  detailWords: string[];
}

const cache = new WeakMap<SearchFields, Prepared>();

function prepare(item: SearchFields): Prepared {
  let p = cache.get(item);
  if (!p) {
    const title = normalize(item.title);
    const keywords = normalize(item.keywords ?? '');
    const detail = normalize(item.detail ?? '');
    p = {
      title,
      titleWords: words(title),
      titleJoined: title.replace(/ /g, ''),
      keywordWords: words(keywords),
      detail,
      detailWords: words(detail),
    };
    cache.set(item, p);
  }
  return p;
}

/** How well one typed word matches, 0 for not at all. Forgiving a slip only when `fuzzy`. */
function wordScore(token: string, p: Prepared, fuzzy: boolean): number {
  fuzzy &&= token.length >= 4;
  let best = 0;
  for (const w of p.titleWords) {
    if (w === token) return 10;
    if (w.startsWith(token)) best = Math.max(best, 8);
    else if (fuzzy && (oneSlip(w, token) || oneSlip(w.slice(0, token.length), token))) best = Math.max(best, 5);
  }
  if (best < 6 && token.length >= 3 && (p.title.includes(token) || p.titleJoined.includes(token))) best = Math.max(best, 6);
  for (const w of p.keywordWords) {
    if (w === token) best = Math.max(best, 5);
    else if (w.startsWith(token)) best = Math.max(best, 4);
    else if (fuzzy && best < 3 && oneSlip(w, token)) best = 3;
  }
  // Also in the description: a little ahead of the rest of its group ("angelic" choir before pads)
  if (best >= 3) return p.detailWords.includes(token) ? best + 1 : best;
  for (const w of p.detailWords) {
    if (w === token) return 2;
    if (w.startsWith(token)) best = Math.max(best, 1.5);
  }
  if (!best && token.length >= 4 && p.detail.includes(token)) best = 0.75;
  return best;
}

/**
 * A score for how well `query` matches `item`: 0 when some typed word isn't found anywhere, more
 * the better the match. An empty query matches everything a little.
 */
export function matchScore(query: string, item: SearchFields, fuzzy = true): number {
  const q = normalize(query);
  if (!q) return 1;
  const p = prepare(item);
  let total = 0;
  for (const token of words(q)) {
    const s = wordScore(token, p, fuzzy);
    if (!s) {
      // "buildup" for "build up": try the typed word against the title with spaces taken out
      if (token.length >= 4 && p.titleJoined.includes(token)) {
        total += 6;
        continue;
      }
      return 0;
    }
    total += s;
  }
  // The whole query at the start of the name (or being the name) wins outright
  if (p.title === q) total += 30;
  else if (p.title.startsWith(q)) total += 15;
  else if (p.title.includes(q)) total += 5;
  return total;
}

/**
 * The items that match, best first (ties keep their order). Slips of the fingers are forgiven only
 * when nothing matches as typed, so "reverb" doesn't also bring up "Reverse Cymbal".
 */
export function rank<T>(items: readonly T[], query: string, fields: (item: T) => SearchFields): T[] {
  const score = (fuzzy: boolean) => items.map((item, i) => ({ item, i, score: matchScore(query, fields(item), fuzzy) })).filter((r) => r.score > 0);
  let found = score(false);
  if (!found.length) found = score(true);
  return found
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item);
}

/**
 * A short piece of `text` around the first place a typed word appears (for guide results), or
 * its start.
 */
export function snippet(text: string, query: string, length = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const token of words(normalize(query))) {
    if (token.length < 3) continue;
    at = lower.indexOf(token);
    if (at >= 0) break;
  }
  if (at < 0) return flat.length > length ? `${flat.slice(0, length).trimEnd()}…` : flat;
  const start = Math.max(0, at - Math.round(length / 3));
  const piece = flat.slice(start, start + length).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + length < flat.length ? '…' : ''}`;
}
