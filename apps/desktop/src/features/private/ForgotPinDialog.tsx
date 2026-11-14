import React, { useState } from 'react';
import { KeyRound, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePrivateChatStore } from '../../stores/privateChatStore';

interface ForgotPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputClass =
  'w-full px-3 py-2 rounded-md bg-background border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary';

export const ForgotPinDialog: React.FC<ForgotPinDialogProps> = ({ open, onOpenChange }) => {
  const { status, resetWithRecoveryKey, resetWipe } = usePrivateChatStore();
  const [mode, setMode] = useState<'recovery' | 'wipe'>(status?.hasRecoveryKey === false ? 'wipe' : 'recovery');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setRecoveryKey('');
    setNewPin('');
    setConfirmPin('');
    setConfirmation('');
    setError(null);
    onOpenChange(false);
  };

  const submitRecovery = async () => {
    setError(null);
    if (newPin.length < 4) return setError('The new PIN must be at least 4 characters.');
    if (newPin !== confirmPin) return setError('The new PINs do not match.');
    setBusy(true);
    const res = await resetWithRecoveryKey(recoveryKey, newPin);
    setBusy(false);
    if (res.success) close();
    else setError(res.error ?? 'Reset failed');
  };

  const submitWipe = async () => {
    setError(null);
    setBusy(true);
    const res = await resetWipe(confirmation);
    setBusy(false);
    if (res.success) close();
    else setError(res.error ?? 'Reset failed');
  };

  const tab = (id: 'recovery' | 'wipe', label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      className={cn(
        'flex-1 py-1.5 rounded text-xs transition-colors',
        mode === id ? 'bg-background text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  );

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Forgot your PIN?</AlertDialogTitle>
          <AlertDialogDescription>
            Your PIN is never stored, so it cannot be shown. Use your recovery key to set a new PIN, or erase private
            chats and start over.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex bg-muted p-0.5 rounded-md">
          {tab('recovery', 'Use recovery key')}
          {tab('wipe', 'Erase & start over')}
        </div>

        {mode === 'recovery' ? (
          <div className="space-y-2.5">
            {status?.hasRecoveryKey === false && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                No recovery key was created for this PIN. Use "Erase & start over".
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Recovery key</span>
              <input
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                className={cn(inputClass, 'font-mono tracking-wider')}
                autoFocus
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">New PIN or passphrase</span>
              <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} className={inputClass} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Confirm new PIN</span>
              <input type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} className={inputClass} />
            </label>
            <p className="text-[11px] text-muted-foreground">Your private chats are kept. You will get a new recovery key.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive leading-snug">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                This permanently deletes <strong>all private chats, all locked chats and their messages</strong> on this
                PC, and removes the PIN. It cannot be undone. Other people keep their own copies.
              </span>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                Type <strong className="font-mono">RESET</strong> to confirm
              </span>
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className={cn(inputClass, 'font-mono')}
                spellCheck={false}
              />
            </label>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>Cancel</AlertDialogCancel>
          {mode === 'recovery' ? (
            <Button disabled={busy || !recoveryKey.trim() || !newPin} onClick={submitRecovery}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Set new PIN
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy || confirmation !== 'RESET'} onClick={submitWipe}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Erase and start over
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
