import React from 'react';
import { Modal } from '../timeline/Modal';

/** Placeholder: the FMOD / Wwise package dialog (filled in with the engine export). */
export const EnginesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Modal title="FMOD / Wwise package" onClose={onClose}>
    <p>Coming up.</p>
  </Modal>
);
