/**
 * The one-time notice on phones that the app is made for a computer (it still runs after Continue
 * anyway).
 */
import React, { useState } from 'react';
import { Monitor } from 'lucide-react';
import { Modal } from './timeline/Modal';
import { ChoiceButton } from './timeline/ProjectBar';

const DISMISSED_KEY = 'bosBeatbox.mobileNoticeDismissed';

/** A phone: a narrow screen driven by touch (a tablet in landscape or a laptop with a touch screen is not one). */
const onPhone = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const narrow = Math.min(window.screen.width, window.screen.height) < 600;
  return touchOnly && narrow;
};

const dismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Tells someone opening the app on a phone that it's made for a computer, once per browser.
 * The app still runs after "Continue anyway"; the notice is a warning, not a wall.
 */
export const MobileNotice: React.FC = () => {
  const [open, setOpen] = useState(() => onPhone() && !dismissed());
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // private browsing: the notice shows again next time, which is fine
    }
    setOpen(false);
  };
  return (
    <Modal title="Made for a computer" onClose={close}>
      <div className="flex items-start gap-3">
        <Monitor className="w-8 h-8 shrink-0 text-cyan-300 mt-0.5" />
        <p>
          Bo's Beatbox is a music studio built for a PC or Mac with a mouse, a keyboard and a wide screen. On a phone the
          timeline is cramped, drag-and-drop editing and keyboard shortcuts don't work, and audio may stutter. For the real
          thing, open this page on a computer.
        </p>
      </div>
      <ChoiceButton title="Continue anyway" detail="Have a look around on this phone. This notice won't show again." autoFocus onClick={close} />
    </Modal>
  );
};
