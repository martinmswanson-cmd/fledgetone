import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import guideMarkdown from '../../../GUIDE.md?raw';
import { renderBlocks, splitSections } from './markdown';

/**
 * The user guide, shown in the app. Its text is GUIDE.md at the repository root, so the same
 * guide reads on GitHub and here. Sections are listed on the left; Esc or the backdrop closes it.
 */
export const GuidePanel: React.FC<{ onClose: () => void; section?: string }> = ({ onClose, section: startAt }) => {
  const sections = useMemo(() => splitSections(guideMarkdown), []);
  const [active, setActive] = useState(startAt && sections.some((s) => s.id === startAt) ? startAt : (sections[0]?.id ?? ''));
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const section = sections.find((s) => s.id === active) ?? sections[0];

  // A modal: focus moves in on open, Tab stays inside, and focus goes back where it was on close
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [active]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Bo's Beatbox guide"
        className="focus:outline-none w-full max-w-5xl h-full max-h-[85vh] flex flex-col rounded-xl border border-forge-borderLight bg-forge-panel shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-forge-text">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            Guide
          </h2>
          <button type="button" onClick={onClose} className="text-forge-muted hover:text-forge-text" title="Close (Esc)" aria-label="Close guide">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          <nav
            aria-label="Guide sections"
            className="shrink-0 sm:w-56 border-b sm:border-b-0 sm:border-r border-forge-border overflow-auto p-2 flex sm:flex-col gap-1"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={s.id === section?.id ? 'page' : undefined}
                className={`shrink-0 text-left rounded-md px-2.5 py-1.5 text-xs ${
                  s.id === section?.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-forge-muted hover:text-forge-text hover:bg-white/5'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div ref={bodyRef} tabIndex={0} aria-label="Guide text" className="flex-1 min-h-0 overflow-auto px-5 py-4 text-[13px] text-forge-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50">
            {section && (
              <article>
                <h3 className="text-base font-semibold text-forge-text mb-2">{section.title}</h3>
                {renderBlocks(section.body, section.id)}
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
