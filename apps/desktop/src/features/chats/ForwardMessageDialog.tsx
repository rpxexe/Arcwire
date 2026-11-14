import React, { useMemo, useState } from 'react';
import { Forward, Search, Users, Check, Loader2 } from 'lucide-react';
import type { ConversationItem, MessageItem } from '@ipm/shared';
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
import { cn } from '@/lib/utils';
import { messagePlainText, parseFileMeta } from '@/lib/messageUtils';

interface ForwardMessageDialogProps {
  message: MessageItem | null;
  conversations: ConversationItem[];
  onClose: () => void;
  /** Resolves when all targets were processed */
  onForward: (message: MessageItem, conversationIds: string[]) => Promise<void>;
}

export const ForwardMessageDialog: React.FC<ForwardMessageDialogProps> = ({ message, conversations, onClose, onForward }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const filtered = useMemo(
    () => conversations.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase())),
    [conversations, query]
  );

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const close = () => {
    setQuery('');
    setSelected([]);
    onClose();
  };

  const meta = message ? parseFileMeta(message) : null;

  return (
    <AlertDialog open={Boolean(message)} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Forward className="w-4 h-4 text-primary" /> Forward message
          </AlertDialogTitle>
          <AlertDialogDescription className="line-clamp-2">
            {message ? (meta ? `File: ${meta.fileName}` : messagePlainText(message)) : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="max-h-64 overflow-y-auto -mx-2 space-y-0.5">
          {filtered.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4 text-center">No chats found</p>}
          {filtered.map((c) => {
            const isSelected = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-xs transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted'
                )}
              >
                <span className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                  {c.type === 'group' ? <Users className="w-3.5 h-3.5" /> : c.title.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate font-medium text-foreground">{c.title}</span>
                <span
                  className={cn(
                    'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
                    isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-input'
                  )}
                >
                  {isSelected && <Check className="w-3 h-3" />}
                </span>
              </button>
            );
          })}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>Cancel</AlertDialogCancel>
          <Button
            disabled={selected.length === 0 || isSending}
            onClick={async () => {
              if (!message) return;
              setIsSending(true);
              try {
                await onForward(message, selected);
                close();
              } finally {
                setIsSending(false);
              }
            }}
          >
            {isSending ? <Loader2 className="animate-spin" /> : <Forward />}
            Send{selected.length > 1 ? ` to ${selected.length}` : ''}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
