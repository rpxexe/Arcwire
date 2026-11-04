import React, { useState } from 'react';
import { X, Key, Shield, Loader2, ArrowRight } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';

export const JoinPrivateChatModal: React.FC = () => {
  const { isJoinModalOpen, setJoinModalOpen, redeemInvitation, isLoading, error } = usePrivateChatStore();
  const [code, setCode] = useState('');

  if (!isJoinModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    try {
      await redeemInvitation(code.trim().toUpperCase());
      setCode('');
    } catch {
      // handled in store
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    setCode(val);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Join Private Chat</h3>
              <p className="text-[11px] text-muted-foreground">Redeem a PRV invitation token from a peer</p>
            </div>
          </div>
          <button
            onClick={() => setJoinModalOpen(false)}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Invitation Token</label>
            <input
              type="text"
              value={code}
              onChange={handleCodeChange}
              placeholder="e.g. PRV-82K9-X7QM"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-sm font-mono tracking-wider text-foreground placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-center"
            />
          </div>

          <div className="p-3 rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span>Direct LAN Key Exchange</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Upon token verification, an encrypted Diffie-Hellman session key is established with the conversation host.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setJoinModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !code.trim()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              <span>Verify & Join Chat</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

