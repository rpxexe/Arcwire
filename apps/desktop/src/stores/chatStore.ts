import { create } from 'zustand';
import { ConversationItem, MessageItem, ReceiptEventData, TypingEventData } from '@ipm/shared';

export type ChatFilter = 'all' | 'direct' | 'groups';

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

  fetchConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      if (window.api?.getConversations) {
        const convs = await window.api.getConversations(false);
        set({ conversations: convs, isLoadingConversations: false });
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
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
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

  fetchMessages: async (conversationId: string, limit = 50) => {
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
        const currentMessages = messagesByConversation[activeConversationId] ?? [];
        const exists = currentMessages.some((m) => m.id === message.id);
        const updatedList = exists ? currentMessages : [...currentMessages, message];

        // Update conversation lastMessage
        const updatedConvs = conversations.map((c) => {
          if (c.id === activeConversationId) {
            return {
              ...c,
              lastMessage: message.content,
              lastActivityAt: message.sentAt,
            };
          }
          return c;
        });

        // Re-sort conversations by lastActivityAt descending
        updatedConvs.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

        set({
          messagesByConversation: {
            ...messagesByConversation,
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
        const updatedConvs = state.conversations.map((c) => {
          if (c.id === convId) {
            return {
              ...c,
              lastMessage: message.content,
              unreadCount: isActive ? 0 : c.unreadCount + 1,
              lastActivityAt: message.sentAt,
            };
          }
          return c;
        });

        updatedConvs.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

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

    // 2. Message Receipt (delivered / read)
    const unsubReceipt = window.api.onMessageReceipt?.((receipt) => {
      const state = get();
      const currentMessages = state.messagesByConversation[receipt.conversationId];
      if (!currentMessages) return;

      const updated = currentMessages.map((m) => {
        if (m.id === receipt.messageId) {
          if (m.deliveryStatus === 'read') return m;
          const status: MessageItem['deliveryStatus'] =
            receipt.receiptType === 'ack'
              ? 'sent'
              : receipt.receiptType === 'delivered'
              ? 'delivered'
              : 'read';
          return {
            ...m,
            deliveryStatus: status,
            deliveredAt: receipt.receiptType === 'delivered' ? receipt.timestamp : m.deliveredAt,
            readAt: receipt.receiptType === 'read' ? receipt.timestamp : m.readAt,
          };
        }
        return m;
      });

      set({
        messagesByConversation: {
          ...state.messagesByConversation,
          [receipt.conversationId]: updated,
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

    // 4. Conversation Updated
    const unsubConv = window.api.onConversationUpdated?.((conv) => {
      set((state) => {
        const idx = state.conversations.findIndex((c) => c.id === conv.id);
        const list = idx >= 0
          ? state.conversations.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
          : [conv, ...state.conversations];
        list.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
        return { conversations: list };
      });
    });

    return () => {
      unsubMsg?.();
      unsubReceipt?.();
      unsubTyping?.();
      unsubConv?.();
    };
  },
}));
