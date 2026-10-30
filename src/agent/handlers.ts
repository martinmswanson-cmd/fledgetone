/**
 * The studio's answers to the agent's requests, for the bridge client (see protocol.ts for which
 * permission each needs; the client checks those). The reading ones come from studioReads.ts on
 * the song as it is now; here: suggest (onto the Suggestions panel, after its ops are tried), get
 * and withdraw a suggestion, listen (a stretch rendered and measured, the song or a suggestion of
 * it), say (a message on the panel, maybe a reply to one of the musician's), point_at (a highlight
 * on the timeline, or a control rung as the search does, with the agent's note by it) and get_view
 * (what's open and selected). Things are named by the ids the agent reads (agentIds). An agent
 * has only the suggestions made in its own connection: one paired later doesn't see, withdraw or
 * listen to another's. Each keeps to the limits in LIMITS: a suggestion every 3 seconds and five
 * waiting, one listen at a time and ten a minute, a message or a highlight a second.
 */
import { currentProject, songTempo, useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { barToSeconds } from '../audio/tempoMap';
import { measureRender, renderRange } from '../audio/listen';
import { listenSnapshot } from './listenSnapshot';
import type { MasterStats } from '../audio/effects/masterAfter';
import { ring } from '../search/reveal';
import { APP_VERSION } from '../version';
import { HandlerError, type Handler } from './bridgeProtocolClient';
import { CONVERSATION, fromAgent, LIMITS, RateLimiter, type StudioMethod } from './protocol';
import { setDelivery, useConversation } from './conversation';
import { songReadHandlers } from './studioReads';
import { agentIdOf, byAgentId, cleanForAgent } from './agentText';
import { applyOps, OPS_VERSION } from './ops';
import { announce, freshen, hearingAsFound, hearingByRules, isOpen, keepSuggestions, notFoundWords, shortText, makeSuggestion, uncheckedTail, updateSuggestion, useSuggestions, waitingCount, type Suggestion } from './suggestionsStore';
import { songContext } from './songWatch';
import { forgetAudition } from '../audio/auditionPlayer';
import { queueFinding, stopFinding, useFinding } from './whereHeard';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

/**
 * A suggestion as the agent reads it back. Where it's heard by sound (the whole song rendered
 * before and after) only with Listen allowed: without it, only the rules' regions and what a
 * before-and-after of those plays (hearingByRules), never a bar the renders found.
 */
const view = (s: Suggestion) => {
  const listen = useSuggestions.getState().permissions.listen;
  const by = listen ? hearingAsFound(s) : hearingByRules(s, currentProject());
  const finding = useFinding.getState().id === s.id && useFinding.getState().version === s.version;
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    heard: s.heard !== null && s.heard === s.version,
    changes: s.changes,
    warnings: s.warnings,
    notes: s.notes,
    // Where its changes are heard, what its before-and-after plays (one stretch after another), and what that leaves out
    regions: by.regions,
    // How they were found: by the rules alone, or by the rules and by sound (the song rendered whole before and after, bar against bar)
    regionsBy: by.found === 'sound' ? 'rules and sound' : 'rules',
    ...(by.found === 'sound' ? { soundRegions: s.soundRegions ?? [] } : finding ? { finding: true } : s.foundWhy ? { notBySound: notFoundWords(s.foundWhy), ...(uncheckedTail(s) ? { mayRingOn: true } : {}) } : {}),
    audition: by.audition,
    ...(by.unheard ? { unheard: by.unheard, limit: by.limit === 'bars' ? `${LIMITS.listenMaxBars} bars` : `${LIMITS.listenMaxSeconds} seconds` } : {}),
    ...(by.focusLeftOut ? { focusLeftOut: true } : {}),
    ...(s.outOfDate ? { outOfDate: s.outOfDate } : {}),
  };
};

/** What's selected, by the ids the agent reads (agentIds: the same as get_song's). */
export function viewSelection(s: Pick<ReturnType<typeof useTimelineStore.getState>, 'tracks' | 'clips' | 'selectedTrackId' | 'editingClipId'>) {
  const track = agentIdOf(s.tracks);
  const clip = agentIdOf(s.clips);
  return {
    selectedTrackId: s.selectedTrackId === null ? null : track(s.selectedTrackId),
    selectedClipIds: s.clips.filter((c) => c.isSelected).map((c) => clip(c.id)),
    editingClipId: s.editingClipId === null ? null : clip(s.editingClipId),
  };
}

/** A selector for a control by its name: its search words, its label or its title. */
export function controlSelector(name: string): string {
  const q = name.replace(/["\\]/g, '').trim().slice(0, 60);
  return [`[data-search~="${q.toLowerCase()}"]`, `[data-search*="${q.toLowerCase()}"]`, `[aria-label="${q}" i]`, `[aria-label^="${q}" i]`, `[title^="${q}" i]`].join(', ');
}

/**
 * The studio's handlers, each answer made plain for the agent (cleanForAgent: the names of the
 * song's tracks and clips in a listen's tracks, a suggestion's changes and why it's out of date
 * hold no hidden text).
 */
export function studioHandlers(): Partial<Record<StudioMethod, Handler>> {
  const out: Partial<Record<StudioMethod, Handler>> = {};
  for (const [method, handler] of Object.entries(handlersAsTheyAre()) as Array<[StudioMethod, Handler]>) {
    out[method] = (params, ctx) => {
      const r = handler(params, ctx);
      return r instanceof Promise ? r.then(cleanForAgent) : cleanForAgent(r);
    };
  }
  return out;
}

/** The handlers the studio adds to the reading ones. */
function handlersAsTheyAre(): Partial<Record<StudioMethod, Handler>> {
  const suggestRate = new RateLimiter(1, LIMITS.suggestEveryMs);
  const listenRate = new RateLimiter(LIMITS.listensPerMinute, 60_000);
  const sayRate = new RateLimiter(1, LIMITS.sayEveryMs);
  const pointRate = new RateLimiter(1, LIMITS.pointAtEveryMs);
  let listening = false;
  const slow = (r: RateLimiter, what: string) => {
    const wait = r.take();
    if (wait) throw new HandlerError('too_fast', `Too many ${what}: try again in ${Math.ceil(wait / 100) / 10} seconds.`);
  };
  // An agent has only the suggestions it made in this connection: a newly paired one doesn't see
  // (or withdraw, or listen to) another's, nor do they count against how many it may have waiting
  const mine = () => {
    const connection = useConversation.getState().connection;
    return useSuggestions.getState().suggestions.filter((x) => x.connection === connection);
  };
  const find = (id: unknown) => {
    const s = mine().find((x) => x.id === id);
    if (!s) throw new HandlerError('not_found', 'There is no suggestion with that id.');
    return s;
  };

  return {
    ...songReadHandlers({ song: currentProject, revision: () => useSuggestions.getState().revision, appVersion: APP_VERSION }),

    suggest: (p) => {
      if (waitingCount(mine()) >= LIMITS.waitingSuggestions) throw new HandlerError('too_many', `${LIMITS.waitingSuggestions} suggestions are already waiting for the musician.`);
      if (!Array.isArray(p.ops)) throw new HandlerError('bad_request', 'A suggestion needs "ops", a list of ops.');
      slow(suggestRate, 'suggestions');
      const made = makeSuggestion(currentProject(), songContext(), { title: p.title, explanation: p.explanation, ops: p.ops, focus: p.focus }, undefined, undefined, useConversation.getState().connection, useSuggestions.getState().connection.agent);
      if (!made.ok) throw new HandlerError('bad_ops', made.message, { errors: made.errors });
      // Added at the end (what's on the panel doesn't move), and only counted on the header's
      // button: the panel isn't opened for it, nor is anything focused or applied
      useSuggestions.setState((x) => ({ suggestions: keepSuggestions([...x.suggestions, made.suggestion]) }));
      // (where it's heard is found by sound in the background, before it's heard)
      queueFinding();
      announce(`New suggestion from your agent: ${shortText(made.suggestion.title)}.`);
      return view(made.suggestion);
    },

    get_suggestion: (p) => {
      if (p.id !== undefined) return view(find(p.id));
      return { suggestions: mine().map(view) };
    },

    withdraw_suggestion: (p) => {
      const s = find(p.id);
      if (!isOpen(s) && s.status !== 'out_of_date') throw new HandlerError('not_waiting', `That suggestion is ${s.status.replace('_', ' ')}.`);
      updateSuggestion(s.id, { status: 'withdrawn' });
      forgetAudition(s.id);
      stopFinding(s.id);
      return view({ ...s, status: 'withdrawn' });
    },

    listen: async (p) => {
      const fromBar = num(p.fromBar);
      const toBar = num(p.toBar);
      if (fromBar === undefined || toBar === undefined || fromBar < 1 || toBar <= fromBar) throw new HandlerError('bad_request', 'listen needs fromBar and toBar (song bars, toBar after fromBar).');
      if (toBar - fromBar > LIMITS.listenMaxBars) throw new HandlerError('too_long', `At most ${LIMITS.listenMaxBars} bars at a time.`);
      let song = currentProject();
      let what = 'the song as it is';
      if (p.suggestionId !== undefined) {
        const s = freshen(find(p.suggestionId), song, songContext());
        updateSuggestion(s.id, s);
        if (s.status === 'other_song') throw new HandlerError('not_waiting', 'That suggestion was made for another song: the musician opened another since.');
        song = s.song;
        what = 'the song with the suggestion';
      } else if (Array.isArray(p.ops)) {
        const out = applyOps(song, { opsVersion: OPS_VERSION, ops: p.ops }, { idBase: 'listen' });
        if (!out.ok) throw new HandlerError('bad_ops', `The ops can't be applied: ${out.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`, { errors: out.errors });
        song = out.song;
        what = 'the song with those ops';
      }
      const tempo = songTempo({ bpm: song.bpm, tempoPoints: song.tempoPoints ?? [] });
      if (barToSeconds(toBar, tempo) - barToSeconds(fromBar, tempo) > LIMITS.listenMaxSeconds) throw new HandlerError('too_long', `At most ${LIMITS.listenMaxSeconds} seconds at a time.`);
      if (listening) throw new HandlerError('busy', 'One listen at a time.');
      // (rendering while the song plays could make it stutter)
      const t = useTimelineStore.getState();
      if (t.isPlaying || t.loadingToPlay) throw new HandlerError('busy', 'The song is playing; ask again when it stops.');
      slow(listenRate, 'listens');
      listening = true;
      // Play pressed meanwhile: the render stops at once (the song's own playback comes first) and the agent hears busy
      const stop = new AbortController();
      const unwatch = useTimelineStore.subscribe((st) => (st.isPlaying || st.loadingToPlay) && stop.abort('playing'));
      // "Listen" unticked, or the connection gone, meanwhile: the render stops too, and nothing of it goes
      const unwatchAllowed = useSuggestions.subscribe(
        (st, prev) => ((prev.permissions.listen && !st.permissions.listen) || (prev.connection.state === 'paired' && st.connection.state !== 'paired')) && stop.abort('not_allowed')
      );
      try {
        let stats: MasterStats | undefined;
        const audio = await renderRange(listenSnapshot(song), fromBar, toBar, { signal: stop.signal, onMasterStats: (s) => (stats = s) });
        const m = await measureRender(audio, stop.signal);
        const findings: string[] = [];
        if (m.truePeakDbtp > -1) findings.push(`The true peak reaches ${m.truePeakDbtp.toFixed(1)} dBTP: over -1, it may distort when it's turned into an MP3.`);
        if (stats && stats.limiterPeakDb > 3) findings.push(`The master limiter takes up to ${stats.limiterPeakDb.toFixed(1)} dB off the peaks.`);
        if (stats?.clipper && stats.clipper.peakDb > 3) findings.push(`The master clipper takes up to ${stats.clipper.peakDb.toFixed(1)} dB off the peaks.`);
        if (!Number.isFinite(m.lufs)) findings.push('It is silent.');
        const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
        return {
          range: { fromBar, toBar },
          heard: what,
          renderMode: 'playback',
          mix: {
            lufs: finite(m.lufs),
            shortTermMaxLufs: finite(m.shortTermMaxLufs),
            truePeakDbtp: finite(m.truePeakDbtp),
            crestDb: finite(m.crestDb),
            regions: m.regions,
            master: { limiterMaxGrDb: stats ? finite(stats.limiterPeakDb) : null, clipperMaxDb: stats?.clipper ? finite(stats.clipper.peakDb) : null },
          },
          findings,
        };
      } catch (err) {
        if (stop.signal.aborted && stop.signal.reason === 'not_allowed') throw new HandlerError('not_allowed', 'The musician stopped allowing the agent to listen, so listening stopped.');
        if (stop.signal.aborted) throw new HandlerError('busy', 'The song started playing, so listening stopped; ask again when it stops.');
        throw err;
      } finally {
        unwatch();
        unwatchAllowed();
        listening = false;
      }
    },

    say: (p) => {
      const text = fromAgent(p.text, LIMITS.sayMaxChars);
      if (!text) throw new HandlerError('bad_request', 'say needs some text.');
      // A reply names one of the musician's messages (that the agent has, so it has read it)
      const replyTo = str(p.replyTo, 64);
      const conv = useConversation.getState();
      if (replyTo && !conv.mine.some((m) => m.id === replyTo && m.connection === conv.connection && m.status !== 'not_sent')) throw new HandlerError('not_found', 'There is no message from the musician with that id (replyTo).');
      slow(sayRate, 'messages');
      const msg = { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, ...(str(p.about, 40) ? { about: str(p.about, 40)! } : {}), ...(replyTo ? { replyTo } : {}), connection: conv.connection, ...(useSuggestions.getState().connection.agent ? { agent: useSuggestions.getState().connection.agent } : {}), at: Date.now() };
      useSuggestions.setState((x) => ({ messages: [...x.messages, msg].slice(-CONVERSATION.keep) }));
      if (replyTo) setDelivery([replyTo], 'seen');
      announce(`${replyTo ? 'Your agent replied' : 'Your agent sent a message'}: ${shortText(text)}`);
      return { ok: true, id: msg.id };
    },

    point_at: async (p) => {
      const t = (typeof p.target === 'object' && p.target ? p.target : {}) as Record<string, unknown>;
      const given = ['track', 'clip', 'bars', 'marker', 'control'].filter((k) => t[k] !== undefined);
      if (given.length !== 1) throw new HandlerError('bad_request', 'Point at exactly one thing: track, clip, bars, marker or control.');
      slow(pointRate, 'highlights');
      const note = fromAgent(p.note, 200) || undefined;
      const s = useTimelineStore.getState();
      const target: NonNullable<ReturnType<typeof useSuggestions.getState>['highlight']>['target'] = {};
      // (each by the id the agent reads, as get_song gives it)
      if (t.track !== undefined) {
        const track = byAgentId(s.tracks, String(t.track));
        if (!track) throw new HandlerError('not_found', 'There is no track with that id.');
        target.track = track.id;
      } else if (t.clip !== undefined) {
        const clip = byAgentId(s.clips, String(t.clip));
        if (!clip) throw new HandlerError('not_found', 'There is no clip with that id.');
        target.clip = clip.id;
      } else if (t.marker !== undefined) {
        const marker = byAgentId(s.markers, String(t.marker));
        if (!marker) throw new HandlerError('not_found', 'There is no marker with that id.');
        target.marker = marker.id;
      } else if (t.bars !== undefined) {
        const b = t.bars as Record<string, unknown>;
        const from = num(b.fromBar);
        const to = num(b.toBar);
        if (from === undefined || to === undefined || to <= from) throw new HandlerError('bad_request', 'bars needs fromBar and toBar.');
        target.bars = { fromBar: from, toBar: to };
      } else {
        const name = str(t.control, 60);
        if (!name) throw new HandlerError('bad_request', 'control needs a name.');
        // Rung where it is, as the search palette does, but never focused: the keyboard stays where
        // the musician left it. The agent's ring and note go next to it, so it reads as the agent's
        const found = await ring(controlSelector(name));
        if (!found) throw new HandlerError('not_found', `No control called "${name}" is on screen.`);
        // (named as the studio names it, else as the agent did)
        const label = (found.getAttribute('aria-label') || found.getAttribute('title') || found.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) || fromAgent(name, 60);
        useSuggestions.setState({ highlight: { target: { control: label }, element: found, ...(note ? { note } : {}), until: Date.now() + 6000 } });
        announce(`Your agent points at the control “${shortText(label, 40)}”${note ? `, saying “${shortText(note)}”` : '.'}`);
        return { ok: true, shown: 'control' };
      }
      const what = target.track ? 'a track' : target.clip ? 'a clip' : target.marker ? 'a marker' : 'some bars';
      useSuggestions.setState({ highlight: { target, ...(note ? { note } : {}), until: Date.now() + 6000 } });
      announce(`Your agent points at ${what} on the timeline${note ? `, saying “${shortText(note)}”` : '.'}`);
      return { ok: true, shown: given[0] };
    },

    get_view: () => {
      const s = useTimelineStore.getState();
      const u = useUiStore.getState();
      const from = 1 + s.viewLeft / s.zoom;
      return {
        playheadBar: Math.round(s.playheadPosition * 1000) / 1000,
        playing: s.isPlaying,
        loop: { inBar: s.loopRegion.inBar, outBar: s.loopRegion.outBar, on: s.loopRegion.enabled },
        ...viewSelection(s),
        visibleBars: { fromBar: Math.round(from * 100) / 100, toBar: Math.round((from + s.viewWidth / s.zoom) * 100) / 100 },
        panel: u.dockOpen ? u.dockTab : null,
      };
    },
  };
}
