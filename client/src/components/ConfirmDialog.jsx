import { useEffect } from 'react';
import './ConfirmDialog.css';

// Blocking confirmation for the destructive actions — resetting a draft,
// dropping players on import. Deliberately a real dialog rather than a
// two-click "click again to confirm" button: those read as an unresponsive
// button, and this needs to be hard to trigger by accident.
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-dialog__backdrop" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog__title">{title}</div>
        <div className="confirm-dialog__body">{body}</div>
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
