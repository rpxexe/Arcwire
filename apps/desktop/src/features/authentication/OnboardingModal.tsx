import React, { useState } from 'react';
import { ShieldCheck, Sparkles, Monitor } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';
import { UserStatus } from '@ipm/shared';

export const OnboardingModal: React.FC = () => {
  const { profile, createProfile, systemInfo } = useProfileStore();

  const [displayName, setDisplayName] = useState(systemInfo?.osUsername || '');
  const [username, setUsername] = useState(
    (systemInfo?.osUsername || 'user').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  );
  const [status, setStatus] = useState<UserStatus>('online');
  const [customStatus, setCustomStatus] = useState('Available on LAN');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (profile) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!displayName.trim() || !username.trim()) {
        throw new Error('Please fill in both your display name and username');
      }

      await createProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        status,
        customStatus: customStatus.trim() || undefined,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/90 flex items-center justify-center p-4 select-none">
      <div className="bg-card border border-border rounded-lg shadow-md max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 bg-muted/40 border-b border-border">
          <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Welcome to Arcwire</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Zero-cloud, high-performance Windows LAN peer-to-peer desktop communication.
          </p>
        </div>

        {/* Windows Environment Info Note */}
        <div className="mx-6 mt-4 p-3 rounded-md bg-muted border border-border flex items-start gap-3 text-xs text-muted-foreground">
          <Monitor className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-foreground">Windows Host Detected:</span>{' '}
            <span className="font-mono text-foreground">{systemInfo?.computerName || 'Detecting…'}</span> (User:{' '}
            <span className="font-mono text-foreground">{systemInfo?.osUsername || 'Detecting…'}</span>)
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              A cryptographic Ed25519 device identity and permanent Device ID will be generated for your PC.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice Smith"
              className="w-full px-3 py-2 text-sm rounded-md bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Handle / Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs text-muted-foreground">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alice"
                className="w-full pl-7 pr-3 py-2 text-sm rounded-md bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Initial Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
                className="w-full px-3 py-2 text-sm rounded-md bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              >
                <option value="online">Online (Available)</option>
                <option value="busy">Busy (Do Not Disturb)</option>
                <option value="away">Away</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Custom Status Note
              </label>
              <input
                type="text"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder="Ready for messaging"
                className="w-full px-3 py-2 text-sm rounded-md bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99] disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
            >
              {isSubmitting ? (
                <span>Generating Identity…</span>
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
