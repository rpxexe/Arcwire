import { create } from 'zustand';
import type {
  PrivateStatus,
  ConversationItem,
  MessageItem,
  InvitationItem,
} from '@ipm/shared';

interface PrivateChatState {
  status: PrivateStatus | null;
  isUnlocked: boolean;
  lockedUntil: number | null;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessageItem[]>;
  invitationsByConversation: Record<string, InvitationItem[]>;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  isCreateModalOpen: boolean;
  isInviteModalOpen: boolean;
  isJoinModalOpen: boolean;

  // Actions
  init: () => Promise<void>;
  fetchStatus: () => Promise<PrivateStatus | null>;
  setupCredential: (password: string, recoveryHint?: string) => Promise<void>;
  unlock: (password: string) => Promise<{ success: boolean; error?: string }>;
  lock: () => Promise<void>;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  createConversation: (title: string) => Promise<ConversationItem>;
  createInvitation: (
    conversationId: string,
    maxUses?: number,
    expiresInHours?: number
  ) => Promise<{ code: string; expiresAt: number; id: string }>;
  redeemInvitation: (code: string) => Promise<ConversationItem>;
  listInvitations: (conversationId: string) => Promise<InvitationItem[]>;
  revokeInvitation: (invitationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  setCreateModalOpen: (open: boolean) => void;
  setInviteModalOpen: (open: boolean) => void;
  setJoinModalOpen: (open: boolean) => void;
  setError: (err: string | null) => void;
}

export const usePrivateChatStore = create<PrivateChatState>((set, get) => ({
  status: null,
  isUnlocked: false,
  lockedUntil: null,
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  invitationsByConversation: {},
  isLoading: false,
  isSending: false,
  error: null,
  isCreateModalOpen: false,
  isInviteModalOpen: false,
  isJoinModalOpen: false,

  init: async () => {
    try {
      const status = await get().fetchStatus();
      if (status?.isUnlocked) {
        await get().fetchConversations();
      }

      // Register listener for lock state changes
      if (window.api?.onPrivateLockStateChange) {
        window.api.onPrivateLockStateChange((state) => {
          set({
            isUnlocked: state.isUnlocked,
            lockedUntil: state.lockedUntil || null,
          });
          if (state.isUnlocked) {
            get().fetchConversations();
          } else {
            set({ conversations: [], activeConversationId: null });
          }
        });
      }

      // Register listener for incoming messages to private chats
      if (window.api?.onMessageReceived) {
        window.api.onMessageReceived((msg) => {
          if (!get().isUnlocked) return;
          const { activeConversationId, messagesByConversation, conversations } = get();

          // Check if message belongs to one of our private conversations
          const isOurConv = conversations.some((c) => c.id === msg.conversationId);
          if (isOurConv) {
            const list = messagesByConversation[msg.conversationId] || [];
            if (!list.some((m) => m.id === msg.id)) {
              set({
                messagesByConversation: {
                  ...messagesByConversation,
                  [msg.conversationId]: [...list, msg],
                },
                conversations: conversations.map((c) =>
                  c.id === msg.conversationId
                    ? {
                        ...c,
                        lastMessage: msg.content,
                        lastActivityAt: msg.sentAt,
                        unreadCount: c.id === activeConversationId ? 0 : c.unreadCount + 1,
                      }
                    : c
                ),
              });
            }
          }
        });
      }
    } catch (err) {
      console.error('[PrivateChatStore] Failed to initialize:', err);
    }
  },

  fetchStatus: async () => {
    try {
      if (window.api?.getPrivateStatus) {
        const s = await window.api.getPrivateStatus();
        set({
          status: s,
          isUnlocked: s.isUnlocked,
          lockedUntil: s.lockedUntil || null,
        });
        return s;
      }
    } catch (err) {
      console.error('[PrivateChatStore] Error fetching status:', err);
    }
    return null;
  },

  setupCredential: async (password: string, recoveryHint?: string) => {
    set({ isLoading: true, error: null });
    try {
      if (window.api?.setupPrivateCredential) {
        await window.api.setupPrivateCredential({ password, recoveryHint });
        await get().fetchStatus();
        await get().fetchConversations();
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to setup private credential' });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  unlock: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      if (window.api?.unlockPrivate) {
        const res = await window.api.unlockPrivate({ password });
        if (res.success) {
          await get().fetchStatus();
          await get().fetchConversations();
          return { success: true };
        } else {
          set({
            error: res.error || 'Failed to unlock',
            lockedUntil: res.lockedUntil || null,
          });
          return { success: false, error: res.error };
        }
      }
      return { success: false, error: 'IPC API not available' };
    } catch (err: any) {
      const msg = err.message || 'Failed to unlock private chats';
      set({ error: msg });
      return { success: false, error: msg };
    } finally {
      set({ isLoading: false });
    }
  },

  lock: async () => {
    try {
      if (window.api?.lockPrivate) {
        await window.api.lockPrivate();
      }
      set({
        isUnlocked: false,
        conversations: [],
        activeConversationId: null,
        messagesByConversation: {},
      });
      await get().fetchStatus();
    } catch (err) {
      console.error('[PrivateChatStore] Error locking:', err);
    }
  },

  fetchConversations: async () => {
    if (!get().isUnlocked) return;
    set({ isLoading: true });
    try {
      if (window.api?.getPrivateConversations) {
        const list = await window.api.getPrivateConversations();
        set({ conversations: list });
        if (list.length > 0 && !get().activeConversationId) {
          get().selectConversation(list[0]!.id);
        }
      }
    } catch (err: any) {
      console.error('[PrivateChatStore] Error fetching conversations:', err);
      set({ error: err.message || 'Failed to fetch private chats' });
    } finally {
      set({ isLoading: false });
    }
  },

  selectConversation: async (id: string | null) => {
    set({ activeConversationId: id });
    if (!id || !get().isUnlocked) return;

    try {
      if (window.api?.getMessages) {
        const msgs = await window.api.getMessages(id, 100);
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [id]: msgs,
          },
        }));
      }
      if (window.api?.markMessagesRead) {
        await window.api.markMessagesRead(id);
      }
    } catch (err) {
      console.error('[PrivateChatStore] Error loading messages:', err);
    }
  },

  createConversation: async (title: string) => {
    set({ isLoading: true, error: null });
    try {
      if (!window.api?.createPrivateConversation) {
        throw new Error('API not ready');
      }
      const created = await window.api.createPrivateConversation({ title });
      set((state) => ({
        conversations: [created, ...state.conversations],
        activeConversationId: created.id,
        isCreateModalOpen: false,
      }));
      return created;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create private chat' });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  createInvitation: async (conversationId: string, maxUses = 1, expiresInHours = 24) => {
    try {
      if (!window.api?.createPrivateInvitation) {
        throw new Error('API not ready');
      }
      const result = await window.api.createPrivateInvitation({
        conversationId,
        maxUses,
        expiresInHours,
      });
      // Refresh invitations list
      await get().listInvitations(conversationId);
      return result;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create invitation' });
      throw err;
    }
  },

  redeemInvitation: async (code: string) => {
    set({ isLoading: true, error: null });
    try {
      if (!window.api?.redeemPrivateInvitation) {
        throw new Error('API not ready');
      }
      const conv = await window.api.redeemPrivateInvitation({ code });
      set((state) => ({
        conversations: [conv, ...state.conversations.filter((c) => c.id !== conv.id)],
        activeConversationId: conv.id,
        isJoinModalOpen: false,
      }));
      await get().selectConversation(conv.id);
      return conv;
    } catch (err: any) {
      set({ error: err.message || 'Failed to redeem invitation' });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  listInvitations: async (conversationId: string) => {
    try {
      if (!window.api?.listPrivateInvitations) return [];
      const list = await window.api.listPrivateInvitations(conversationId);
      set((state) => ({
        invitationsByConversation: {
          ...state.invitationsByConversation,
          [conversationId]: list,
        },
      }));
      return list;
    } catch (err) {
      console.error('[PrivateChatStore] Error listing invitations:', err);
      return [];
    }
  },

  revokeInvitation: async (invitationId: string) => {
    try {
      if (!window.api?.revokePrivateInvitation) return;
      await window.api.revokePrivateInvitation(invitationId);
      const activeId = get().activeConversationId;
      if (activeId) {
        await get().listInvitations(activeId);
      }
    } catch (err) {
      console.error('[PrivateChatStore] Error revoking invitation:', err);
    }
  },

  sendMessage: async (content: string) => {
    const { activeConversationId, isUnlocked } = get();
    if (!activeConversationId || !isUnlocked || !content.trim()) return;

    set({ isSending: true });
    try {
      if (window.api?.sendMessage) {
        const sent = await window.api.sendMessage({
          conversationId: activeConversationId,
          content: content.trim(),
          contentType: 'text',
          isEncrypted: true,
        });

        set((state) => {
          const list = state.messagesByConversation[activeConversationId] || [];
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [activeConversationId]: [...list, sent],
            },
            conversations: state.conversations.map((c) =>
              c.id === activeConversationId
                ? {
                    ...c,
                    lastMessage: sent.content,
                    lastActivityAt: sent.sentAt,
                  }
                : c
            ),
          };
        });
      }
    } catch (err: any) {
      console.error('[PrivateChatStore] Error sending message:', err);
      set({ error: err.message || 'Failed to send message' });
    } finally {
      set({ isSending: false });
    }
  },

  setCreateModalOpen: (open: boolean) => set({ isCreateModalOpen: open, error: null }),
  setInviteModalOpen: (open: boolean) => set({ isInviteModalOpen: open, error: null }),
  setJoinModalOpen: (open: boolean) => set({ isJoinModalOpen: open, error: null }),
  setError: (err: string | null) => set({ error: err }),
}));
