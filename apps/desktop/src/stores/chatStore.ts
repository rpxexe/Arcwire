import { create } from 'zustand';
import { ConversationItem, MessageItem, ReceiptEventData } from '@ipm/shared';

/** Strips Electron's "Error invoking remote method 'x': Error:" prefix. */
export const cleanIpcError = (err: unknown): string => {
  const msg = (err as Error)?.message ?? String(err);
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
};

export type ChatFilter = 'all' | 'direct' | 'groups' | 'unread' | 'archived';

/** Pinned conversations first, then most recent activity. */
export const sortConversations = (list: ConversationItem[]): ConversationItem[] =>
  [...list].sort((a, b) => {
    const pin = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    return pin !== 0 ? pin : b.lastActivityAt - a.lastActivityAt;
  });

const STATUS_RANK: Record<MessageItem['deliveryStatus'], number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 };
const earlyReceipts = new Map<string, ReceiptEventData>();

/** Applies a receipt without ever downgrading the status. */
const applyReceipt = (m: MessageItem, receipt: ReceiptEventData): MessageItem => {
  const next: MessageItem['deliveryStatus'] =
    receipt.receiptType === 'ack' ? 'sent' : receipt.receiptType === 'delivered' ? 'delivered' : 'read';
  if (STATUS_RANK[next] <= STATUS_RANK[m.deliveryStatus]) return m;
  return {
    ...m,
    deliveryStatus: next,
    deliveredAt: receipt.receiptType === 'delivered' ? receipt.timestamp : m.deliveredAt,
    readAt: receipt.receiptType === 'read' ? receipt.timestamp : m.readAt,
  };
};

const upsertMessage = (list: MessageItem[], rawMsg: MessageItem): MessageItem[] => {
  const early = earlyReceipts.get(rawMsg.id);
  if (early) earlyReceipts.delete(rawMsg.id);
  const msg = early ? applyReceipt(rawMsg, early) : rawMsg;
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx === -1) return [...list, msg];
  const next = list.slice();
  next[idx] = { ...next[idx], ...msg };
  return next;
};

export const previewFor = (msg: MessageItem): string => {
  if (msg.isDeleted) return 'This message was deleted';
  if (msg.contentType === 'file') {
    try {
      const meta = JSON.parse(msg.content);
      return meta.caption ? `Attachment: ${meta.caption}` : `Attachment: ${meta.fileName ?? 'file'}`;
    } catch {
      return 'Attachment';
    }
  }
  return msg.content;
};

interface ChatState {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessageItem[]>;
  typingPeers: Record<string, string[]>; // conversationId -> array of deviceIds typing
  filterTab: ChatFilter;
  searchQuery: string;
  searchResults: MessageItem[] | null;
  isSearching: boolean;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  isGroupModalOpen: boolean;
  isDirectChatModalOpen: boolean;

  // Actions
  fetchConversations: () => Promise<void>;
  selectConversation: (conversationId: string | null) => Promise<void>;
  fetchMessages: (conversationId: string, limit?: number) => Promise<void>;
  sendMessage: (content: string, replyToId?: string) => Promise<void>;
  sendMessageTo: (conversationId: string, content: string) => Promise<MessageItem | null>;
  sendFiles: (
    conversationId: string,
    files: Array<{ path?: string; name: string; type?: string; data?: Uint8Array }>,
    caption?: string
  ) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearConversation: (conversationId: string) => Promise<void>;
  setConversationFlags: (
    conversationId: string,
    flags: { isPinned?: boolean; isMuted?: boolean; isArchived?: boolean; isChatLocked?: boolean }
  ) => Promise<void>;
  markConversationUnread: (conversationId: string, unread: boolean) => Promise<void>;
  deleteMessage: (message: MessageItem, forEveryone: boolean) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  reactToMessage: (messageId: string, emoji: string) => Promise<void>;
  setMessageFlags: (messageId: string, flags: { isPinned?: boolean; isStarred?: boolean }) => Promise<void>;
  applyMessageUpdate: (message: MessageItem) => void;
  actionError: string | null;
  setActionError: (err: string | null) => void;
  sendTyping: (isTyping: boolean) => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  createDirectChat: (peerDeviceId: string) => Promise<ConversationItem>;
  createGroupChat: (name: string, description?: string, memberDeviceIds?: string[]) => Promise<ConversationItem>;
  searchMessages: (query: string) => Promise<void>;
  clearSearch: () => void;
  setFilterTab: (tab: ChatFilter) => void;
  setGroupModalOpen: (open: boolean) => void;
  setDirectChatModalOpen: (open: boolean) => void;
  initListeners: () => () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  typingPeers: {},
  filterTab: 'all',
  searchQuery: '',
  searchResults: null,
  isSearching: false,
  isLoadingConversations: false,
  isLoadingMessages: false,
  isSending: false,
  isGroupModalOpen: false,
  isDirectChatModalOpen: false,
  actionError: null,
  setActionError: (err) => set({ actionError: err }),

  fetchConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      if (window.api?.getConversations) {
        const convs = await window.api.getConversations(false);
        set((state) => ({
          conversations: sortConversations(convs),
          isLoadingConversations: false,
          activeConversationId:
            state.activeConversationId && convs.some((c) => c.id === state.activeConversationId)
              ? state.activeConversationId
              : null,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
      set({ isLoadingConversations: false });
    }
  },

  selectConversation: async (conversationId: string | null) => {
    set({ activeConversationId: conversationId });
    if (!conversationId) return;

    // Reset unread count locally in store
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0, isMarkedUnread: false } : c
      ),
    }));

    // Fetch messages for conversation
    await get().fetchMessages(conversationId);

    // Tell main process to mark all incoming unread messages as read
    try {
      if (window.api?.markMessagesRead) {
        await window.api.markMessagesRead(conversationId);
      }
    } catch (err) {
      console.error('Failed to mark messages as read:', err);
    }
  },

  fetchMessages: async (conversationId: string, limit = 300) => {
    set({ isLoadingMessages: true });
    try {
      if (window.api?.getMessages) {
        const msgs = await window.api.getMessages(conversationId, limit);
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: msgs,
          },
          isLoadingMessages: false,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (content: string, replyToId?: string) => {
    const { activeConversationId, messagesByConversation, conversations } = get();
    if (!activeConversationId || !content.trim()) return;

    set({ isSending: true });
    try {
      if (window.api?.sendMessage) {
        const message = await window.api.sendMessage({
          conversationId: activeConversationId,
          content: content.trim(),
          contentType: 'text',
          isEncrypted: false,
          replyToId,
        });

        // Append to timeline
        const currentMessages = get().messagesByConversation[activeConversationId] ?? [];
        const updatedList = upsertMessage(currentMessages, message);

        // Update conversation lastMessage
        const updatedConvs = sortConversations(
          conversations.map((c) =>
            c.id === activeConversationId
              ? { ...c, lastMessage: previewFor(message), lastActivityAt: message.sentAt, isArchived: false }
              : c
          )
        );

        set({
          messagesByConversation: {
            ...get().messagesByConversation,
            [activeConversationId]: updatedList,
          },
          conversations: updatedConvs,
          isSending: false,
        });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      set({ isSending: false });
      throw err;
    }
  },

  sendMessageTo: async (conversationId: string, content: string) => {
    if (!window.api?.sendMessage || !content.trim()) return null;
    const message = await window.api.sendMessage({
      conversationId,
      content: content.trim(),
      contentType: 'text',
      isEncrypted: false,
    });
    get().applyMessageUpdate(message);
    return message;
  },

  sendFiles: async (conversationId, files, caption) => {
    if (!window.api?.sendFileToConversation) return;
    set({ actionError: null });
    let first = true;
    for (const file of files) {
      try {
        const message = file.path
          ? await window.api.sendFileToConversation({
              conversationId,
              filePath: file.path,
              caption: first ? caption : undefined,
            })
          : await window.api.sendBufferToConversation({
              conversationId,
              fileName: file.name,
              mimeType: file.type,
              data: file.data ?? new Uint8Array(),
              caption: first ? caption : undefined,
            });
        first = false;
        get().applyMessageUpdate(message);
      } catch (err: any) {
        set({ actionError: `Could not send ${file.name}: ${cleanIpcError(err)}` });
      }
    }
  },

  deleteConversation: async (conversationId: string) => {
    try {
      await window.api.deleteConversation(conversationId);
      set((state) => {
        const rest = { ...state.messagesByConversation };
        delete rest[conversationId];
        return {
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          messagesByConversation: rest,
          activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
        };
      });
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  clearConversation: async (conversationId: string) => {
    try {
      await window.api.clearConversation(conversationId);
      set((state) => ({
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: [] },
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, lastMessage: null, unreadCount: 0 } : c
        ),
      }));
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  setConversationFlags: async (conversationId, flags) => {
    try {
      const updated = await window.api.setConversationFlags({ conversationId, ...flags });
      if (flags.isChatLocked) {
        // Moved behind the PIN: remove from the normal list
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
        }));
        return;
      }
      if (updated) {
        set((state) => ({
          conversations: sortConversations(
            state.conversations.some((c) => c.id === conversationId)
              ? state.conversations.map((c) => (c.id === conversationId ? { ...c, ...updated } : c))
              : [updated, ...state.conversations]
          ),
        }));
      }
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  markConversationUnread: async (conversationId, unread) => {
    try {
      await window.api.markConversationUnread(conversationId, unread);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId
            ? { ...c, isMarkedUnread: unread, unreadCount: unread ? Math.max(1, c.unreadCount) : 0 }
            : c
        ),
        activeConversationId:
          unread && state.activeConversationId === conversationId ? null : state.activeConversationId,
      }));
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  deleteMessage: async (message: MessageItem, forEveryone: boolean) => {
    try {
      const updated = await window.api.deleteMessage({ messageId: message.id, forEveryone });
      set((state) => {
        const list = state.messagesByConversation[message.conversationId] ?? [];
        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [message.conversationId]: updated
              ? upsertMessage(list, updated)
              : list.filter((m) => m.id !== message.id),
          },
        };
      });
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  editMessage: async (messageId: string, content: string) => {
    try {
      const updated = await window.api.editMessage({ messageId, content });
      get().applyMessageUpdate(updated);
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  reactToMessage: async (messageId: string, emoji: string) => {
    try {
      const updated = await window.api.reactToMessage({ messageId, emoji });
      get().applyMessageUpdate(updated);
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  setMessageFlags: async (messageId, flags) => {
    try {
      const updated = await window.api.setMessageFlags({ messageId, ...flags });
      get().applyMessageUpdate(updated);
    } catch (err: any) {
      set({ actionError: cleanIpcError(err) });
    }
  },

  applyMessageUpdate: (message: MessageItem) => {
    set((state) => {
      const list = state.messagesByConversation[message.conversationId];
      const nextList = upsertMessage(list ?? [], message);
      const isLatest = nextList[nextList.length - 1]?.id === message.id;
      return {
        messagesByConversation: { ...state.messagesByConversation, [message.conversationId]: nextList },
        conversations: isLatest
          ? sortConversations(
              state.conversations.map((c) =>
                c.id === message.conversationId
                  ? { ...c, lastMessage: previewFor(message), lastActivityAt: Math.max(c.lastActivityAt, message.sentAt) }
                  : c
              )
            )
          : state.conversations,
      };
    });
  },

  sendTyping: async (isTyping: boolean) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    try {
      if (window.api?.sendTyping) {
        await window.api.sendTyping(activeConversationId, isTyping);
      }
    } catch {
      // Ignore background typing signaling errors
    }
  },

  markAsRead: async (conversationId: string) => {
    try {
      if (window.api?.markMessagesRead) {
        await window.api.markMessagesRead(conversationId);
      }
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  },

  createDirectChat: async (peerDeviceId: string) => {
    if (!window.api?.createDirectConversation) {
      throw new Error('createDirectConversation API not available');
    }
    const conv = await window.api.createDirectConversation(peerDeviceId);
    set((state) => {
      const exists = state.conversations.find((c) => c.id === conv.id);
      const list = exists
        ? state.conversations.map((c) => (c.id === conv.id ? conv : c))
        : [conv, ...state.conversations];
      return { conversations: list };
    });
    await get().selectConversation(conv.id);
    return conv;
  },

  createGroupChat: async (name: string, description?: string, memberDeviceIds: string[] = []) => {
    if (!window.api?.createGroupConversation) {
      throw new Error('createGroupConversation API not available');
    }
    const conv = await window.api.createGroupConversation({
      name,
      description,
      memberDeviceIds,
    });
    set((state) => ({
      conversations: [conv, ...state.conversations],
      isGroupModalOpen: false,
    }));
    await get().selectConversation(conv.id);
    return conv;
  },

  searchMessages: async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchQuery: '', searchResults: null, isSearching: false });
      return;
    }

    set({ searchQuery: trimmed, isSearching: true });
    try {
      if (window.api?.searchMessages) {
        const results = await window.api.searchMessages({ query: trimmed });
        set({ searchResults: results, isSearching: false });
      }
    } catch (err) {
      console.error('Failed to search messages:', err);
      set({ isSearching: false, searchResults: [] });
    }
  },

  clearSearch: () => {
    set({ searchQuery: '', searchResults: null, isSearching: false });
  },

  setFilterTab: (tab: ChatFilter) => set({ filterTab: tab }),
  setGroupModalOpen: (open: boolean) => set({ isGroupModalOpen: open }),
  setDirectChatModalOpen: (open: boolean) => set({ isDirectChatModalOpen: open }),

  initListeners: () => {
    if (!window.api) return () => {};

    // 1. Message Received
    const unsubMsg = window.api.onMessageReceived?.((message) => {
      const state = get();
      const convId = message.conversationId;
      const currentMessages = state.messagesByConversation[convId] ?? [];

      // Deduplicate message
      if (!currentMessages.some((m) => m.id === message.id)) {
        const updatedMessages = [...currentMessages, message];

        // Update conversation unread count if not currently active
        const isActive = state.activeConversationId === convId;
        if (!state.conversations.some((c) => c.id === convId)) {
          // First message of a conversation we don't list yet — reload the list
          void get().fetchConversations();
        }
        const updatedConvs = sortConversations(
          state.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessage: previewFor(message),
                  unreadCount: isActive ? 0 : c.unreadCount + 1,
                  lastActivityAt: message.sentAt,
                }
              : c
          )
        );

        set({
          messagesByConversation: {
            ...state.messagesByConversation,
            [convId]: updatedMessages,
          },
          conversations: updatedConvs,
        });

        // If this conversation is actively open, automatically send read receipt
        if (isActive) {
          window.api.markMessagesRead?.(convId).catch(console.error);
        }
      }
    });

    // 2. Message Receipt (ack = single tick, delivered = double tick, read = blue)
    const unsubReceipt = window.api.onMessageReceipt?.((receipt) => {
      const state = get();
      const list = state.messagesByConversation[receipt.conversationId];
      const exists = list?.some((m) => m.id === receipt.messageId);
      if (!list || !exists) {
        // Receipt raced ahead of the message being added locally — apply it once it appears
        earlyReceipts.set(receipt.messageId, receipt);
        return;
      }
      set({
        messagesByConversation: {
          ...state.messagesByConversation,
          [receipt.conversationId]: list.map((m) => (m.id === receipt.messageId ? applyReceipt(m, receipt) : m)),
        },
      });
    });

    // 3. Typing Indicator
    const unsubTyping = window.api.onTypingIndicator?.((typing) => {
      set((state) => {
        const peers = state.typingPeers[typing.conversationId] ?? [];
        let updatedPeers: string[];

        if (typing.isTyping) {
          updatedPeers = peers.includes(typing.deviceId) ? peers : [...peers, typing.deviceId];
        } else {
          updatedPeers = peers.filter((id) => id !== typing.deviceId);
        }

        return {
          typingPeers: {
            ...state.typingPeers,
            [typing.conversationId]: updatedPeers,
          },
        };
      });
    });

    // 4. Conversation Updated (payload may be null => full refresh)
    const unsubConv = window.api.onConversationUpdated?.((conv) => {
      if (!conv || !conv.id) {
        void get().fetchConversations();
        return;
      }
      if (conv.type === 'private' || conv.isChatLocked) return;
      set((state) => {
        const idx = state.conversations.findIndex((c) => c.id === conv.id);
        const list = idx >= 0
          ? state.conversations.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
          : [conv, ...state.conversations];
        return { conversations: sortConversations(list) };
      });
    });

    // 5. Message edited / deleted / reacted by a peer
    const unsubUpdated = window.api.onMessageUpdated?.((message) => {
      if (!get().messagesByConversation[message.conversationId]) {
        void get().fetchConversations();
        return;
      }
      get().applyMessageUpdate(message);
    });

    // 6. Conversation removed / moved behind the lock
    const unsubRemoved = window.api.onConversationRemoved?.(({ conversationId }) => {
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
      }));
    });

    return () => {
      unsubMsg?.();
      unsubReceipt?.();
      unsubTyping?.();
      unsubConv?.();
      unsubUpdated?.();
      unsubRemoved?.();
    };
  },
}));
