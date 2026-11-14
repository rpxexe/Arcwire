import React, { useEffect, useState } from 'react';
import { KeyRound, Copy, Download, Check } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { usePrivateChatStore } from '../../stores/privateChatStore';

/**
 * Shows a freshly generated recovery key exactly once. The key is never stored in plain
 * text, so this dialog is the only chance to save it.
 */
export const RecoveryKeyDialog: React.FC = () => {
  const { pendingRecoveryKey, clearPendingRecoveryKey } = usePrivateChatStore();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setConfirmed(false);
    setCopied(false);
  }, [pendingRecoveryKey]);

  if (!pendingRecoveryKey) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pendingRecoveryKey);
    } catch {
      await window.api?.writeClipboardText?.(pendingRecoveryKey);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const save = () => {
    const text =
      `Arcwire Private Chats — recovery key\n\n${pendingRecoveryKey}\n\n` +
      `Use it on the unlock screen (Forgot PIN?) to set a new PIN without losing your private chats.\n` +
      `Created: ${new Date().toLocaleString()}\nKeep this file somewhere safe and offline.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arcwire-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Save your recovery key
          </AlertDialogTitle>
          <AlertDialogDescription>
            If you forget your PIN, this key lets you set a new one and keep your private chats. It is shown only
            now — Arcwire stores just a hash and cannot show it again. Any previous recovery key no longer works.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-border bg-muted/60 px-3 py-3 text-center font-mono text-sm tracking-wider text-foreground select-all break-all">
          {pendingRecoveryKey}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" className="flex-1" onClick={save}>
            <Download /> Save as file
          </Button>
        </div>

        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 accent-[hsl(var(--primary))]"
          />
          I have saved my recovery key somewhere safe.
        </label>

        <AlertDialogFooter>
          <Button disabled={!confirmed} onClick={clearPendingRecoveryKey}>
            Done
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
