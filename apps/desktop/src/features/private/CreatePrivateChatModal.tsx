import React, { useState } from 'react';
import { X, Shield, Lock, Loader2 } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';

export const CreatePrivateChatModal: React.FC = () => {
  const { isCreateModalOpen, setCreateModalOpen, createConversation, isLoading, error } = usePrivateChatStore();
  const [title, setTitle] = useState('');

  if (!isCreateModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await createConversation(title.trim());
      setTitle('');
    } catch {
      // handled in store
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Create Private Chat</h3>
              <p className="text-[11px] text-muted-foreground">Hidden from normal chat lists and searches</p>
            </div>
          </div>
          <button
            onClick={() => setCreateModalOpen(false)}
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
            <label className="text-xs font-semibold text-foreground">Conversation Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Project Orion Vault"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-muted/40 border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>

          <div className="p-3 rounded-xl bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" />
              <span>Invitation-Based Access Control</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Once created, you can invite peers by generating cryptographically secure PRV-xxxx-xxxx invitation tokens.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-2 cursor-pointer"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Create Private Chat</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

