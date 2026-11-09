import React, { useState } from 'react';
import { Lock, X, Loader2 } from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';

export const CreatePrivateChatModal: React.FC = () => {
  const { isCreateModalOpen, setCreateModalOpen, createConversation, isLoading, error, setError } =
    usePrivateChatStore();

  const [title, setTitle] = useState('');

  if (!isCreateModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Please enter a conversation title');
      return;
    }

    try {
      await createConversation(title.trim());
      setTitle('');
      setCreateModalOpen(false);
    } catch {
      // error handled in store
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-md p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Create Isolated Private Chat</h3>
          </div>
          <button
            onClick={() => setCreateModalOpen(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 ease-out"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Conversation Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Project Orion Vault"
              autoFocus
              className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-150 ease-out"
            />
          </div>

          <div className="p-3 rounded-md bg-muted border border-border text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" />
              <span>Invitation-Based Access Control</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Once created, you can invite peers by generating cryptographically secure PRV invitation tokens.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 ease-out"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim()}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary flex items-center gap-2 cursor-pointer"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />}
              <span>Create Private Chat</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
