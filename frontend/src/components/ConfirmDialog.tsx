'use client';
import { ReactNode, useEffect, useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingFromPropRef = useRef(false);
  const pressedOutsideRef = useRef(false);
  const openRef = useRef(open);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descId = useId();

  openRef.current = open;
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      closingFromPropRef.current = true;
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss untuk browser yang belum mendukung <dialog closedby="any"> (mis. Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof HTMLDialogElement === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) {
      return;
    }
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutsideRef.current = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!busyRef.current && pressedOutsideRef.current && isOutside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutsideRef.current = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      {...({ closedby: busy ? 'none' : 'any' } as Record<string, string>)}
      onCancel={(e) => {
        if (busyRef.current) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onCancelRef.current();
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = '';
        }
        if (closingFromPropRef.current) {
          closingFromPropRef.current = false;
          return;
        }
        if (openRef.current && !busyRef.current) {
          onCancelRef.current();
        }
      }}
      className="m-auto w-[min(92vw,28rem)] max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-2xl"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {destructive && (
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold leading-snug text-[var(--text-primary)]">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {description}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Tutup dialog"
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {children && <div className="space-y-3">{children}</div>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            autoFocus={destructive && !children}
            disabled={busy}
            onClick={onCancel}
            className="btn-ghost"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              destructive
                ? 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50'
                : 'btn'
            }
          >
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
