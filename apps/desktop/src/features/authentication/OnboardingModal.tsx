import React, { useState, useEffect } from 'react';
import { ShieldCheck, Monitor, User, Check, Sparkles } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';
import type { UserStatus } from '@ipm/shared';

export const OnboardingModal: React.FC = () => {
  const { profile, systemInfo, createProfile } = useProfileStore();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<UserStatus>('online');
  const [customStatus, setCustomStatus] = useState('Ready for LAN messaging');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate suggested values from Windows environment
  useEffect(() => {
    if (systemInfo) {
      const defaultName = systemInfo.osUsername
        ? systemInfo.osUsername.charAt(0).toUpperCase() + systemInfo.osUsername.slice(1)
        : 'Windows User';
      setDisplayName(defaultName);
      setUsername(systemInfo.osUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    }
  }, [systemInfo]);

  // Don't render if user already has a profile
  if (profile) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (!username.trim() || username.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await createProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        status,
        customStatus: customStatus.trim() || null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b border-border">
          <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/30 text-primary flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Welcome to IP Messenger</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Zero-cloud, high-performance Windows LAN peer-to-peer desktop communication.
          </p>
        </div>

        {/* Windows Environment Info Note */}
        <div className="mx-6 mt-4 p-3 rounded-lg bg-muted/60 border border-border flex items-start gap-3 text-xs text-muted-foreground">
          <Monitor className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-foreground">Windows Host Detected:</span>{' '}
            <span className="font-mono text-foreground">{systemInfo?.computerName || 'Detecting...'}</span> (User:{' '}
            <span className="font-mono text-foreground">{systemInfo?.osUsername || 'Detecting...'}</span>)
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              A cryptographic Ed25519 device identity and permanent Device ID will be generated for your PC.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice Smith"
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Handle / Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alice"
                className="w-full pl-7 pr-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Initial Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              >
                <option value="online">Online (Available)</option>
                <option value="busy">Busy (Do Not Disturb)</option>
                <option value="away">Away</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Custom Status Note
              </label>
              <input
                type="text"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder="Ready for messaging"
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm shadow hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <span>Generating Cryptographic Identity...</span>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Complete Setup & Launch</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
