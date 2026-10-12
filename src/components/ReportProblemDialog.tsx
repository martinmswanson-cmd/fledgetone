import React, { useMemo, useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { Modal } from './timeline/Modal';
import { CONTACT_EMAIL, CONTACT_PAGE, mailtoLink, reportText, technicalDetails } from '../support/problemReport';

/**
 * Tell Two Birds Workshop something went wrong: a description, an optional reply address and,
 * if the person agrees, technical details (shown in full before sending). It goes by the person's
 * own email program, or they can copy it, or use the contact form on the website.
 */
export const ReportProblemDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [what, setWhat] = useState('');
  const [email, setEmail] = useState('');
  const [withDetails, setWithDetails] = useState(true);
  const [copied, setCopied] = useState(false);
  // Taken once, when the dialog opens: what was going on when the problem happened
  const details = useMemo(() => technicalDetails(), []);
  const report = { what, email, details: withDetails ? details : null };
  const empty = !what.trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${CONTACT_EMAIL}\n\n${reportText(report)}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const field = 'w-full bg-forge-bg border border-forge-border rounded-md px-2.5 py-2 text-xs text-forge-text placeholder:text-forge-muted/60 focus:outline-none focus:border-cyan-500';

  return (
    <Modal title="Report a problem" onClose={onClose}>
      <p>
        Something not working, sounding wrong or crashing? Tell us and we'll look into it. Your song isn't sent; if the problem is in a
        particular song, <strong className="text-forge-text">Save</strong> it and attach the file to the email.
      </p>
      <label className="flex flex-col gap-1 text-forge-text">
        What happened?
        <textarea
          // The dialog is for typing this
          autoFocus
          rows={5}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="What you were doing, what you expected, and what happened instead."
          className={`${field} resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1 text-forge-text">
        Your email (optional, so we can reply)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={field} />
      </label>
      <label className="flex items-start gap-2 text-forge-text cursor-pointer">
        <input type="checkbox" checked={withDetails} onChange={(e) => setWithDetails(e.target.checked)} className="mt-0.5 accent-cyan-500" />
        <span>
          Include technical details
          <span className="block text-[11px] text-forge-muted">Your browser, audio settings, the size of the song and recent errors. Nothing else.</span>
        </span>
      </label>
      {withDetails && (
        <details className="rounded-md border border-forge-border bg-black/30">
          <summary className="cursor-pointer px-2.5 py-1.5 text-[11px]">See exactly what's included</summary>
          <pre className="px-2.5 pb-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words font-mono">{details}</pre>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={empty ? undefined : mailtoLink(report)}
          aria-disabled={empty}
          onClick={(e) => (empty ? e.preventDefault() : undefined)}
          className={`h-8 px-3 flex items-center gap-1.5 rounded-md border text-xs font-semibold ${
            empty ? 'border-forge-border text-forge-muted cursor-not-allowed' : 'border-cyan-500/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
          }`}
          title={empty ? 'Describe the problem first' : `Opens your email program, addressed to ${CONTACT_EMAIL}`}
        >
          <Mail className="w-4 h-4" /> Email it
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={empty}
          className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border text-xs text-forge-text hover:border-forge-borderLight disabled:opacity-40"
          title="Copy the report, to paste into any email or message"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy report'}
        </button>
      </div>
      <p className="text-[11px]">
        No email program? Send it to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-300 underline underline-offset-2">
          {CONTACT_EMAIL}
        </a>{' '}
        or use the{' '}
        <a href={CONTACT_PAGE} target="_blank" rel="noopener" className="text-cyan-300 underline underline-offset-2">
          contact form
        </a>{' '}
        on twobirdsworkshop.com.
      </p>
    </Modal>
  );
};
