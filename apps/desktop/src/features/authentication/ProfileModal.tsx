import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Shield, Laptop, User } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';
import type { UserStatus } from '@ipm/shared';

export const ProfileModal: React.FC = () => {
  const { profile, isProfileModalOpen, closeProfileModal, updateProfile } = useProfileStore();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<UserStatus>('online');
  const [customStatus, setCustomStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setUsername(profile.username);
      setStatus(profile.status);
      setCustomStatus(profile.customStatus || '');
    }
  }, [profile, isProfileModalOpen]);

  if (!isProfileModalOpen || !profile) return null;

  const handleCopyDeviceId = () => {
    navigator.clipboard.writeText(profile.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim(),
        status,
        customStatus: customStatus.trim() || null,
      });
      closeProfileModal();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 px-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">User Profile & Device Identity</h3>
          </div>
          <button
            onClick={closeProfileModal}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
              {error}
            </div>
          )}

          {/* Cryptographic Device ID */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Shield className="w-3.5 h-3.5 text-primary" /> Permanent Cryptographic Device ID
              </span>
              <button
                type="button"
                onClick={handleCopyDeviceId}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="font-mono text-xs text-foreground bg-background px-2.5 py-1.5 rounded border border-border select-all break-all">
              {profile.deviceId}
            </div>
            <p className="text-[10px] text-muted-foreground">
              This ID is derived from your Ed25519 identity key and stays permanent across profile edits.
            </p>
          </div>

          {/* Windows Host Info */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-muted/30 border border-border/80">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Computer Host</span>
              <span className="font-mono font-medium text-foreground">{profile.computerName}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-muted/30 border border-border/80">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Windows User</span>
              <span className="font-mono font-medium text-foreground">{profile.osUsername}</span>
            </div>
          </div>

          {/* Editable Display Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              required
            />
          </div>

          {/* Editable Handle */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Username Handle
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-7 pr-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
                required
              />
            </div>
          </div>

          {/* Status & Custom Note */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Presence Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              >
                <option value="online">Online</option>
                <option value="busy">Busy</option>
                <option value="away">Away</option>
                <option value="offline">Appear Offline</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Custom Status
              </label>
              <input
                type="text"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder="In a meeting, coding..."
                className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-border">
            <button
              type="button"
              onClick={closeProfileModal}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm shadow hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
