/**
 * The reference track panel (Master tab): load a finished song, hear it at the mix's loudness with
 * one A/B switch, and see where the mix's tonal balance differs from it on a spectrum overlay.
 * The reference stays in this browser (referenceTrack.ts); it's never saved or exported.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Headphones, Loader2, Upload, X } from 'lucide-react';
import { clearReference, hear, loadReferenceFile, referenceMatchDb, restoreReference, toggleReference, useReference } from '../../audio/referenceTrack';
import { analyseMix, cancelMixRender, useMixStudio } from '../../audio/mixStudio';
import { compareSpectra, totalBands, type BandSpectrum } from '../../audio/mixAnalysis';
import { AUDIO_FILE_ACCEPT } from '../../audio/soundLibrary';
import { formatLufs } from '../../audio/loudness';

const W = 260;
const H = 96;
const LO = 30;
const HI = 16000;
const xOf = (f: number) => (Math.log(f / LO) / Math.log(HI / LO)) * W;

/** A band spectrum as an SVG path, `top` dB at the top and 48 dB below at the bottom. */
function pathOf(spectrum: BandSpectrum, levels: number[], top: number): string {
  const pts = spectrum.freqs
    .map((f, i) => [f, levels[i]] as const)
    .filter(([f, v]) => f >= LO && f <= HI && Number.isFinite(v))
    .map(([f, v]) => `${xOf(f).toFixed(1)},${Math.max(0, Math.min(H, ((top - v) / 48) * H)).toFixed(1)}`);
  return pts.length ? `M${pts.join('L')}` : '';
}

/** Mix and reference spectra over each other, smoothed (third-octave), the reference at the mix's level. */
const Overlay: React.FC<{ mix: BandSpectrum; reference: BandSpectrum; offsetDb: number }> = ({ mix, reference, offsetDb }) => {
  const smooth = (xs: number[]) => xs.map((_, i) => {
    const w = [xs[i - 1], xs[i], xs[i + 1]].filter((v) => v !== undefined && Number.isFinite(v)) as number[];
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const m = smooth(totalBands(mix));
  const r = smooth(totalBands(reference).map((v) => v + offsetDb));
  const top = Math.max(...m.filter(Number.isFinite), ...r.filter(Number.isFinite)) + 3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24 bg-black/40 rounded border border-forge-border" role="img" aria-label="Spectrum of the mix and the reference">
      {[100, 1000, 10000].map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} stroke="currentColor" className="text-forge-border" strokeWidth={0.5} />
          <text x={xOf(f) + 2} y={H - 3} fontSize={7} className="fill-forge-muted">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      <path d={pathOf(reference, r, top)} fill="none" stroke="#f472b6" strokeWidth={1.5} strokeDasharray="3 2" />
      <path d={pathOf(mix, m, top)} fill="none" stroke="#34d399" strokeWidth={1.5} />
    </svg>
  );
};

export const ReferencePanel: React.FC = () => {
  const ref = useReference();
  const analysis = useMixStudio((s) => s.analysis);
  const busy = useMixStudio((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void restoreReference(), []);
  // Leaving the panel puts the mix back on
  useEffect(() => () => hear('mix'), []);
  const matchDb = ref.sound ? referenceMatchDb() : null;
  const compared = useMemo(() => (analysis && ref.spectrum && matchDb !== null ? compareSpectra(analysis.spectrum, ref.spectrum, matchDb) : null), [analysis, ref.spectrum, matchDb]);
  const onRef = ref.hearing === 'reference';

  return (
    <div data-search="reference track a/b compare" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center gap-1.5">
        <Headphones className="w-3.5 h-3.5 text-pink-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Reference</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={AUDIO_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void loadReferenceFile(file);
        }}
      />
      {!ref.sound ? (
        <>
          <p className="text-[10px] text-forge-muted">Load a finished song you'd like yours to sound like. It plays along with your song at the same loudness, so you can flip between them and hear what's different. It stays in this browser and is never exported.</p>
          <button
            type="button"
            disabled={ref.loading}
            onClick={() => input.current?.click()}
            className="flex items-center justify-center gap-1.5 py-1 rounded border border-pink-400/60 bg-pink-500/10 text-pink-100 text-[11px] font-mono hover:bg-pink-500/20 disabled:opacity-50"
          >
            {ref.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {ref.loading ? 'Measuring…' : 'Load a reference song'}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-[11px] text-white min-w-0">
            <span className="truncate flex-1" title={ref.sound.name}>
              {ref.sound.name}
            </span>
            <span className="font-mono text-[10px] text-forge-muted shrink-0">{formatLufs(ref.lufs)}</span>
            <button type="button" onClick={clearReference} title="Remove the reference" className="shrink-0 text-forge-muted hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
          <button
            type="button"
            data-testid="reference-ab"
            onClick={toggleReference}
            aria-pressed={onRef}
            title="Flip between your mix and the reference (they play at the same loudness)"
            className={`py-1.5 rounded border text-[12px] font-mono font-bold transition ${onRef ? 'bg-pink-500/25 border-pink-400 text-pink-100' : 'bg-emerald-500/20 border-emerald-400 text-emerald-100'}`}
          >
            {onRef ? 'B: Reference (click for your mix)' : 'A: Your mix (click for the reference)'}
          </button>
          {busy ? (
            <div className="flex items-center gap-2 text-[10px] text-forge-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="flex-1">
                {busy.what} {Math.round(busy.progress * 100)}%
              </span>
              <button type="button" onClick={cancelMixRender} className="px-1.5 rounded border border-forge-border hover:text-white">
                Stop
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] text-forge-muted">
              <span className="flex-1">
                {matchDb === null
                  ? 'Not level-matched yet: measure your mix first.'
                  : `Level-matched: the reference plays ${matchDb > 0 ? '+' : ''}${matchDb.toFixed(1)} dB, at your mix's ${formatLufs(analysis!.lufs)}.`}
              </span>
              <button type="button" onClick={() => void analyseMix()} className="shrink-0 px-1.5 py-0.5 rounded border border-forge-border hover:text-white" title="Render the mix to measure its loudness and spectrum (do it again after changing the mix)">
                {analysis ? 'Measure again' : 'Measure mix'}
              </button>
            </div>
          )}
          {analysis && ref.spectrum && matchDb !== null && (
            <>
              <Overlay mix={analysis.spectrum} reference={ref.spectrum} offsetDb={matchDb} />
              <div className="flex gap-3 text-[9px] font-mono">
                <span className="text-emerald-300">— your mix</span>
                <span className="text-pink-300">- - reference</span>
              </div>
              <p className="text-[10px] text-forge-muted" data-testid="reference-diff">
                {compared && compared.regions.length
                  ? `Compared with the reference, your mix has ${compared.regions
                      .slice(0, 3)
                      .map((g) => `${g.db > 0 ? 'more' : 'less'} ${g.name} (${g.db > 0 ? '+' : ''}${g.db.toFixed(1)} dB)`)
                      .join(', ')}.`
                  : 'Your tonal balance is close to the reference’s.'}
              </p>
            </>
          )}
        </>
      )}
      {ref.error && <p className="text-[10px] text-red-300">{ref.error}</p>}
    </div>
  );
};
