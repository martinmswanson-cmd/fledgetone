/** Words the Suggestions panel and its cards share. */
import type { Suggestion } from '../../agent/suggestionsStore';
import type { OwnMessage } from '../../agent/conversation';

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

/** Where the musician's message is, in words. */
export function deliveryWords(m: Pick<OwnMessage, 'status' | 'reason'>): string {
  switch (m.status) {
    case 'sending':
      return 'Sending…';
    case 'sent':
      return 'Sent';
    case 'seen':
      return 'Seen by your agent';
    case 'not_sent':
      return `Not sent — ${m.reason ?? 'the agent isn’t connected'}`;
  }
}

