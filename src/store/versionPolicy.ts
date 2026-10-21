/**
 * The rules for a song's kept versions (versions.ts keeps them): when the next one is due while
 * editing, which old ones to thin out, and how a version's time reads in the list ("10 min ago",
 * "yesterday 14:02"). Pure, so it's tested on its own.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** While editing, a new version at most this often. */
export const VERSION_EVERY_MS = 2 * MINUTE;
/** At most this many versions kept, all songs together */
export const MAX_VERSIONS = 300;
/** And at most this much stored (the songs themselves, not their sounds) */
export const MAX_VERSION_BYTES = 40 * 1024 * 1024;

/** What thinning needs to know about a version. */
export interface VersionStamp {
  id: string;
  songId: string;
  savedAt: number;
  bytes: number;
}

/** Whether editing has gone on long enough since the last version (null: none yet this visit) for another. */
export function versionDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= VERSION_EVERY_MS;
}

/**
 * The versions to let go, so the list stays useful and small. For each song: every version from
 * the last hour; then one per 10 minutes for a day; then one per day for 30 days (the newest in
 * each stretch); and older ones go, except each song's newest version, kept however old (a song
 * New or Open replaced may be nowhere else). Then, over the count or size cap, the oldest go first,
 * the songs' newest versions last of all, and the newest version of all always stays.
 */
export function versionsToDrop(versions: readonly VersionStamp[], now: number, caps = { count: MAX_VERSIONS, bytes: MAX_VERSION_BYTES }): string[] {
  const drop = new Set<string>();
  const newestOfSong = new Set<string>();
  const bySong = new Map<string, VersionStamp[]>();
  for (const v of versions) bySong.set(v.songId, [...(bySong.get(v.songId) ?? []), v]);
  for (const list of bySong.values()) {
    const sorted = [...list].sort((a, b) => b.savedAt - a.savedAt);
    newestOfSong.add(sorted[0].id);
    const seen = new Set<string>();
    for (const v of sorted) {
      const age = Math.max(0, now - v.savedAt);
      if (age < HOUR || v.id === sorted[0].id) continue;
      // (Stretches counted back from now, so a version moves into a wider one as it ages)
      const stretch = age < DAY ? `m${Math.floor(age / (10 * MINUTE))}` : age < 30 * DAY ? `d${Math.floor(age / DAY)}` : null;
      if (stretch === null || seen.has(stretch)) drop.add(v.id);
      else seen.add(stretch);
    }
  }

  // Over the caps: oldest first, each song's newest last
  const kept = versions.filter((v) => !drop.has(v.id));
  let count = kept.length;
  let bytes = kept.reduce((sum, v) => sum + v.bytes, 0);
  if (count <= caps.count && bytes <= caps.bytes) return [...drop];
  const newestOfAll = kept.reduce<VersionStamp | null>((best, v) => (!best || v.savedAt > best.savedAt ? v : best), null);
  const order = [...kept].sort((a, b) => Number(newestOfSong.has(a.id)) - Number(newestOfSong.has(b.id)) || a.savedAt - b.savedAt);
  for (const v of order) {
    if (count <= caps.count && bytes <= caps.bytes) break;
    if (v === newestOfAll) continue;
    drop.add(v.id);
    count--;
    bytes -= v.bytes;
  }
  return [...drop];
}

const two = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Midnight (local time) of the day `t` is in. */
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * When a version was kept, as the list says it: "just now", "10 min ago", "2 h ago" (the last few
 * hours, today), "today 09:15", "yesterday 14:02", "Mon 14:02" (this week), "12 Oct 14:02", and
 * the year too for an earlier year.
 */
export function versionWhen(t: number, now: number): string {
  const ago = now - t;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  const d = new Date(t);
  const days = Math.round((dayStart(now) - dayStart(t)) / DAY);
  if (days === 0) return ago < 3 * HOUR ? `${Math.floor(ago / HOUR)} h ago` : `today ${clock(d)}`;
  if (days === 1) return `yesterday ${clock(d)}`;
  if (days > 1 && days < 7) return `${DAYS[d.getDay()]} ${clock(d)}`;
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${clock(d)}`;
}
