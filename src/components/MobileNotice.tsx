/**
 * The notice on phones that the studio is made for a computer, with the way to Pocket (the
 * phone version) or on anyway. A phone opens Pocket unless the person chose the studio
 * (pocketMode.ts). It shows each time until "Don't show this again" is ticked.
 */
import React, { useState } from 'react';
import { Monitor } from 'lucide-react';
import { Modal } from './timeline/Modal';
import { ChoiceButton } from './timeline/ProjectBar';
import { chooseInterface, onPhone } from '../pocket/pocketMode';

const DISMISSED_KEY = 'bosBeatbox.mobileNoticeDismissed';

const dismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Tells someone opening the studio on a phone that it's made for a computer, each time until
 * they tick "Don't show this again".
 * The app still runs after "Continue anyway"; the notice is a warning, not a wall.
 */
export const MobileNotice: React.FC = () => {
  const [open, setOpen] = useState(() => onPhone() && !dismissed());
  const [hide, setHide] = useState(false);
  if (!open) return null;
  const close = () => {
    try {
      if (hide) localStorage.setItem(DISMISSED_KEY, '1');
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
          Fledgetone is a music studio built for a PC or Mac with a mouse, a keyboard and a wide screen. On a phone the
          timeline is cramped, drag-and-drop editing and keyboard shortcuts don't work, and audio may stutter. For the real
          thing, open this page on a computer.
        </p>
      </div>
      <ChoiceButton title="Use Pocket, the phone version" detail="The whole song on one screen, with pads, steps and a piano roll made for a thumb. Your song opens in it, and back here on a computer." autoFocus onClick={() => { close(); chooseInterface('pocket'); }} />
      <label className="flex items-center gap-2 text-sm text-forge-muted">
        <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
        Don't show this again
      </label>
      <ChoiceButton title="Continue anyway" detail="Have a look around the full studio on this phone." onClick={close} />
    </Modal>
  );
};
