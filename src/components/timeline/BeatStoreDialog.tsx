/**
 * The beat-store export: one dialog that makes the package producers sell a beat with, as one
 * .zip: a tagged MP3 preview (the producer tag laid over it at the start and/or every N seconds),
 * the untagged WAV, the stems (track-outs), an optional cover image and a short info file, every
 * file named with the tempo and key. Built on the same renders as the Export dialog
 * (renderArrangement, renderStems), the tag pieces in beatPack.ts and the tag sound in producerTag.ts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Package, Upload, X } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore, masterFxOf } from '../../store/timelineStore';
import { detectKey, keyOf, NOTE_NAMES } from '../../store/songKey';
import { audibleTracks, channelsOf, cutRingOut, downloadBlob, encodeWav, exportCues, renderArrangement, renderStems, stemTracks, type RenderOptions } from '../../audio/exportWav';
import { encodeAudio } from '../../audio/encoders';
import { createZip, type ZipEntry } from '../../audio/zip';
import { formatDbtp, formatLufs, measureLoudness } from '../../audio/loudness';
import { LOUDNESS_TARGETS, reachTarget, targetById } from '../../audio/loudnessTarget';
import { exportCeilingDbtp, limitChannels } from '../../audio/effects/limiter';
import { beatFileBase, coverExtension, layTag, tagTimes } from '../../audio/beatPack';
import { producerTagChannels, producerTagSound, setProducerTag } from '../../audio/producerTag';
import { AUDIO_FILE_ACCEPT } from '../../audio/soundLibrary';
import { safeFileName } from '../../store/project';
import { showToast } from './toastStore';
import { maxOf } from '../../support/minMax';

const KEYS = NOTE_NAMES.flatMap((_, root) => (['minor', 'major'] as const).map((mode) => keyOf(root, mode).name));

interface Options {
  preview: boolean;
  wav: boolean;
  stems: boolean;
  tagAtStart: boolean;
  /** Seconds between tags after the first; 0: only at the start */
  tagEvery: number;
  tagDb: number;
  /** A loudness target id, or '' to keep the mix's level */
  target: string;
}

const DEFAULTS: Options = { preview: true, wav: true, stems: true, tagAtStart: true, tagEvery: 30, tagDb: 0, target: '' };
const OPTIONS_KEY = 'fledgetone.beatStore';

function loadOptions(): Options {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<Options>;
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    return {
      preview: bool(raw.preview, DEFAULTS.preview),
      wav: bool(raw.wav, DEFAULTS.wav),
      stems: bool(raw.stems, DEFAULTS.stems),
      tagAtStart: bool(raw.tagAtStart, DEFAULTS.tagAtStart),
      tagEvery: num(raw.tagEvery, DEFAULTS.tagEvery, 0, 120),
      tagDb: num(raw.tagDb, DEFAULTS.tagDb, -24, 6),
      target: typeof raw.target === 'string' && (raw.target === '' || LOUDNESS_TARGETS.some((t) => t.id === raw.target)) ? raw.target : DEFAULTS.target,
    };
  } catch {
    return DEFAULTS;
  }
}

type Status = { kind: 'idle'; error?: string } | { kind: 'busy'; what: string; progress: number };

export const BeatStoreDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const projectName = useTimelineStore((s) => s.projectName);
  const bpm = useTimelineStore((s) => s.bpm);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const detected = useMemo(() => detectKey(clips, tracks)?.name ?? null, [clips, tracks]);
  const [title, setTitle] = useState(projectName);
  const [key, setKey] = useState<string>(detected ?? '');
  const [opts, setOpts] = useState(loadOptions);
  const [tag, setTag] = useState(producerTagSound);
  const [cover, setCover] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const tagInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const coverUrl = useMemo(() => (cover ? URL.createObjectURL(cover) : null), [cover]);
  useEffect(() => () => void (coverUrl && URL.revokeObjectURL(coverUrl)), [coverUrl]);

  const set = (patch: Partial<Options>) => setOpts((o) => ({ ...o, ...patch }));
  const base = beatFileBase(title, bpm, key || null);
  const ids = new Set(audibleTracks(tracks).map((t) => t.id));
  const songEnd = maxOf(1, clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
  const empty = songEnd <= 1;
  const stemCount = stemTracks({ tracks, clips, startBar: 1, endBar: songEnd }).length;
  const nothing = !opts.preview && !opts.wav && !opts.stems;
  const previewNeedsTag = opts.preview && !tag;

  const build = async () => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts));
    } catch {
      // Not remembered (storage blocked)
    }
    const s = useTimelineStore.getState();
    s.pause();
    const controller = new AbortController();
    abort.current = controller;
    const step = (what: string, progress: number) => setStatus({ kind: 'busy', what, progress });
    // -1 dBTP for the WAV and the MP3 preview alike (the MP3 is held under it once decoded: encoders.ts)
    const ceiling = exportCeilingDbtp('mp3');
    try {
      const render: RenderOptions = {
        tracks: s.tracks,
        clips: s.clips,
        bpm: s.bpm,
        tempoPoints: s.tempoPoints,
        swing: s.swing,
        startBar: 1,
        endBar: songEnd,
        masterFx: masterFxOf(s),
        master: s.master,
        ending: 'ringOut',
        sampleRate: 44100,
        markers: s.markers,
        intensity: { value: s.intensity, curves: s.intensityCurves },
        peakCeilingDbtp: ceiling,
        keepRingOut: !!opts.target,
        signal: controller.signal,
      };
      const files: ZipEntry[] = [];
      let reading = null as Awaited<ReturnType<typeof measureLoudness>> | null;
      const wantMix = opts.preview || opts.wav;
      const stemsShare = opts.stems ? 0.5 : 0;
      if (wantMix) {
        let audio = await renderArrangement(render, (f) => step('Rendering the beat', f * (1 - stemsShare) * 0.8));
        reading = await measureLoudness(channelsOf(audio), audio.sampleRate, controller.signal);
        if (opts.target) {
          step('Matching the loudness', (1 - stemsShare) * 0.85);
          reading = (await reachTarget(channelsOf(audio), audio.sampleRate, reading, targetById(opts.target), controller.signal, ceiling)).reading;
          audio = cutRingOut(audio, render);
        }
        if (opts.wav) files.push({ name: `${base}.wav`, data: encodeWav(audio, 24, exportCues(render)) });
        if (opts.preview) {
          step('Tagging the preview', (1 - stemsShare) * 0.9);
          const preview = channelsOf(audio).map((ch) => ch.slice());
          const tagSound = await producerTagChannels(audio.sampleRate);
          if (tagSound) layTag(preview, audio.sampleRate, tagSound, tagTimes(audio.duration, tagSound[0].length / audio.sampleRate, { atStart: opts.tagAtStart, every: opts.tagEvery }), opts.tagDb);
          // The tag's peaks held under the ceiling too
          limitChannels(preview[0], preview[1] ?? preview[0], audio.sampleRate, ceiling);
          files.push({ name: `${base} (tagged preview).mp3`, data: await encodeAudio(preview, audio.sampleRate, 'mp3', { bitDepth: 16, signal: controller.signal }) });
        }
      }
      if (opts.stems) {
        const start = wantMix ? 1 - stemsShare : 0;
        const stems = await renderStems({ ...render, bypassMaster: true, keepRingOut: false }, 24, (f, stem) => step(`Stem ${stem.index + 1} of ${stem.count}: ${stem.track.name}`, start + f * (1 - start) * 0.95));
        const used = new Set<string>();
        for (const { track, wav } of stems) {
          let name = `${base} - ${safeFileName(track.name)}`;
          for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} - ${safeFileName(track.name)} ${n}`;
          used.add(name.toLowerCase());
          files.push({ name: `Stems/${name}.wav`, data: wav });
        }
      }
      if (cover) {
        const ext = coverExtension(cover.type, cover.name);
        if (ext) files.push({ name: `${base} - cover.${ext}`, data: cover });
      }
      const info = [
        title.trim() || 'Untitled',
        `Tempo: ${Math.round(s.bpm * 100) / 100} BPM`,
        `Key: ${key || 'not given'}`,
        reading ? `Loudness: ${formatLufs(reading.integrated)}, true peak ${formatDbtp(reading.truePeakMax)}` : null,
        opts.stems ? 'Stems: one WAV per track (24-bit, 44.1 kHz), all starting at bar 1, before the master compressor and limiter: they add up to the mix.' : null,
        '',
        'Made with Fledgetone.',
      ].filter((l) => l !== null);
      files.push({ name: `${base} - info.txt`, data: new Blob([info.join('\n')], { type: 'text/plain' }) });
      step('Packing the .zip', 0.98);
      controller.signal.throwIfAborted();
      downloadBlob(await createZip(files), `${base}.zip`);
      showToast(`Made ${base}.zip${reading ? `: ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}` : ''}`);
      onClose();
    } catch (err) {
      setStatus(controller.signal.aborted ? { kind: 'idle' } : { kind: 'idle', error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  if (status.kind === 'busy') {
    return (
      <Modal title="Beat store package" onClose={onClose}>
        <div className="flex items-center gap-2 text-forge-text">
          <Loader2 className="w-4 h-4 animate-spin text-violet-300" />
          <span className="min-w-0 truncate">{status.what}…</span>
        </div>
        <div className="h-1.5 rounded-full bg-forge-bg border border-forge-border overflow-hidden" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-violet-400" style={{ width: `${status.progress * 100}%` }} />
        </div>
        <button type="button" onClick={() => abort.current?.abort()} className="self-end h-8 px-3 rounded-md border border-forge-border text-xs font-mono hover:text-red-300">
          Cancel
        </button>
      </Modal>
    );
  }

  const check = (label: string, value: boolean, onChange: (v: boolean) => void, detail: string, testId?: string) => (
    <label className="flex items-start gap-2 cursor-pointer text-forge-text">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-violet-400" data-testid={testId} />
      <span>
        {label}
        <span className="block text-forge-muted">{detail}</span>
      </span>
    </label>
  );

  return (
    <Modal title="Beat store package" onClose={onClose}>
      <p>Everything a beat store or a buyer wants, in one .zip: a tagged preview to post, the clean WAV and the stems to deliver, all named with the tempo and key.</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-forge-muted">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 min-w-0 bg-forge-bg border border-forge-border rounded px-1.5 text-forge-text" />
        <span className="text-forge-muted">Key</span>
        <select value={key} onChange={(e) => setKey(e.target.value)} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text">
          <option value="">Leave out of the names</option>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
              {k === detected ? ' (from the notes)' : ''}
            </option>
          ))}
        </select>
        <span className="text-forge-muted">Loudness</span>
        <select value={opts.target} onChange={(e) => set({ target: e.target.value })} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text">
          <option value="">As mixed</option>
          {LOUDNESS_TARGETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <p className="font-mono text-[11px] text-violet-200 break-words">{base}</p>

      <div className="flex flex-col gap-2">
        {check('Tagged MP3 preview', opts.preview, (v) => set({ preview: v }), 'For the store page and socials: your producer tag over the beat, so it can’t be used without buying it.', 'beat-preview')}
        {opts.preview && (
          <div className="ml-6 flex flex-col gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/5 p-2">
            <input
              ref={tagInput}
              type="file"
              accept={AUDIO_FILE_ACCEPT}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  setTag(await setProducerTag(file));
                } catch (err) {
                  setStatus({ kind: 'idle', error: err instanceof Error ? err.message : String(err) });
                }
              }}
            />
            <div className="flex items-center gap-2">
              <span className="text-forge-muted shrink-0">Tag sound</span>
              <span className="flex-1 min-w-0 truncate text-forge-text">{tag ? tag.name : 'None yet'}</span>
              <button type="button" onClick={() => tagInput.current?.click()} className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border border-forge-border hover:text-white">
                <Upload className="w-3 h-3" />
                {tag ? 'Change' : 'Load'}
              </button>
              {tag && (
                <button type="button" title="Remove the tag" onClick={() => void setProducerTag(null).then(setTag)} className="shrink-0 text-forge-muted hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {tag ? (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={opts.tagAtStart} onChange={(e) => set({ tagAtStart: e.target.checked })} className="accent-violet-400" />
                  At the start
                </label>
                <label className="flex items-center gap-2">
                  Then every
                  <input type="number" min={0} max={120} step={5} value={opts.tagEvery} onChange={(e) => set({ tagEvery: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} className="w-14 h-6 bg-forge-bg border border-forge-border rounded px-1" />
                  seconds (0: never)
                </label>
                <label className="flex items-center gap-2">
                  Tag level
                  <input type="range" min={-18} max={6} step={0.5} value={opts.tagDb} onChange={(e) => set({ tagDb: Number(e.target.value) })} className="flex-1 accent-violet-400" />
                  <span className="w-12 text-right font-mono">{opts.tagDb > 0 ? '+' : ''}{opts.tagDb.toFixed(1)} dB</span>
                </label>
              </>
            ) : (
              <p className="text-amber-200">Load a short recording of your tag (your name or catchphrase). It's kept in this browser for next time. Without one the preview is untagged.</p>
            )}
          </div>
        )}
        {check('Untagged WAV', opts.wav, (v) => set({ wav: v }), '24-bit, 44.1 kHz: the full-quality beat for buyers.')}
        {check(
          `Stems (track-outs)${stemCount ? `: ${stemCount}` : ''}`,
          opts.stems,
          (v) => set({ stems: v }),
          'One 24-bit WAV per track, all starting at bar 1, before the master compressor and limiter, so they add up to the mix in any studio.'
        )}
        <div className="flex items-center gap-2">
          <input
            ref={coverInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file && coverExtension(file.type, file.name)) setCover(file);
            }}
          />
          {coverUrl ? <img src={coverUrl} alt="Cover" className="w-10 h-10 rounded object-cover border border-forge-border" /> : <ImageIcon className="w-5 h-5 text-forge-muted" />}
          <span className="flex-1 min-w-0 truncate text-forge-text">{cover ? cover.name : 'Cover image (optional)'}</span>
          <button type="button" onClick={() => coverInput.current?.click()} className="px-2 py-0.5 rounded border border-forge-border hover:text-white">
            {cover ? 'Change' : 'Add'}
          </button>
          {cover && (
            <button type="button" title="Remove the cover" onClick={() => setCover(null)} className="text-forge-muted hover:text-white">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {previewNeedsTag && <p className="text-amber-200">No tag sound yet: the preview will be the plain beat.</p>}
      {status.kind === 'idle' && status.error && <p className="text-red-400">It didn't work: {status.error}</p>}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-forge-border">
        <span className="min-w-0 truncate text-forge-muted">{base}.zip</span>
        <button
          type="button"
          data-testid="beat-store-make"
          disabled={empty || nothing}
          onClick={() => void build()}
          className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-violet-400/60 bg-violet-500/15 text-xs font-mono text-violet-100 hover:bg-violet-500/25 disabled:opacity-40"
        >
          <Package className="w-3.5 h-3.5" />
          Make the package
        </button>
      </div>
    </Modal>
  );
};
