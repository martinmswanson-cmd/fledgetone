/**
 * The response curve drawn above the Track Inspector's 3-band EQ sliders, from the track's low,
 * mid and high gains.
 */
import React, { useMemo } from 'react';
import type { TrackEq } from '../../store/timelineTypes';

interface EqCurvePreviewProps {
  eq: TrackEq;
  color?: string;
  width?: number;
  height?: number;
}

/**
 * The 3-band EQ's response: low below 400 Hz, mid from 400 Hz to 2.5 kHz, high above 2.5 kHz.
 * Range: -24 dB to +12 dB.
 */
export const EqCurvePreview: React.FC<EqCurvePreviewProps> = ({
  eq,
  color = '#22d3ee',
  width = 280,
  height = 90,
}) => {
  // SVG coordinate calculations
  // X: 0 to width represents ~20Hz to 20kHz logarithmic scale
  // Y: 0 (top = +12dB) to height (bottom = -24dB). Center (0dB) is at height * (12 / 36) = height / 3
  const zeroY = useMemo(() => height * (12 / 36), [height]);
  const pxPerDb = useMemo(() => height / 36, [height]);

  // Compute curve points
  const pathData = useMemo(() => {
    const numPoints = 40;
    const points: Array<[number, number]> = [];

    const lowGain = eq?.low ?? 0;
    const midGain = eq?.mid ?? 0;
    const highGain = eq?.high ?? 0;

    for (let i = 0; i <= numPoints; i++) {
      const frac = i / numPoints; // 0 to 1
      const x = frac * width;

      // Log frequency approximation from 20Hz to 20kHz
      // log10(20) ~ 1.301, log10(20000) ~ 4.301. Span = 3.0
      const logFreq = 1.301 + frac * 3.0;
      const freq = Math.pow(10, logFreq);

      // Three bands split by Linkwitz-Riley crossovers at 400 Hz and 2.5 kHz (as lightFx.ts builds
      // them): each band's share of the sound, which add up to 1, times its own gain
      const lp = (fc: number) => 1 / (1 + Math.pow(freq / fc, 4));
      const hp = (fc: number) => 1 - lp(fc);
      const gain = (db: number) => Math.pow(10, db / 20);
      const amp = lp(400) * gain(lowGain) + hp(400) * lp(2500) * gain(midGain) + hp(2500) * gain(highGain);
      const totalDb = 20 * Math.log10(Math.max(amp, 1e-4));
      const y = Math.max(2, Math.min(height - 2, zeroY - totalDb * pxPerDb));
      points.push([x, y]);
    }

    // Build SVG path
    let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0].toFixed(1)},${points[i][1].toFixed(1)}`;
    }
    return d;
  }, [eq, width, height, zeroY, pxPerDb]);

  const fillPathData = useMemo(() => {
    return `${pathData} L ${width},${height} L 0,${height} Z`;
  }, [pathData, width, height]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-black/60 border border-forge-border p-1 shadow-inner">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full block overflow-visible select-none"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="eqGlowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="60%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
          <filter id="eqLineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Grid lines: +12dB, 0dB, -12dB, -24dB */}
        <line x1="0" y1={zeroY - 12 * pxPerDb} x2={width} y2={zeroY - 12 * pxPerDb} stroke="#374151" strokeDasharray="2,2" strokeWidth="0.75" />
        <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#4b5563" strokeDasharray="3,3" strokeWidth="1" />
        <line x1="0" y1={zeroY + 12 * pxPerDb} x2={width} y2={zeroY + 12 * pxPerDb} stroke="#374151" strokeDasharray="2,2" strokeWidth="0.75" />

        {/* Frequency vertical markers: 100Hz (~23%), 400Hz (~43%), 1kHz (~56%), 2.5kHz (~70%), 10kHz (~90%) */}
        <line x1={width * 0.23} y1="0" x2={width * 0.23} y2={height} stroke="#27272a" strokeWidth="0.75" />
        <line x1={width * 0.43} y1="0" x2={width * 0.43} y2={height} stroke="#3f3f46" strokeDasharray="2,2" strokeWidth="0.75" />
        <line x1={width * 0.56} y1="0" x2={width * 0.56} y2={height} stroke="#3f3f46" strokeDasharray="2,2" strokeWidth="0.75" />
        <line x1={width * 0.70} y1="0" x2={width * 0.70} y2={height} stroke="#3f3f46" strokeDasharray="2,2" strokeWidth="0.75" />
        <line x1={width * 0.90} y1="0" x2={width * 0.90} y2={height} stroke="#27272a" strokeWidth="0.75" />

        {/* Frequency Text Labels */}
        <text x="4" y={zeroY - 3} fill="#9ca3af" fontSize="8" fontFamily="JetBrains Mono, monospace">0dB</text>
        <text x={width * 0.43 - 8} y={height - 3} fill="#71717a" fontSize="7" fontFamily="JetBrains Mono, monospace">400Hz</text>
        <text x={width * 0.56 - 6} y={height - 3} fill="#71717a" fontSize="7" fontFamily="JetBrains Mono, monospace">1kHz</text>
        <text x={width * 0.70 - 9} y={height - 3} fill="#71717a" fontSize="7" fontFamily="JetBrains Mono, monospace">2.5kHz</text>

        {/* Gradient fill under curve */}
        <path d={fillPathData} fill="url(#eqGlowGrad)" />

        {/* Glowing Curve stroke */}
        <path
          d={pathData}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          filter="url(#eqLineGlow)"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
