import React from 'react';
import { Activity } from 'lucide-react';
import { formatLufs } from '../audio/loudness';
import { useLoudness } from './inspector/useLoudness';

/**
 * The song's loudness over the last 3 seconds, in the header while audio runs. Turns red while
 * the true peak since Play passes -1 dBTP. The Master tab of the Inspector has the full meter.
 */
export const LoudnessBadge: React.FC = () => {
  const reading = useLoudness();
  const hot = reading !== null && reading.truePeakMax > -1;
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-mono tabular-nums border bg-forge-bg ${
        hot ? 'border-red-500/60 text-red-300' : 'border-forge-border text-emerald-200'
      }`}
      title={`Loudness over the last 3 seconds. ${hot ? 'Red: the peak since Play went over -1 dBTP. ' : ''}The Master tab of the Inspector has the full meter.`}
      aria-label="Loudness"
    >
      <Activity className={`w-3.5 h-3.5 ${hot ? 'text-red-400' : 'text-emerald-400'}`} />
      {formatLufs(reading?.shortTerm ?? -Infinity)}
    </div>
  );
};
