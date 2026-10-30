/**
 * The studio's answers to the agent's reading requests, built from the song alone: get_song (the
 * AgentSong), get_notes, get_automation and preview_suggestion (the ops tried on a copy: what they
 * would change, nothing applied). The studio passes a function giving its song now and its
 * revision; the command line uses the same functions on a file. The other requests (suggest,
 * listen, say, point_at, get_view...) need the studio's screen and sound, so the studio answers
 * them itself.
 */
import type { ProjectSnapshot } from '../store/project';
import { agentAutomation, agentNotes, toAgentSong } from './agentSong';
import { applyOps, OPS_VERSION } from './ops';
import { cleanForAgent } from './agentText';
import { HandlerError, type Handler } from './bridgeProtocolClient';
import type { StudioMethod } from './protocol';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** What a dry run of some ops tells an agent. */
export function previewOps(song: ProjectSnapshot, ops: unknown, idBase = 'preview') {
  const out = applyOps(song, { opsVersion: OPS_VERSION, ops }, { idBase });
  // (the changes and warnings name tracks and clips: as plain as the song summary has them)
  if (!out.ok) return cleanForAgent({ ok: false as const, errors: out.errors });
  return cleanForAgent({ ok: true as const, changes: out.diff.changes.map((c) => c.text), warnings: out.warnings, notes: out.notes, regions: out.diff.regions, audition: out.diff.audition, refs: out.refs, stats: out.stats });
}

/** The reading handlers, for the studio's bridge client. */
export function songReadHandlers(source: { song: () => ProjectSnapshot; revision: () => number; appVersion: string }): Partial<Record<StudioMethod, Handler>> {
  return {
    get_song: () => toAgentSong(source.song(), { revision: source.revision(), appVersion: source.appVersion }),
    get_notes: (p) => ({ revision: source.revision(), ...agentNotes(source.song(), { trackId: str(p.trackId), clipId: str(p.clipId), fromBar: num(p.fromBar), toBar: num(p.toBar), cursor: str(p.cursor), limit: num(p.limit) }) }),
    get_automation: (p) => ({ revision: source.revision(), lanes: agentAutomation(source.song(), { trackId: str(p.trackId), param: str(p.param) }) }),
    preview_suggestion: (p) => {
      if (!Array.isArray(p.ops)) throw new HandlerError('bad_request', 'preview_suggestion needs "ops", a list of ops.');
      return { revision: source.revision(), ...previewOps(source.song(), p.ops) };
    },
  };
}
