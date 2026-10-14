"use client";

import { useId, useRef, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";

/** Shared by the live drawers and their nested action dialog. Radix owns the
 * focus trap and Escape stack so closing a confirmation leaves its drawer open. */
export function RealtimeDialog({ title, description, drawer = false, onClose, children }: {
  title: string;
  description?: string;
  drawer?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const descriptionId = useId();
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={`live-dialog-overlay${drawer ? " is-drawer" : ""}`} />
      <Dialog.Content
        className={drawer ? "live-drawer" : "live-action-dialog"}
        aria-describedby={description ? descriptionId : undefined}
        onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
          else (document.querySelector<HTMLElement>(".live-drawer .live-dialog-heading button")
            ?? document.querySelector<HTMLElement>(".live-search input"))?.focus({ preventScroll: true });
        }}
      >
        <header className="live-dialog-heading">
          <div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description id={descriptionId}>{description}</Dialog.Description>}</div>
          <Dialog.Close className="scale-icon-button" aria-label="关闭"><X size={20} /></Dialog.Close>
        </header>
        <div className="live-dialog-body">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
