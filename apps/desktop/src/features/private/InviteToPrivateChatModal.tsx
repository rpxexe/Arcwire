import React, { useState, useEffect } from 'react';
import { X, Key, Copy, Check, Shield, Clock, Users, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';

export const InviteToPrivateChatModal: React.FC = () => {
  const {
    isInviteModalOpen,
    setInviteModalOpen,
    activeConversationId,
    invitationsByConversation,
    createInvitation,
    revokeInvitation,
    listInvitations,
    error,
  } = usePrivateChatStore();

  const [maxUses, setMaxUses] = useState<number>(1);
  const [expiresInHours, setExpiresInHours] = useState<number>(24);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  useEffect(() => {
    if (isInviteModalOpen && activeConversationId) {
      listInvitations(activeConversationId);
      setGeneratedCode(null);
      setCopied(false);
    }
  }, [isInviteModalOpen, activeConversationId]);

  if (!isInviteModalOpen || !activeConversationId) return null;

  const currentInvitations = invitationsByConversation[activeConversationId] || [];

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await createInvitation(activeConversationId, maxUses, expiresInHours);
      setGeneratedCode(res.code);
    } catch {
      // handled in store
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatExpiry = (timestamp: number) => {
    const diff = timestamp - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.ceil(diff / (1000 * 60 * 60));
    if (hours > 24) {
      return `${Math.ceil(hours / 24)} days left`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''} left`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Peer Invitation Tokens</h3>
              <p className="text-[11px] text-muted-foreground">Single-use or time-bound cryptographically secure tokens</p>
            </div>
          </div>
          <button
            onClick={() => setInviteModalOpen(false)}
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

        <div className="space-y-4 overflow-y-auto pr-1">
          {/* New Code Generator Section */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3.5">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span>Generate Invitation Token</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>Maximum Uses</span>
                </label>
                <select
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value={1}>1 use (Single-use)</option>
                  <option value={3}>3 uses</option>
                  <option value={5}>5 uses</option>
                  <option value={10}>10 uses</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Expires In</span>
                </label>
                <select
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={24}>24 hours (1 day)</option>
                  <option value={72}>72 hours (3 days)</option>
                  <option value={168}>7 days</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full py-2 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
              <span>Generate New PRV Token</span>
            </button>

            {/* Generated Code Display Card */}
            {generatedCode && (
              <div className="mt-3 p-3.5 rounded-xl bg-card border-2 border-primary/30 space-y-2">
                <div className="text-[11px] font-semibold text-primary uppercase tracking-wider flex items-center justify-between">
                  <span>Share Token With Peer</span>
                  <span className="text-[10px] text-muted-foreground">Expires in {expiresInHours}h</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-2.5 rounded-lg bg-muted text-base font-mono font-bold text-center tracking-widest text-foreground select-all border border-border">
                    {generatedCode}
                  </div>
                  <button
                    onClick={handleCopy}
                    className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow flex items-center justify-center"
                    title="Copy code"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  The raw token is only visible now. For security, only its SHA-256 hash is permanently saved.
                </p>
              </div>
            )}
          </div>

          {/* Active Invitations List */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground">Active & Past Tokens</h4>
            {currentInvitations.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground bg-muted/20 rounded-xl border border-border/50">
                No invitation tokens generated for this chat yet.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {currentInvitations.map((inv) => {
                  const isExpired = Date.now() > inv.expiresAt;
                  const isMaxed = inv.usedCount >= inv.maxUses;
                  const isActive = !inv.isRevoked && !isExpired && !isMaxed;

                  return (
                    <div
                      key={inv.id}
                      className="p-2.5 rounded-xl bg-muted/20 border border-border flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-foreground font-semibold">
                            Hash: {inv.codeHash.slice(0, 10)}...
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : inv.isRevoked
                                ? 'bg-rose-500/10 text-rose-500'
                                : 'bg-zinc-500/10 text-zinc-400'
                            }`}
                          >
                            {inv.isRevoked ? 'Revoked' : isExpired ? 'Expired' : isMaxed ? 'Used' : 'Active'}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Uses: {inv.usedCount}/{inv.maxUses} • {formatExpiry(inv.expiresAt)}
                        </div>
                      </div>

                      {isActive && (
                        <button
                          onClick={() => revokeInvitation(inv.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Revoke Token"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end pt-2 border-t border-border">
          <button
            onClick={() => setInviteModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
