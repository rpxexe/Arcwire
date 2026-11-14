import React, { useState } from 'react';
import { ShieldCheck, KeyRound, Loader2, Check } from 'lucide-react';
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
import { usePrivateChatStore } from '../../stores/privateChatStore';

const inputClass =
  'w-full px-3 py-2 rounded-md bg-background border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary';

/** Change the Private Chats PIN and manage the recovery key (opened from the unlocked workspace). */
export const PrivateSecurityDialog: React.FC = () => {
  const { isSecurityModalOpen, setSecurityModalOpen, status, changePassword, generateRecoveryKey } = usePrivateChatStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setHint('');
    setError(null);
    setDone(false);
  };

  const close = () => {
    reset();
    setSecurityModalOpen(false);
  };

  const submit = async () => {
    setError(null);
    setDone(false);
    if (next.length < 4) return setError('The new PIN must be at least 4 characters.');
    if (next !== confirm) return setError('The new PINs do not match.');
    setBusy(true);
    const res = await changePassword(current, next, hint.trim() ? hint.trim() : undefined);
    setBusy(false);
    if (res.success) {
      reset();
      setDone(true);
    } else {
      setError(res.error ?? 'Could not change PIN');
    }
  };

  return (
    <AlertDialog open={isSecurityModalOpen} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Private Chats security
          </AlertDialogTitle>
          <AlertDialogDescription>Change your PIN or create a new recovery key. Your chats are kept.</AlertDialogDescription>
        </AlertDialogHeader>

        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold text-foreground">Change PIN</h3>
          <input type="password" placeholder="Current PIN" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} autoFocus />
          <input type="password" placeholder="New PIN or passphrase" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          <input type="password" placeholder="Confirm new PIN" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          <input
            placeholder={status?.recoveryHint ? `Hint (current: ${status.recoveryHint})` : 'Hint (optional, never your PIN)'}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            className={inputClass}
            maxLength={100}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {done && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> PIN changed.
            </p>
          )}
          <Button className="w-full" disabled={busy || !current || !next} onClick={submit}>
            {busy && <Loader2 className="animate-spin" />} Change PIN
          </Button>
        </section>

        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-semibold text-foreground">Recovery key</h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {status?.hasRecoveryKey
              ? 'A recovery key is set. Create a new one if you lost it — the old key stops working.'
              : 'No recovery key yet. Without one, forgetting your PIN means erasing your private chats.'}
          </p>
          <Button variant="outline" className="w-full" onClick={() => generateRecoveryKey()}>
            <KeyRound /> {status?.hasRecoveryKey ? 'Create a new recovery key' : 'Create recovery key'}
          </Button>
        </section>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
