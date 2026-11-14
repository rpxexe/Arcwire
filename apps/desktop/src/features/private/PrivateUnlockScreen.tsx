import React, { useState, useEffect } from 'react';
import { Lock, Key, AlertTriangle, Eye, EyeOff, Loader2, Sparkles, HelpCircle } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';
import { ForgotPinDialog } from './ForgotPinDialog';

export const PrivateUnlockScreen: React.FC = () => {
  const { status, lockedUntil, isLoading, error, setupCredential, unlock, setError } = usePrivateChatStore();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryHint, setRecoveryHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [isForgotOpen, setIsForgotOpen] = useState(false);

  const isSetupMode = !status?.hasCredential;

  // Countdown timer for lockout
  useEffect(() => {
    if (!lockedUntil) {
      setSecondsRemaining(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
      setSecondsRemaining(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (secondsRemaining > 0) return;

    if (isSetupMode) {
      if (password.length < 4) {
        setError('PIN or passphrase must be at least 4 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      try {
        await setupCredential(password, recoveryHint.trim() || undefined);
      } catch {
        // handled in store
      }
    } else {
      if (!password) {
        setError('Please enter your PIN or passphrase');
        return;
      }
      try {
        const res = await unlock(password);
        if (res.success) {
          setPassword('');
        }
      } catch {
        // handled in store
      }
    }
  };

  return (
    <div className="flex-1 h-full flex items-center justify-center p-6 bg-background select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-sm p-8 space-y-6">
        {/* Header Icon & Title */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center mx-auto">
            {isSetupMode ? <Sparkles className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {isSetupMode ? 'Setup Private Chat Security' : 'Private Workspace'}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isSetupMode
              ? 'Private chats are hidden from normal search, chat lists, and notifications. Set an Argon2id-protected passphrase to secure this workspace.'
              : 'Enter your master PIN or passphrase to decrypt and access hidden peer-to-peer conversations.'}
          </p>
        </div>

        {/* Lockout Warning */}
        {secondsRemaining > 0 && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Too many failed attempts. Throttling active: retry in <strong>{secondsRemaining}s</strong>
            </span>
          </div>
        )}

        {/* Store Error Alert */}
        {error && secondsRemaining === 0 && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center justify-between">
              <span>{isSetupMode ? 'Create PIN or Passphrase' : 'PIN or Passphrase'}</span>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary"
                tabIndex={-1}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading || secondsRemaining > 0}
                placeholder={isSetupMode ? 'At least 4 characters…' : 'Enter your password…'}
                autoFocus
                className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-150 ease-out disabled:opacity-50"
              />
            </div>
          </div>

          {isSetupMode && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Confirm PIN or Passphrase</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  placeholder="Re-enter password…"
                  className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-150 ease-out disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <span>Recovery Hint (Optional)</span>
                </label>
                <input
                  type="text"
                  value={recoveryHint}
                  onChange={(e) => setRecoveryHint(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g. My favorite dog breed"
                  className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-150 ease-out disabled:opacity-50"
                />
              </div>
            </>
          )}

          {!isSetupMode && status?.recoveryHint && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowHint(!showHint)}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors duration-150 ease-out flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showHint ? 'Hide recovery hint' : 'Show recovery hint'}</span>
              </button>
              {showHint && (
                <div className="mt-2 p-2 rounded-md bg-muted text-xs text-foreground font-mono">
                  Hint: {status.recoveryHint}
                </div>
              )}
            </div>
          )}

          {!isSetupMode && (
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={() => setIsForgotOpen(true)}
                className="text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Forgot PIN?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || secondsRemaining > 0 || !password}
            className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium text-sm shadow-sm hover:bg-primary/90 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 transition-colors duration-150 ease-out active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                <span>Verifying Credential…</span>
              </>
            ) : isSetupMode ? (
              <>
                <Key className="w-4 h-4" />
                <span>Initialize Master Credential</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Open Secure Workspace</span>
              </>
            )}
          </button>
        </form>
      </div>
      <ForgotPinDialog open={isForgotOpen} onOpenChange={setIsForgotOpen} />
    </div>
  );
};
