import React, { useState, useEffect } from 'react';
import { Shield, Lock, Key, AlertTriangle, Eye, EyeOff, Loader2, Sparkles, HelpCircle } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';

export const PrivateUnlockScreen: React.FC = () => {
  const { status, lockedUntil, isLoading, error, setupCredential, unlock, setError } = usePrivateChatStore();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryHint, setRecoveryHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

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
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl p-8 space-y-6">
        {/* Header Icon & Title */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-inner">
            {isSetupMode ? <Sparkles className="w-7 h-7" /> : <Lock className="w-7 h-7" />}
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {isSetupMode ? 'Setup Private Chat Security' : 'Unlock Private Workspace'}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isSetupMode
              ? 'Private chats are hidden from normal search, chat lists, and notifications. Set an Argon2id-protected passphrase to secure this workspace.'
              : 'Enter your master PIN or passphrase to decrypt and access hidden peer-to-peer conversations.'}
          </p>
        </div>

        {/* Lockout Warning */}
        {secondsRemaining > 0 && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Too many failed attempts. Throttling active: retry in <strong>{secondsRemaining}s</strong>
            </span>
          </div>
        )}

        {/* Store Error Alert */}
        {error && secondsRemaining === 0 && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>{isSetupMode ? 'Create PIN or Passphrase' : 'PIN or Passphrase'}</span>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
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
                placeholder={isSetupMode ? 'At least 4 characters...' : 'Enter your password...'}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {isSetupMode && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Confirm PIN or Passphrase</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  placeholder="Re-enter password..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <span>Recovery Hint (Optional)</span>
                </label>
                <input
                  type="text"
                  value={recoveryHint}
                  onChange={(e) => setRecoveryHint(e.target.value)}
                  disabled={isLoading}
                  placeholder="e.g. My favorite dog breed"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
                />
              </div>
            </>
          )}

          {!isSetupMode && status?.recoveryHint && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowHint(!showHint)}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showHint ? 'Hide recovery hint' : 'Show recovery hint'}</span>
              </button>
              {showHint && (
                <div className="mt-2 p-2.5 rounded-lg bg-muted text-xs text-foreground font-mono">
                  Hint: {status.recoveryHint}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || secondsRemaining > 0 || !password}
            className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying with Argon2id...</span>
              </>
            ) : isSetupMode ? (
              <>
                <Key className="w-4 h-4" />
                <span>Initialize Master Credential</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Unlock Private Chats</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

