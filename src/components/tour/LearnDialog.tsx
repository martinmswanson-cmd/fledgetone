import React from 'react';
import { CheckCircle2, Compass, GraduationCap, Play, RotateCcw } from 'lucide-react';
import { Modal } from '../timeline/Modal';
import { LESSONS, type Level } from '../../tour/lessons';
import { useTourStore } from '../../tour/tourStore';

const LEVEL_STYLE: Record<Level, string> = {
  Tour: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40',
  Beginner: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  Intermediate: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  Expert: 'bg-violet-500/15 text-violet-200 border-violet-500/40',
};

/**
 * The tour and tutorials to pick from: shown once on someone's first visit (as a welcome) and from
 * LEARN in the header. A tutorial left part-way resumes where it stopped.
 */
export const LearnDialog: React.FC<{ onClose: () => void; welcome?: boolean }> = ({ onClose, welcome }) => {
  const progress = useTourStore((s) => s.progress);
  const start = (id: string, step = 0) => {
    onClose();
    // After the dialog has gone, so the first step can point at what's under it
    window.setTimeout(() => useTourStore.getState().start(id, step), 50);
  };
  return (
    <Modal title={welcome ? "Welcome to Bo's Beatbox" : 'Tour and tutorials'} onClose={onClose} wide>
      <p className="text-[13px] text-forge-text">
        {welcome
          ? 'Make music for games and videos, right in your browser. New here? Take the one-minute tour, or learn by doing in a tutorial at your level.'
          : 'Learn by doing: each tutorial points at what to use, waits for you to try it, and moves on by itself.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {LESSONS.map((l) => {
          const p = progress[l.id];
          const resumable = !p?.done && p?.step !== undefined && p.step > 0;
          return (
            <div key={l.id} className="rounded-lg border border-forge-border bg-forge-bg p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {l.level === 'Tour' ? <Compass className="w-4 h-4 text-cyan-400" /> : <GraduationCap className="w-4 h-4 text-forge-muted" />}
                <span className="text-sm font-semibold text-forge-text">{l.title}</span>
                <span className={`ml-auto px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
              </div>
              <p className="text-[11px] flex-1">{l.summary}</p>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span>
                  {l.minutes} min · {l.steps.length} steps
                </span>
                {p?.done && (
                  <span className="flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="w-3 h-3" /> done
                  </span>
                )}
                <div className="ml-auto flex gap-1.5">
                  {resumable && (
                    <button type="button" onClick={() => start(l.id, p.step)} className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25">
                      <Play className="w-3 h-3" /> Resume ({p.step! + 1}/{l.steps.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => start(l.id)}
                    className={`h-7 px-2.5 flex items-center gap-1 rounded-md border font-semibold ${
                      resumable ? 'border-forge-border text-forge-text hover:border-forge-borderLight' : 'border-cyan-500/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                    }`}
                  >
                    {p?.done || resumable ? <RotateCcw className="w-3 h-3" /> : <Play className="w-3 h-3" />} {p?.done || resumable ? 'From the start' : 'Start'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px]">Find these again any time under <strong className="text-forge-text">LEARN</strong> at the top.</span>
        {welcome && (
          <button type="button" onClick={onClose} className="ml-auto h-8 px-3 rounded-md border border-forge-border text-forge-text hover:border-forge-borderLight">
            No thanks, I'll explore
          </button>
        )}
      </div>
    </Modal>
  );
};
