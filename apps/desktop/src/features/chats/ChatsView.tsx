import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search,
  MessageSquare,
  Shield,
  ShieldCheck,
  Plus,
  Users,
  Phone,
  Video,
  X,
  Loader2,
  Crown,
  Monitor,
  Pin,
  BellOff,
  Archive,
  Upload,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { useChatStore, ChatFilter, cleanIpcError } from '../../stores/chatStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProfileStore } from '../../stores/profileStore';
import { useTransferStore } from '../../stores/transferStore';
import { useCallStore } from '../../stores/callStore';
import { CreateGroupModal } from './CreateGroupModal';
import { NewDirectChatModal } from './NewDirectChatModal';
import { DirectConnectModal } from '../devices/DirectConnectModal';
import { MessageItem, ConversationItem } from '@ipm/shared';
import { ConversationContextMenu, ConversationAction } from './ConversationContextMenu';
import { MessageBubble } from './MessageBubble';
import { MessageComposer, ComposerHandle, StagedFile } from './MessageComposer';
import { ForwardMessageDialog } from './ForwardMessageDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { filesToUploads, formatDayLabel, messagePlainText, parseFileMeta } from '@/lib/messageUtils';

type ConfirmState =
  | { kind: 'deleteChat'; conv: ConversationItem }
  | { kind: 'clearChat'; conv: ConversationItem }
  | { kind: 'lockChat'; conv: ConversationItem }
  | { kind: 'deleteMessage'; msg: MessageItem; forEveryone: boolean }
  | null;

const FILTER_TABS: Array<{ id: ChatFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'direct', label: 'Direct' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
];

export const ChatsView: React.FC = () => {
  const { profile } = useProfileStore();
  const { devices } = useDeviceStore();
  const { transfers } = useTransferStore();
  const { startCall } = useCallStore();
  const {
    conversations,
    activeConversationId,
    messagesByConversation,
    typingPeers,
    filterTab,
    searchResults,
    isLoadingConversations,
    isLoadingMessages,
    isSending,
    isGroupModalOpen,
    isDirectChatModalOpen,
    actionError,
    fetchConversations,
    selectConversation,
    createDirectChat,
    sendMessage,
    sendMessageTo,
    sendFiles,
    sendTyping,
    searchMessages,
    clearSearch,
    setFilterTab,
    setGroupModalOpen,
    setDirectChatModalOpen,
    deleteConversation,
    clearConversation,
    setConversationFlags,
    markConversationUnread,
    markAsRead,
    deleteMessage,
    editMessage,
    reactToMessage,
    setMessageFlags,
    setActionError,
  } = useChatStore();

  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [editing, setEditing] = useState<MessageItem | null>(null);
  const [forwarding, setForwarding] = useState<MessageItem | null>(null);
  const [infoFor, setInfoFor] = useState<MessageItem | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [isDirectConnectOpen, setIsDirectConnectOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentlyTypingRef = useRef(false);
  const dragDepth = useRef(0);

  const myIds = useMemo(() => new Set([profile?.id, profile?.deviceId].filter(Boolean) as string[]), [profile]);
  const localDeviceId = profile?.deviceId ?? '';

  useEffect(() => {
    fetchConversations();
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMessages = activeConversationId ? messagesByConversation[activeConversationId] ?? [] : [];
  const activeConv: ConversationItem | undefined = conversations.find((c) => c.id === activeConversationId);

  // Reset per-conversation UI state
  useEffect(() => {
    setReplyingTo(null);
    setEditing(null);
  }, [activeConversationId]);

  // Stick to bottom on new messages (unless the user scrolled up to read history)
  const lastMessageId = activeMessages[activeMessages.length - 1]?.id;
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200;
    const last = activeMessages[activeMessages.length - 1];
    if (nearBottom || (last && myIds.has(last.senderId))) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId]);

  useEffect(() => {
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView());
  }, [activeConversationId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 8000);
    return () => clearTimeout(t);
  }, [actionError, setActionError]);

  const targetPeerDeviceId =
    activeConv?.peerDeviceId || activeConv?.memberDeviceIds?.find((id) => !myIds.has(id));
  const peerDevice = targetPeerDeviceId ? devices.find((d) => d.id === targetPeerDeviceId) : undefined;

  const getDeviceDisplayName = useCallback(
    (deviceId: string) => {
      if (myIds.has(deviceId)) return profile ? `${profile.displayName} (You)` : 'You';
      const dev = devices.find((d) => d.id === deviceId);
      return dev ? dev.displayName : `Device ${deviceId.slice(0, 8)}`;
    },
    [devices, myIds, profile]
  );

  const typingNames = (activeConversationId ? typingPeers[activeConversationId] ?? [] : [])
    .filter((id) => !myIds.has(id))
    .map(getDeviceDisplayName);

  const filteredConversations = conversations.filter((c) => {
    if (filterTab === 'archived') {
      if (!c.isArchived) return false;
    } else if (c.isArchived) {
      return false;
    }
    if (filterTab === 'direct' && c.type !== 'direct') return false;
    if (filterTab === 'groups' && c.type !== 'group') return false;
    if (filterTab === 'unread' && !(c.unreadCount > 0 || c.isMarkedUnread)) return false;

    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      return c.title.toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const archivedCount = conversations.filter((c) => c.isArchived).length;

  const matchingLanDevices = filterSearch.trim()
    ? devices.filter(
        (d) =>
          !myIds.has(d.id) &&
          (d.displayName.toLowerCase().includes(filterSearch.toLowerCase()) ||
            d.hostname.toLowerCase().includes(filterSearch.toLowerCase()) ||
            d.ipAddress.includes(filterSearch))
      )
    : [];

  const pinnedMessages = activeMessages.filter((m) => m.isPinned && !m.isDeleted);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleTyping = (val: string) => {
    if (val.trim().length > 0) {
      if (!isCurrentlyTypingRef.current) {
        isCurrentlyTypingRef.current = true;
        sendTyping(true);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        isCurrentlyTypingRef.current = false;
        sendTyping(false);
      }, 2500);
    } else if (isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = false;
      sendTyping(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  };

  const handleSend = async (text: string) => {
    const replyId = replyingTo?.id;
    setReplyingTo(null);
    try {
      await sendMessage(text, replyId);
    } catch (err) {
      setActionError(cleanIpcError(err));
    }
  };

  const handleSendFiles = async (files: StagedFile[], caption: string) => {
    if (!activeConversationId) return;
    const fromPaths = files.filter((f) => f.path).map((f) => ({ path: f.path!, name: f.name, type: f.type }));
    const inMemory = await filesToUploads(
      files.filter((f) => !f.path && f.file).map((f) => f.file!),
      () => ''
    );
    await sendFiles(activeConversationId, [...fromPaths, ...inMemory], caption || undefined);
  };

  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) {
      setToast('Original message is not loaded');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(messageId);
    setTimeout(() => setHighlightedId((id) => (id === messageId ? null : id)), 1600);
  };

  const handleForward = async (message: MessageItem, conversationIds: string[]) => {
    const meta = parseFileMeta(message);
    for (const convId of conversationIds) {
      try {
        if (meta) {
          const tid = myIds.has(message.senderId) ? Object.values(meta.transferIds)[0] : meta.transferIds[localDeviceId];
          const t = transfers.find((x) => x.id === tid);
          const path = t && (t.direction === 'outgoing' || t.status === 'completed') ? t.finalPath : null;
          if (!path) throw new Error('Download the file before forwarding it');
          await sendFiles(convId, [{ path, name: meta.fileName }], meta.caption);
        } else {
          await sendMessageTo(convId, message.content);
        }
      } catch (err) {
        setActionError(cleanIpcError(err));
        return;
      }
    }
    setToast(conversationIds.length > 1 ? `Forwarded to ${conversationIds.length} chats` : 'Forwarded');
  };

  const handleConversationAction = async (action: ConversationAction, c: ConversationItem) => {
    const peerId = c.peerDeviceId || c.memberDeviceIds?.find((id) => !myIds.has(id));
    switch (action) {
      case 'open':
        return selectConversation(c.id);
      case 'pin':
      case 'unpin':
        return setConversationFlags(c.id, { isPinned: action === 'pin' });
      case 'mute':
      case 'unmute':
        return setConversationFlags(c.id, { isMuted: action === 'mute' });
      case 'archive':
      case 'unarchive':
        return setConversationFlags(c.id, { isArchived: action === 'archive' });
      case 'markRead':
        await markAsRead(c.id);
        await markConversationUnread(c.id, false);
        return;
      case 'markUnread':
        return markConversationUnread(c.id, true);
      case 'lock':
        return setConfirm({ kind: 'lockChat', conv: c });
      case 'voiceCall':
        return peerId && startCall(c.id, peerId, 'voice');
      case 'videoCall':
        return peerId && startCall(c.id, peerId, 'video');
      case 'screenShare':
        return peerId && startCall(c.id, peerId, 'screen');
      case 'sendFile': {
        const paths = await window.api?.selectFile?.();
        if (paths?.length) await sendFiles(c.id, paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p })));
        return;
      }
      case 'copyName':
        await window.api?.writeClipboardText?.(c.title);
        return setToast('Copied');
      case 'copyAddress': {
        const dev = devices.find((d) => d.id === peerId);
        if (dev) {
          await window.api?.writeClipboardText?.(`${dev.ipAddress}:${dev.tcpPort}`);
          setToast('Copied');
        }
        return;
      }
      case 'clear':
        return setConfirm({ kind: 'clearChat', conv: c });
      case 'delete':
        return setConfirm({ kind: 'deleteChat', conv: c });
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    switch (current.kind) {
      case 'deleteChat':
        await deleteConversation(current.conv.id);
        break;
      case 'clearChat':
        await clearConversation(current.conv.id);
        break;
      case 'lockChat':
        await setConversationFlags(current.conv.id, { isChatLocked: true });
        if (!useChatStore.getState().actionError) setToast('Chat moved to Private Chats');
        break;
      case 'deleteMessage':
        await deleteMessage(current.msg, current.forEveryone);
        break;
    }
  };

  // Drag & drop files anywhere on the chat pane
  const onDragEnter = (e: React.DragEvent) => {
    if (!activeConv || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!activeConv) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) composerRef.current?.addFiles(files);
  };

  const formatListTimestamp = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const confirmCopy: Record<string, { title: string; body: string; action: string; destructive: boolean }> = {
    deleteChat: {
      title: 'Delete this chat?',
      body: 'All messages in this chat will be removed from this device. Other participants keep their copy.',
      action: 'Delete chat',
      destructive: true,
    },
    clearChat: {
      title: 'Clear chat history?',
      body: 'All messages will be removed from this device. The chat stays in your list.',
      action: 'Clear history',
      destructive: true,
    },
    lockChat: {
      title: 'Lock this chat?',
      body: 'The chat moves to Private Chats and can only be opened with your Private Chats PIN. Notifications will hide message content.',
      action: 'Lock chat',
      destructive: false,
    },
    deleteMessage: {
      title: 'Delete message?',
      body: 'This removes the message from this device only.',
      action: 'Delete for me',
      destructive: true,
    },
    unsend: {
      title: 'Unsend message?',
      body: 'The message will be removed for everyone in this chat. They will see "This message was deleted".',
      action: 'Unsend',
      destructive: true,
    },
  };
  const confirmKey = confirm ? (confirm.kind === 'deleteMessage' && confirm.forEveryone ? 'unsend' : confirm.kind) : null;

  return (
    <div className="flex-1 flex overflow-hidden select-none">
      {/* 1. Conversation list */}
      <div className="w-80 border-r border-border flex flex-col bg-card/40 shrink-0">
        <div className="p-3 border-b border-border space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" /> Conversations
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDirectChatModalOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="New direct chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGroupModalOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="New group chat"
              >
                <Users className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => {
                setFilterSearch(e.target.value);
                if (e.target.value.length > 2) searchMessages(e.target.value);
                else if (!e.target.value) clearSearch();
              }}
              placeholder="Search chats & messages..."
              className="w-full pl-8 pr-8 py-1.5 text-xs rounded-xl bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
            {filterSearch && (
              <button
                onClick={() => {
                  setFilterSearch('');
                  clearSearch();
                }}
                className="absolute right-2 top-2 p-0.5 rounded text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center bg-muted p-0.5 rounded-md text-xs font-medium">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={cn(
                  'flex-1 py-1 rounded text-[10.5px] transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary',
                  filterTab === tab.id
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
                {tab.id === 'archived' && archivedCount > 0 ? ` ${archivedCount}` : ''}
              </button>
            ))}
          </div>
        </div>

        {searchResults && searchResults.length > 0 && (
          <div className="p-2 border-b border-border bg-primary/5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-primary px-2 mb-1">
              <span>Found {searchResults.length} message matches</span>
              <button onClick={clearSearch} className="hover:underline">
                Clear
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {searchResults.map((sm) => (
                <button
                  key={sm.id}
                  onClick={async () => {
                    await selectConversation(sm.conversationId);
                    setTimeout(() => jumpToMessage(sm.id), 150);
                  }}
                  className="w-full text-left p-1.5 rounded-lg hover:bg-card text-xs truncate transition-colors"
                >
                  <p className="text-[11px] font-medium text-foreground truncate">{messagePlainText(sm)}</p>
                  <span className="text-[10px] text-muted-foreground">{formatListTimestamp(sm.sentAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-border/30">
          {matchingLanDevices.length > 0 && (
            <div className="p-2 border-b border-border bg-primary/5">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center justify-between">
                <span>LAN peers ({matchingLanDevices.length})</span>
              </div>
              <div className="space-y-1 mt-1">
                {matchingLanDevices.map((d) => (
                  <div
                    key={d.id}
                    className="p-2 rounded-md bg-card hover:bg-muted border border-border flex items-center justify-between gap-2 shadow-sm transition-colors duration-150 ease-out"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                        {d.displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">{d.displayName}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {d.ipAddress} • {d.hostname}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await createDirectChat(d.id);
                        setFilterSearch('');
                      }}
                      className="px-3 py-1 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 transition-colors shadow-sm"
                    >
                      Chat
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLoadingConversations && conversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" />
              <span>Loading conversations...</span>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                {filterTab === 'archived' ? <Archive className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {filterSearch
                  ? 'No matching conversations.'
                  : filterTab === 'archived'
                  ? 'No archived chats.'
                  : filterTab === 'unread'
                  ? 'You are all caught up.'
                  : 'No conversations yet.'}
              </p>
              {filterTab === 'all' && !filterSearch && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <button
                    onClick={() => setDirectChatModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
                  >
                    Start direct chat
                  </button>
                  <button
                    onClick={() => setGroupModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors"
                  >
                    Create LAN group
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = activeConversationId === c.id;
              const peer = c.peerDeviceId ? devices.find((d) => d.id === c.peerDeviceId) : undefined;
              const isOnline = c.type === 'direct' ? peer?.status === 'online' : true;
              const unread = c.unreadCount > 0 || c.isMarkedUnread;

              return (
                <ConversationContextMenu key={c.id} conversation={c} peerDevice={peer} onAction={handleConversationAction}>
                  <button
                    onClick={() => selectConversation(c.id)}
                    className={cn(
                      'w-full p-3 flex items-start gap-3 text-left transition-colors border-l-2',
                      isSelected ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-muted/40'
                    )}
                  >
                    <div className="relative shrink-0">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs',
                          c.type === 'group'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-primary/15 text-primary'
                        )}
                      >
                        {c.type === 'group' ? <Users className="w-5 h-5" /> : c.title.slice(0, 2).toUpperCase()}
                      </div>
                      {c.type === 'direct' && (
                        <span
                          className={cn(
                            'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background',
                            isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/60'
                          )}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-1">
                        <span className={cn('text-xs text-foreground truncate', unread ? 'font-bold' : 'font-semibold')}>
                          {c.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                          {c.isMuted && <BellOff className="w-3 h-3" aria-label="Muted" />}
                          {c.isPinned && <Pin className="w-3 h-3" aria-label="Pinned" />}
                          {formatListTimestamp(c.lastActivityAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn('text-xs truncate flex-1', unread ? 'text-foreground' : 'text-muted-foreground')}>
                          {c.lastMessage ? c.lastMessage : 'No messages yet'}
                        </p>
                        {unread && (
                          <span
                            className={cn(
                              'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold shrink-0 flex items-center justify-center',
                              c.isMuted ? 'bg-muted-foreground/40 text-background' : 'bg-primary text-primary-foreground'
                            )}
                          >
                            {c.unreadCount > 0 ? c.unreadCount : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </ConversationContextMenu>
              );
            })
          )}
        </div>
      </div>

      {/* 2. Conversation pane */}
      <div
        className="flex-1 flex flex-col bg-background overflow-hidden relative"
        onDragEnter={onDragEnter}
        onDragOver={(e) => activeConv && e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {activeConv ? (
          <>
            <div className="h-14 border-b border-border px-5 flex items-center justify-between bg-card/30 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0',
                    activeConv.type === 'group'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-primary/15 text-primary'
                  )}
                >
                  {activeConv.type === 'group' ? <Users className="w-5 h-5" /> : activeConv.title.slice(0, 2).toUpperCase()}
                </div>

                <div className="truncate">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xs text-foreground truncate">{activeConv.title}</h3>
                    {activeConv.type === 'group' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                        {activeConv.isHost ? (
                          <>
                            <Crown className="w-2.5 h-2.5" /> You are host
                          </>
                        ) : (
                          'LAN group'
                        )}
                      </span>
                    )}
                    {activeConv.type === 'direct' && peerDevice && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px] px-1.5 rounded font-semibold',
                          peerDevice.isTrusted ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {peerDevice.isTrusted ? (
                          <>
                            <ShieldCheck className="w-2.5 h-2.5" /> Trusted
                          </>
                        ) : (
                          <>
                            <Shield className="w-2.5 h-2.5" /> Unverified
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {typingNames.length > 0
                      ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
                      : activeConv.type === 'group'
                      ? `${activeConv.memberDeviceIds?.length || 1} members`
                      : peerDevice
                      ? `${peerDevice.hostname} • ${peerDevice.ipAddress}:${peerDevice.tcpPort} (${peerDevice.status})`
                      : 'Direct P2P link (TLS 1.3)'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {(['voice', 'video', 'screen'] as const).map((type) => {
                  const Icon = type === 'voice' ? Phone : type === 'video' ? Video : Monitor;
                  const label = type === 'voice' ? 'Voice call' : type === 'video' ? 'Video call' : 'Share screen';
                  return (
                    <button
                      key={type}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={targetPeerDeviceId && activeConv.type === 'direct' ? label : `${label} is available in direct chats`}
                      disabled={!targetPeerDeviceId || activeConv.type !== 'direct'}
                      onClick={() => targetPeerDeviceId && startCall(activeConv.id, targetPeerDeviceId, type)}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            {pinnedMessages.length > 0 && (
              <button
                onClick={() => jumpToMessage(pinnedMessages[pinnedMessages.length - 1]!.id)}
                className="px-5 py-1.5 border-b border-border bg-card/40 flex items-center gap-2 text-left text-[11px] hover:bg-muted/50 transition-colors shrink-0"
              >
                <Pin className="w-3 h-3 text-primary shrink-0" />
                <span className="font-semibold text-primary shrink-0">
                  {pinnedMessages.length > 1 ? `${pinnedMessages.length} pinned` : 'Pinned'}
                </span>
                <span className="truncate text-foreground/80">{messagePlainText(pinnedMessages[pinnedMessages.length - 1]!)}</span>
              </button>
            )}

            <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {isLoadingMessages && activeMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2 text-primary" /> Loading messages...
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 select-none text-muted-foreground">
                  <MessageSquare className="w-10 h-10 stroke-1" />
                  <p className="text-xs font-semibold text-foreground">No messages in this chat yet</p>
                  <p className="text-[11px] max-w-xs text-muted-foreground">
                    Say hello, paste a screenshot with Ctrl+V, or drop files here.
                  </p>
                </div>
              ) : (
                activeMessages.map((msg, idx) => {
                  const isMe = myIds.has(msg.senderId);
                  const prev = activeMessages[idx - 1];
                  const showDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(msg.sentAt).toDateString();
                  const replyTarget = msg.replyToId ? activeMessages.find((m) => m.id === msg.replyToId) ?? null : null;
                  const showSender = !isMe && activeConv.type === 'group' && prev?.senderId !== msg.senderId;

                  return (
                    <React.Fragment key={msg.id}>
                      {showDay && (
                        <div className="flex justify-center py-1">
                          <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-2.5 py-0.5 rounded-full">
                            {formatDayLabel(msg.sentAt)}
                          </span>
                        </div>
                      )}
                      <MessageBubble
                        message={msg}
                        isMe={isMe}
                        localDeviceId={localDeviceId}
                        senderName={showSender ? getDeviceDisplayName(msg.senderId) : undefined}
                        replyTarget={replyTarget}
                        getName={getDeviceDisplayName}
                        highlighted={highlightedId === msg.id}
                        onReply={(m) => {
                          setEditing(null);
                          setReplyingTo(m);
                        }}
                        onEdit={(m) => {
                          setReplyingTo(null);
                          setEditing(m);
                        }}
                        onForward={setForwarding}
                        onDelete={(m, forEveryone) => setConfirm({ kind: 'deleteMessage', msg: m, forEveryone })}
                        onInfo={setInfoFor}
                        onReact={(m, emoji) => reactToMessage(m.id, emoji)}
                        onToggleFlag={(m, flag) =>
                          setMessageFlags(m.id, flag === 'isPinned' ? { isPinned: !m.isPinned } : { isStarred: !m.isStarred })
                        }
                        onJumpTo={jumpToMessage}
                        onCopied={() => setToast('Copied')}
                      />
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <MessageComposer
              ref={composerRef}
              placeholder={`Message ${activeConv.title}…`}
              isSending={isSending}
              replyingTo={replyingTo}
              editing={editing}
              getName={getDeviceDisplayName}
              onCancelReply={() => setReplyingTo(null)}
              onCancelEdit={() => setEditing(null)}
              onSend={handleSend}
              onSaveEdit={(m, text) => editMessage(m.id, text)}
              onSendFiles={handleSendFiles}
              onTyping={handleTyping}
            />

            {isDragging && (
              <div className="absolute inset-0 z-30 m-3 rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 pointer-events-none">
                <Upload className="w-8 h-8 text-primary" />
                <p className="text-sm font-semibold text-foreground">Drop to send to {activeConv.title}</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 select-none text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center shadow-inner">
              <MessageSquare className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="font-bold text-base text-foreground">Select a conversation</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect directly over your local Wi-Fi or Ethernet network. Right-click a chat for more options.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setDirectChatModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                Start direct chat
              </button>
              <button
                onClick={() => setGroupModalOpen(true)}
                className="px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition-colors"
              >
                Create LAN group
              </button>
            </div>
          </div>
        )}

        {/* Toasts */}
        {(toast || actionError) && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 max-w-md">
            {actionError ? (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive shadow-lg">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{actionError}</span>
                <button onClick={() => setActionError(null)} aria-label="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-medium shadow-lg">
                <Check className="w-3.5 h-3.5" /> {toast}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Dialogs */}
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          {confirmKey && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy[confirmKey]!.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy[confirmKey]!.body}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant={confirmCopy[confirmKey]!.destructive ? 'destructive' : 'default'} onClick={runConfirm}>
                  {confirmCopy[confirmKey]!.action}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(infoFor)} onOpenChange={(open) => !open && setInfoFor(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Message info</AlertDialogTitle>
            <AlertDialogDescription className="line-clamp-3">{infoFor ? messagePlainText(infoFor) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          {infoFor && (
            <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">From</dt>
              <dd className="text-foreground">{getDeviceDisplayName(infoFor.senderId)}</dd>
              <dt className="text-muted-foreground">Sent</dt>
              <dd className="text-foreground">{new Date(infoFor.sentAt).toLocaleString()}</dd>
              <dt className="text-muted-foreground">Delivered</dt>
              <dd className="text-foreground">{infoFor.deliveredAt ? new Date(infoFor.deliveredAt).toLocaleString() : '—'}</dd>
              <dt className="text-muted-foreground">Read</dt>
              <dd className="text-foreground">{infoFor.readAt ? new Date(infoFor.readAt).toLocaleString() : '—'}</dd>
              {infoFor.editedAt && (
                <>
                  <dt className="text-muted-foreground">Edited</dt>
                  <dd className="text-foreground">{new Date(infoFor.editedAt).toLocaleString()}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-foreground capitalize">{infoFor.deliveryStatus}</dd>
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ForwardMessageDialog
        message={forwarding}
        conversations={conversations.filter((c) => !c.isArchived || c.id === activeConversationId)}
        onClose={() => setForwarding(null)}
        onForward={handleForward}
      />

      <CreateGroupModal isOpen={isGroupModalOpen} onClose={() => setGroupModalOpen(false)} />
      <NewDirectChatModal
        isOpen={isDirectChatModalOpen}
        onClose={() => setDirectChatModalOpen(false)}
        onOpenDirectConnect={() => setIsDirectConnectOpen(true)}
      />
      <DirectConnectModal isOpen={isDirectConnectOpen} onClose={() => setIsDirectConnectOpen(false)} />
    </div>
  );
};
