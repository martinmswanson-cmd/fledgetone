/** Words the Suggestions panel and its cards share. */
import type { Suggestion } from '../../agent/suggestionsStore';

/** "From your agent (name)" or "From your agent". */
export const fromYourAgent = (name?: string): string => `From your agent${name ? ` (${name})` : ''}`;

/** Where a suggestion is, in words. */
export const STATUS_WORDS: Record<Suggestion['status'], string> = {
  waiting: 'waiting for you',
  changed: 'the song changed since it was suggested',
  out_of_date: 'out of date',
  other_song: 'made for another song',
  accepted: 'accepted (Undo takes it out)',
  undone: 'undone',
  dismissed: 'dismissed',
  withdrawn: 'withdrawn by your agent',
};

/** A loudness difference in plain words: "about as loud", "about 2 dB louder". */
export function louderWords(diff: number): string {
  const db = Math.round(Math.abs(diff));
  if (db < 1) return 'about as loud as the song now';
  return `about ${db} dB ${diff > 0 ? 'louder' : 'quieter'} (in loudness)`;
}
