import React, { useState } from 'react';
import {
  Reply,
  Copy,
  Pencil,
  Forward,
  Pin,
  PinOff,
  Star,
  StarOff,
  Info,
  Trash2,
  Smile,
  MoreHorizontal,
  ExternalLink,
  FolderOpen,
  Download,
  Plus,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Ban,
} from 'lucide-react';
import type { MessageItem } from '@ipm/shared';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { QUICK_REACTIONS, formatMessageTime, messagePlainText, parseFileMeta } from '@/lib/messageUtils';
import { FileAttachmentBubble } from './FileAttachmentBubble';
import { EmojiPickerButton } from './EmojiPickerButton';
import { useTransferStore } from '../../stores/transferStore';

export interface MessageBubbleProps {
  message: MessageItem;
  isMe: boolean;
  localDeviceId: string;
  senderName?: string; // shown for incoming group messages
  replyTarget?: MessageItem | null;
  getName: (deviceId: string) => string;
  highlighted?: boolean;
  onReply: (msg: MessageItem) => void;
  onEdit: (msg: MessageItem) => void;
  onForward: (msg: MessageItem) => void;
  onDelete: (msg: MessageItem, forEveryone: boolean) => void;
  onInfo: (msg: MessageItem) => void;
  onReact: (msg: MessageItem, emoji: string) => void;
  onToggleFlag: (msg: MessageItem, flag: 'isPinned' | 'isStarred') => void;
  onJumpTo: (messageId: string) => void;
  onCopied?: () => void;
}

type MenuKit = {
  Item: React.ElementType;
  Separator: React.ElementType;
  Shortcut: React.ElementType;
};

const ReceiptIcon: React.FC<{ status: MessageItem['deliveryStatus'] }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <Clock className="w-3 h-3 opacity-70" aria-label="Pending" />;
    case 'sent':
      return <Check className="w-3 h-3 opacity-80" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="w-3 h-3 opacity-90" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck className="w-3 h-3 text-sky-300 stroke-[2.5]" aria-label="Read" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-rose-400" aria-label="Failed" />;
    default:
      return null;
  }
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  localDeviceId,
  senderName,
  replyTarget,
  getName,
  highlighted,
  onReply,
  onEdit,
  onForward,
  onDelete,
  onInfo,
  onReact,
  onToggleFlag,
  onJumpTo,
  onCopied,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { transfers, openFile, openFolder, saveAs } = useTransferStore();

  const meta = parseFileMeta(message);
  const isDeleted = Boolean(message.isDeleted);
  const text = messagePlainText(message);

  const myTransferId = meta ? (isMe ? Object.values(meta.transferIds)[0] : meta.transferIds[localDeviceId]) : undefined;
  const myTransfer = myTransferId ? transfers.find((t) => t.id === myTransferId) : undefined;
  const localFilePath =
    myTransfer && (myTransfer.direction === 'outgoing' || myTransfer.status === 'completed') ? myTransfer.finalPath ?? undefined : undefined;

  const reactions = Object.entries(message.reactions ?? {}).filter(([, ids]) => ids.length > 0);
  const myReaction = reactions.find(([, ids]) => ids.includes(localDeviceId))?.[0];

  const copyText = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await window.api?.writeClipboardText?.(text);
    }
    onCopied?.();
  };

  const renderMenuItems = ({ Item, Separator, Shortcut }: MenuKit) => {
    if (isDeleted) {
      return (
        <Item variant="destructive" onSelect={() => onDelete(message, false)}>
          <Trash2 /> Delete for me
        </Item>
      );
    }
    return (
      <>
        <Item onSelect={() => onReply(message)}>
          <Reply /> Reply <Shortcut>R</Shortcut>
        </Item>
        {text && (
          <Item onSelect={copyText}>
            <Copy /> {meta ? 'Copy file name' : 'Copy text'}
          </Item>
        )}
        {isMe && message.contentType === 'text' && (
          <Item onSelect={() => onEdit(message)}>
            <Pencil /> Edit
          </Item>
        )}
        <Item onSelect={() => onForward(message)}>
          <Forward /> Forward
        </Item>
        <Item onSelect={() => onToggleFlag(message, 'isPinned')}>
          {message.isPinned ? (
            <>
              <PinOff /> Unpin
            </>
          ) : (
            <>
              <Pin /> Pin
            </>
          )}
        </Item>
        <Item onSelect={() => onToggleFlag(message, 'isStarred')}>
          {message.isStarred ? (
            <>
              <StarOff /> Unstar
            </>
          ) : (
            <>
              <Star /> Star
            </>
          )}
        </Item>
        {localFilePath && (
          <>
            <Separator />
            <Item onSelect={() => openFile(localFilePath)}>
              <ExternalLink /> Open file
            </Item>
            <Item onSelect={() => openFolder(localFilePath)}>
              <FolderOpen /> Show in folder
            </Item>
            <Item onSelect={() => saveAs(localFilePath)}>
              <Download /> Save as…
            </Item>
          </>
        )}
        <Separator />
        <Item onSelect={() => onInfo(message)}>
          <Info /> Message info
        </Item>
        <Separator />
        <Item variant="destructive" onSelect={() => onDelete(message, false)}>
          <Trash2 /> Delete for me
        </Item>
        {isMe && (
          <Item variant="destructive" onSelect={() => onDelete(message, true)}>
            <Ban /> Unsend for everyone
          </Item>
        )}
      </>
    );
  };

  const hoverButton =
    'p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <div
      id={`msg-${message.id}`}
      className={cn('flex flex-col group/msg', isMe ? 'items-end' : 'items-start', reactions.length > 0 && 'mb-2')}
    >
      {senderName && <span className="text-[10px] text-muted-foreground font-semibold px-3 mb-0.5">{senderName}</span>}

      <div className={cn('flex items-center gap-1 max-w-[78%]', isMe ? 'flex-row-reverse' : 'flex-row')}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onDoubleClick={() => !isDeleted && onReact(message, '❤️')}
              className={cn(
                'relative min-w-0 rounded-2xl px-3.5 py-2 text-xs shadow-xs select-text transition-shadow',
                isMe ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border border-border text-foreground rounded-bl-md',
                isDeleted && 'opacity-70',
                highlighted && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
              )}
            >
              {/* Reply quote */}
              {replyTarget && !isDeleted && (
                <button
                  type="button"
                  onClick={() => onJumpTo(replyTarget.id)}
                  className={cn(
                    'mb-1.5 block w-full text-left px-2 py-1.5 rounded-lg text-[10px] truncate',
                    isMe ? 'bg-black/15 text-white/90' : 'bg-muted text-foreground/80'
                  )}
                >
                  <span className="font-semibold block truncate">{getName(replyTarget.senderId)}</span>
                  <span className="truncate block opacity-80">
                    {replyTarget.isDeleted ? 'This message was deleted' : messagePlainText(replyTarget)}
                  </span>
                </button>
              )}

              {isDeleted ? (
                <p className="italic flex items-center gap-1.5">
                  <Ban className="w-3 h-3" /> This message was deleted
                </p>
              ) : meta ? (
                <FileAttachmentBubble meta={meta} isMe={isMe} localDeviceId={localDeviceId} />
              ) : (
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
              )}

              {/* Footer */}
              <div
                className={cn(
                  'flex items-center justify-end gap-1 mt-1 text-[9px]',
                  isMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
                )}
              >
                {message.isPinned && <Pin className="w-2.5 h-2.5" aria-label="Pinned" />}
                {message.isStarred && <Star className="w-2.5 h-2.5 fill-current" aria-label="Starred" />}
                {message.editedAt && !isDeleted && <span>edited</span>}
                <span>{formatMessageTime(message.sentAt)}</span>
                {isMe && !isDeleted && <ReceiptIcon status={message.deliveryStatus} />}
              </div>

              {/* Reactions */}
              {reactions.length > 0 && (
                <div className={cn('absolute -bottom-3 flex gap-0.5', isMe ? 'right-2' : 'left-2')}>
                  {reactions.map(([emoji, ids]) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onReact(message, emoji)}
                      title={ids.map((id) => (id === localDeviceId ? 'You' : getName(id))).join(', ')}
                      className={cn(
                        'h-5 px-1.5 rounded-full border text-[11px] leading-none flex items-center gap-0.5 shadow-sm bg-card text-foreground',
                        ids.includes(localDeviceId) ? 'border-primary' : 'border-border'
                      )}
                    >
                      <span>{emoji}</span>
                      {ids.length > 1 && <span className="text-[9px] text-muted-foreground">{ids.length}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent className="w-56">
            {!isDeleted && (
              <>
                <div className="flex items-center justify-between gap-0.5 px-1 py-1" role="group" aria-label="React">
                  {QUICK_REACTIONS.map((emoji) => (
                    <ContextMenuItem
                      key={emoji}
                      onSelect={() => onReact(message, emoji)}
                      className={cn(
                        'h-8 w-8 justify-center rounded-full p-0 text-base',
                        myReaction === emoji && 'bg-primary/15'
                      )}
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuItem
                    onSelect={() => setTimeout(() => setPickerOpen(true), 0)}
                    className="h-8 w-8 justify-center rounded-full p-0"
                    aria-label="More reactions"
                  >
                    <Plus />
                  </ContextMenuItem>
                </div>
                <ContextMenuSeparator />
              </>
            )}
            {renderMenuItems({ Item: ContextMenuItem, Separator: ContextMenuSeparator, Shortcut: ContextMenuShortcut })}
          </ContextMenuContent>
        </ContextMenu>

        {/* Hover actions (Instagram style) */}
        {!isDeleted && (
          <div
            className={cn(
              'flex items-center gap-0.5 shrink-0 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity',
              (pickerOpen || menuOpen) && 'opacity-100',
              isMe ? 'flex-row-reverse' : 'flex-row'
            )}
          >
            <EmojiPickerButton
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              closeOnSelect
              side="top"
              align={isMe ? 'end' : 'start'}
              onSelect={(emoji) => onReact(message, emoji)}
              trigger={
                <button type="button" className={hoverButton} title="React" aria-label="React">
                  <Smile className="w-3.5 h-3.5" />
                </button>
              }
            />
            <button type="button" className={hoverButton} title="Reply" aria-label="Reply" onClick={() => onReply(message)}>
              <Reply className="w-3.5 h-3.5" />
            </button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={hoverButton} title="More" aria-label="More actions">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isMe ? 'end' : 'start'} className="w-52">
                {renderMenuItems({ Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
};
