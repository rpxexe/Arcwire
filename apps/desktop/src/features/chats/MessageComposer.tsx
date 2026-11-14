import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Paperclip, Send, Loader2, X, Pencil, Reply, FileText, Check } from 'lucide-react';
import type { MessageItem } from '@ipm/shared';
import { cn } from '@/lib/utils';
import { formatBytes, messagePlainText } from '@/lib/messageUtils';
import { EmojiPickerButton } from './EmojiPickerButton';

export interface StagedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  path?: string;
  file?: File;
  previewUrl?: string;
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
  addPaths: (paths: string[]) => void;
  focus: () => void;
}

interface MessageComposerProps {
  placeholder: string;
  isSending: boolean;
  disabled?: boolean;
  replyingTo: MessageItem | null;
  editing: MessageItem | null;
  getName: (deviceId: string) => string;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (text: string) => Promise<void> | void;
  onSaveEdit: (message: MessageItem, text: string) => Promise<void> | void;
  onSendFiles: (files: StagedFile[], caption: string) => Promise<void> | void;
  onTyping: (value: string) => void;
}

let stagedCounter = 0;

export const MessageComposer = forwardRef<ComposerHandle, MessageComposerProps>(
  (
    {
      placeholder,
      isSending,
      disabled,
      replyingTo,
      editing,
      getName,
      onCancelReply,
      onCancelEdit,
      onSend,
      onSaveEdit,
      onSendFiles,
      onTyping,
    },
    ref
  ) => {
    const [text, setText] = useState('');
    const [staged, setStaged] = useState<StagedFile[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const draftBeforeEdit = useRef('');

    const addFiles = (files: File[]) => {
      if (files.length === 0) return;
      const next: StagedFile[] = files.map((file) => {
        const path = window.api?.getPathForFile?.(file) || undefined;
        return {
          id: `stg_${++stagedCounter}`,
          name: file.name || 'pasted-file',
          size: file.size,
          type: file.type,
          path,
          file: path ? undefined : file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        };
      });
      setStaged((prev) => [...prev, ...next]);
      textareaRef.current?.focus();
    };

    const addPaths = (paths: string[]) => {
      const next: StagedFile[] = paths.map((p) => ({
        id: `stg_${++stagedCounter}`,
        name: p.split(/[\\/]/).pop() || p,
        size: 0,
        type: '',
        path: p,
      }));
      setStaged((prev) => [...prev, ...next]);
      textareaRef.current?.focus();
    };

    useImperativeHandle(ref, () => ({ addFiles, addPaths, focus: () => textareaRef.current?.focus() }));

    // Release object URLs
    useEffect(
      () => () => {
        staged.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

    // Enter / leave edit mode
    useEffect(() => {
      if (editing) {
        draftBeforeEdit.current = text;
        setText(editing.content);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        });
      } else {
        setText(draftBeforeEdit.current);
        draftBeforeEdit.current = '';
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing?.id]);

    useEffect(() => {
      if (replyingTo) textareaRef.current?.focus();
    }, [replyingTo?.id]);

    // Auto-grow textarea
    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [text]);

    const removeStaged = (id: string) =>
      setStaged((prev) => {
        const item = prev.find((s) => s.id === id);
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
        return prev.filter((s) => s.id !== id);
      });

    const insertAtCursor = (insert: string) => {
      const el = textareaRef.current;
      if (!el) {
        setText((t) => t + insert);
        return;
      }
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      const next = text.slice(0, start) + insert + text.slice(end);
      setText(next);
      onTyping(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + insert.length, start + insert.length);
      });
    };

    const submit = async () => {
      if (isSending || disabled) return;
      const trimmed = text.trim();

      if (editing) {
        if (!trimmed) return;
        if (trimmed !== editing.content) await onSaveEdit(editing, trimmed);
        onCancelEdit();
        return;
      }

      if (staged.length > 0) {
        const files = staged;
        setStaged([]);
        setText('');
        onTyping('');
        await onSendFiles(files, trimmed);
        files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        return;
      }

      if (!trimmed) return;
      setText('');
      onTyping('');
      await onSend(trimmed);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void submit();
      } else if (e.key === 'Escape') {
        if (editing) onCancelEdit();
        else if (replyingTo) onCancelReply();
        else if (staged.length) setStaged([]);
      }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (editing) return;
      const files = Array.from(e.clipboardData.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
        // Keep any plain text that was copied alongside (rare) as caption
        const plain = e.clipboardData.getData('text/plain');
        if (plain && !text) setText(plain);
      }
    };

    const pickFiles = async () => {
      const paths = await window.api?.selectFile?.();
      if (paths && paths.length) addPaths(paths);
    };

    const canSend = editing ? text.trim().length > 0 : staged.length > 0 || text.trim().length > 0;

    return (
      <div className="border-t border-border bg-card/20 shrink-0">
        {/* Reply / edit banner */}
        {(replyingTo || editing) && (
          <div className="px-4 pt-2 flex items-center gap-2 text-xs">
            <div className="flex-1 min-w-0 rounded-lg bg-muted/70 px-2 py-1">
              <span className="text-[10px] font-semibold text-primary flex items-center gap-1">
                {editing ? (
                  <>
                    <Pencil className="w-3 h-3" /> Editing message
                  </>
                ) : (
                  <>
                    <Reply className="w-3 h-3" /> Replying to {getName(replyingTo!.senderId)}
                  </>
                )}
              </span>
              <p className="text-[11px] text-foreground/80 truncate">
                {messagePlainText((editing ?? replyingTo)!)}
              </p>
            </div>
            <button
              onClick={editing ? onCancelEdit : onCancelReply}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Staged attachments */}
        {staged.length > 0 && (
          <div className="px-4 pt-2 flex gap-2 overflow-x-auto">
            {staged.map((s) => (
              <div
                key={s.id}
                className="relative shrink-0 w-28 rounded-lg border border-border bg-background overflow-hidden"
                title={s.path ?? s.name}
              >
                {s.previewUrl ? (
                  <img src={s.previewUrl} alt={s.name} className="w-full h-16 object-cover" />
                ) : (
                  <div className="w-full h-16 flex items-center justify-center bg-muted/60 text-muted-foreground">
                    <FileText className="w-6 h-6" />
                  </div>
                )}
                <div className="px-1.5 py-1">
                  <p className="text-[10px] font-medium truncate text-foreground">{s.name}</p>
                  {s.size > 0 && <p className="text-[9px] text-muted-foreground">{formatBytes(s.size)}</p>}
                </div>
                <button
                  onClick={() => removeStaged(s.id)}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                  aria-label={`Remove ${s.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="p-3">
          <div
            className={cn(
              'flex items-end gap-1.5 bg-background border border-input rounded-2xl p-1.5 focus-within:ring-1 focus-within:ring-primary',
              disabled && 'opacity-60'
            )}
          >
            {!editing && (
              <button
                type="button"
                onClick={pickFiles}
                disabled={disabled}
                className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Attach files"
                aria-label="Attach files"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            )}
            <EmojiPickerButton onSelect={insertAtCursor} />

            <textarea
              ref={textareaRef}
              value={text}
              disabled={disabled}
              onChange={(e) => {
                setText(e.target.value);
                if (!editing) onTyping(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={staged.length ? 'Add a caption… (Enter to send)' : placeholder}
              rows={1}
              className="flex-1 max-h-40 min-h-[28px] py-1.5 px-1 text-xs bg-transparent border-0 focus:outline-none resize-none text-foreground placeholder:text-muted-foreground"
            />

            <button
              onClick={() => void submit()}
              disabled={!canSend || isSending || disabled}
              className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
              title={editing ? 'Save edit' : 'Send'}
              aria-label={editing ? 'Save edit' : 'Send'}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : editing ? (
                <Check className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="mt-1 px-2 text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter new line · Ctrl+V pastes files &amp; screenshots · drag files here
          </p>
        </div>
      </div>
    );
  }
);
MessageComposer.displayName = 'MessageComposer';
