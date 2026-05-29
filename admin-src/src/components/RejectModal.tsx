import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  subject: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export default function RejectModal({ title, subject, busy, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  return (
    <div className="modal-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="modal-sub" style={{ wordBreak: 'break-word' }}>{subject}</p>
        <label className="form-label" style={{ display: 'block', marginTop: 12, marginBottom: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ts)' }}>
          Reason (will be sent to the broker)
        </label>
        <textarea
          ref={ref}
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          disabled={busy}
          placeholder="Explain why this is being rejected so the broker can fix and resubmit."
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit',
            border: '1px solid var(--br)', borderRadius: 8,
            resize: 'vertical', minHeight: 90, maxHeight: 240,
            background: busy ? '#fafafa' : '#fff',
          }}
        />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-danger"
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmed)}
          >
            {busy ? 'Sending…' : 'Reject and notify'}
          </button>
        </div>
      </div>
    </div>
  );
}
