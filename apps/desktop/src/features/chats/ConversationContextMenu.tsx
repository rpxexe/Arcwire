import React from 'react';
import {
  MessageSquare,
  Pin,
  PinOff,
  MailOpen,
  Mail,
  BellOff,
  Bell,
  Archive,
  ArchiveRestore,
  Lock,
  Phone,
  Video,
  Monitor,
  Paperclip,
  Copy,
  Eraser,
  Trash2,
} from 'lucide-react';
import type { ConversationItem, DeviceInfo } from '@ipm/shared';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export type ConversationAction =
  | 'open'
  | 'pin'
  | 'unpin'
  | 'markRead'
  | 'markUnread'
  | 'mute'
  | 'unmute'
  | 'archive'
  | 'unarchive'
  | 'lock'
  | 'voiceCall'
  | 'videoCall'
  | 'screenShare'
  | 'sendFile'
  | 'copyName'
  | 'copyAddress'
  | 'clear'
  | 'delete';

interface ConversationContextMenuProps {
  conversation: ConversationItem;
  peerDevice?: DeviceInfo;
  onAction: (action: ConversationAction, conversation: ConversationItem) => void;
  children: React.ReactNode;
}

export const ConversationContextMenu: React.FC<ConversationContextMenuProps> = ({
  conversation: c,
  peerDevice,
  onAction,
  children,
}) => {
  const act = (action: ConversationAction) => () => onAction(action, c);
  const isUnread = c.unreadCount > 0 || c.isMarkedUnread;
  const canCall = c.type === 'direct' && Boolean(c.peerDeviceId);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel className="truncate">{c.title}</ContextMenuLabel>
        <ContextMenuSeparator />

        <ContextMenuItem onSelect={act('open')}>
          <MessageSquare /> Open chat
        </ContextMenuItem>
        {c.isPinned ? (
          <ContextMenuItem onSelect={act('unpin')}>
            <PinOff /> Unpin chat
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={act('pin')}>
            <Pin /> Pin to top
          </ContextMenuItem>
        )}
        {isUnread ? (
          <ContextMenuItem onSelect={act('markRead')}>
            <MailOpen /> Mark as read
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={act('markUnread')}>
            <Mail /> Mark as unread
          </ContextMenuItem>
        )}
        {c.isMuted ? (
          <ContextMenuItem onSelect={act('unmute')}>
            <Bell /> Unmute notifications
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={act('mute')}>
            <BellOff /> Mute notifications
          </ContextMenuItem>
        )}
        {c.isArchived ? (
          <ContextMenuItem onSelect={act('unarchive')}>
            <ArchiveRestore /> Unarchive
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={act('archive')}>
            <Archive /> Archive
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={act('lock')}>
          <Lock /> Lock chat
        </ContextMenuItem>

        <ContextMenuSeparator />

        {canCall && (
          <>
            <ContextMenuItem onSelect={act('voiceCall')}>
              <Phone /> Voice call
            </ContextMenuItem>
            <ContextMenuItem onSelect={act('videoCall')}>
              <Video /> Video call
            </ContextMenuItem>
            <ContextMenuItem onSelect={act('screenShare')}>
              <Monitor /> Share screen
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem onSelect={act('sendFile')}>
          <Paperclip /> Send file…
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Copy /> Copy
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onSelect={act('copyName')}>Chat name</ContextMenuItem>
            {peerDevice && (
              <ContextMenuItem onSelect={act('copyAddress')}>
                IP address ({peerDevice.ipAddress})
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onSelect={act('clear')}>
          <Eraser /> Clear chat history
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={act('delete')}>
          <Trash2 /> Delete chat
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
