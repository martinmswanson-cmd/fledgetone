/**
 * Pocket and the microphone: the notice that Bluetooth headphones put takes late, and lining up
 * recording on this phone (lineUpRun.ts: soft clicks played and recorded, to measure how late
 * takes arrive). Asking for the microphone itself is useMicAsk.tsx.
 */
import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { forgetLineUp, linedUpDelay, lineUpMessage, lineUpRecording } from '../audio/lineUpRun';
import { outputLatencySeconds } from '../audio/latency';
import { likelyBluetooth } from '../audio/lineUp';
import { showToast } from '../components/timeline/toastStore';
import { Card, pill } from './pocketUi';

/** Put away until the app starts again */
let slowDismissed = false;

/** While recording: Bluetooth headphones (or another slow output) put the take late. Dismissible. */
export const SlowOutputNotice: React.FC<{ inputLabel: string }> = ({ inputLabel }) => {
  const [gone, setGone] = useState(slowDismissed);
  if (gone || !likelyBluetooth(outputLatencySeconds(), inputLabel)) return null;
  return (
    <div className="mt-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100 flex items-start gap-2" role="status">
      <span className="flex-1">Bluetooth adds delay; use wired headphones to record.</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="-m-1 w-8 h-8 shrink-0 grid place-items-center text-amber-200"
        onClick={() => {
          slowDismissed = true;
          setGone(true);
        }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Line up recording on this phone: measure how late takes arrive, once. */
export const LineUpCard: React.FC<{ ask: (go: () => Promise<void>) => void; disabled?: boolean }> = ({ ask, disabled }) => {
  const [busy, setBusy] = useState(false);
  const [delay, setDelay] = useState(linedUpDelay);
  const run = () =>
    ask(async () => {
      const st = useTimelineStore.getState();
      if (st.isPlaying) st.pause();
      setBusy(true);
      try {
        const result = await lineUpRecording();
        showToast(lineUpMessage(result));
        setDelay(linedUpDelay());
      } finally {
        setBusy(false);
      }
    });
  return (
    <Card title="Line up recording">
      <p className="text-[12px] text-forge-muted mb-2">
        {delay !== null
          ? `Lined up: takes on this phone are moved back ${Math.round(delay * 1000)} ms, to where you sang them.`
          : "Not lined up yet: takes use the phone's own guess of its delay, which can be off. Once is enough."}
      </p>
      <div className="flex gap-2">
        <button type="button" className={`${pill} flex-1`} disabled={busy || disabled} onClick={run}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Listening' : delay !== null ? 'Line up again' : 'Line up'}
        </button>
        {delay !== null && !busy && (
          <button
            type="button"
            className={pill}
            onClick={() => {
              forgetLineUp();
              setDelay(null);
            }}
          >
            Forget
          </button>
        )}
      </div>
      <p className="text-[11px] text-forge-muted mt-2">Plays a few soft clicks through the speaker and listens with the microphone, for about 3 seconds. Take headphones off and keep quiet.</p>
    </Card>
  );
};
