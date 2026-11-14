import { create } from 'zustand';
import { cleanIpcError, previewFor } from './chatStore';
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
  /** Recovery key to show once (after setup, reset or regeneration) */
  pendingRecoveryKey: string | null;
  isSecurityModalOpen: boolean;

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
  sendMessage: (content: string, replyToId?: string) => Promise<void>;
  sendFiles: (
    files: Array<{ path?: string; name: string; type?: string; data?: Uint8Array }>,
    caption?: string
  ) => Promise<void>;
  applyMessageUpdate: (message: MessageItem) => void;
  deleteMessage: (message: MessageItem, forEveryone: boolean) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  reactToMessage: (messageId: string, emoji: string) => Promise<void>;
  setMessageFlags: (messageId: string, flags: { isPinned?: boolean; isStarred?: boolean }) => Promise<void>;
  unlockChat: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  setCreateModalOpen: (open: boolean) => void;
  setInviteModalOpen: (open: boolean) => void;
  setJoinModalOpen: (open: boolean) => void;
  setError: (err: string | null) => void;
  changePassword: (currentPassword: string, newPassword: string, recoveryHint?: string) => Promise<{ success: boolean; error?: string }>;
  generateRecoveryKey: () => Promise<void>;
  resetWithRecoveryKey: (recoveryKey: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  resetWipe: (confirmation: string) => Promise<{ success: boolean; error?: string }>;
  clearPendingRecoveryKey: () => void;
  setSecurityModalOpen: (open: boolean) => void;
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
  pendingRecoveryKey: null,
  isSecurityModalOpen: false,

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
            // Wipe decrypted content from memory when the workspace locks
            set({ conversations: [], activeConversationId: null, messagesByConversation: {}, invitationsByConversation: {} });
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
                        lastMessage: previewFor(msg),
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
      window.api?.onMessageUpdated?.((msg) => {
        if (!get().isUnlocked) return;
        if (get().messagesByConversation[msg.conversationId]) get().applyMessageUpdate(msg);
      });
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
        const result = await window.api.setupPrivateCredential({ password, recoveryHint });
        if (result?.recoveryKey) set({ pendingRecoveryKey: result.recoveryKey });
        await get().fetchStatus();
        await get().fetchConversations();
      }
    } catch (err: any) {
      set({ error: cleanIpcError(err) || 'Failed to setup private credential' });
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
      set({ error: cleanIpcError(err) || 'Failed to create private chat' });
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
      set({ error: cleanIpcError(err) || 'Failed to redeem invitation' });
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

  applyMessageUpdate: (message: MessageItem) => {
    set((state) => {
      const list = state.messagesByConversation[message.conversationId] ?? [];
      const idx = list.findIndex((m) => m.id === message.id);
      const next = idx === -1 ? [...list, message] : list.map((m) => (m.id === message.id ? { ...m, ...message } : m));
      const isLatest = next[next.length - 1]?.id === message.id;
      return {
        messagesByConversation: { ...state.messagesByConversation, [message.conversationId]: next },
        conversations: isLatest
          ? state.conversations.map((c) =>
              c.id === message.conversationId
                ? { ...c, lastMessage: previewFor(message), lastActivityAt: Math.max(c.lastActivityAt, message.sentAt) }
                : c
            )
          : state.conversations,
      };
    });
  },

  sendFiles: async (files, caption) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    let first = true;
    for (const file of files) {
      try {
        const message = file.path
          ? await window.api.sendFileToConversation({
              conversationId: activeConversationId,
              filePath: file.path,
              caption: first ? caption : undefined,
            })
          : await window.api.sendBufferToConversation({
              conversationId: activeConversationId,
              fileName: file.name,
              mimeType: file.type,
              data: file.data ?? new Uint8Array(),
              caption: first ? caption : undefined,
            });
        first = false;
        get().applyMessageUpdate(message);
      } catch (err) {
        set({ error: `Could not send ${file.name}: ${cleanIpcError(err)}` });
      }
    }
  },

  deleteMessage: async (message, forEveryone) => {
    try {
      const updated = await window.api.deleteMessage({ messageId: message.id, forEveryone });
      if (updated) {
        get().applyMessageUpdate(updated);
      } else {
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [message.conversationId]: (state.messagesByConversation[message.conversationId] ?? []).filter(
              (m) => m.id !== message.id
            ),
          },
        }));
      }
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  editMessage: async (messageId, content) => {
    try {
      get().applyMessageUpdate(await window.api.editMessage({ messageId, content }));
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  reactToMessage: async (messageId, emoji) => {
    try {
      get().applyMessageUpdate(await window.api.reactToMessage({ messageId, emoji }));
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  setMessageFlags: async (messageId, flags) => {
    try {
      get().applyMessageUpdate(await window.api.setMessageFlags({ messageId, ...flags }));
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  unlockChat: async (conversationId) => {
    try {
      await window.api.setConversationFlags({ conversationId, isChatLocked: false });
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
      }));
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  deleteConversation: async (conversationId) => {
    try {
      await window.api.deleteConversation(conversationId);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
      }));
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  sendMessage: async (content: string, replyToId?: string) => {
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
          replyToId,
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
                    lastMessage: previewFor(sent),
                    lastActivityAt: sent.sentAt,
                  }
                : c
            ),
          };
        });
      }
    } catch (err: any) {
      console.error('[PrivateChatStore] Error sending message:', err);
      set({ error: cleanIpcError(err) || 'Failed to send message' });
    } finally {
      set({ isSending: false });
    }
  },

  setCreateModalOpen: (open: boolean) => set({ isCreateModalOpen: open, error: null }),
  setInviteModalOpen: (open: boolean) => set({ isInviteModalOpen: open, error: null }),
  setJoinModalOpen: (open: boolean) => set({ isJoinModalOpen: open, error: null }),
  setError: (err: string | null) => set({ error: err }),

  changePassword: async (currentPassword, newPassword, recoveryHint) => {
    try {
      const res = await window.api.changePrivatePassword({ currentPassword, newPassword, recoveryHint });
      await get().fetchStatus();
      return { success: res.success, error: res.error };
    } catch (err) {
      return { success: false, error: cleanIpcError(err) };
    }
  },

  generateRecoveryKey: async () => {
    try {
      const { recoveryKey } = await window.api.generatePrivateRecoveryKey();
      set({ pendingRecoveryKey: recoveryKey });
      await get().fetchStatus();
    } catch (err) {
      set({ error: cleanIpcError(err) });
    }
  },

  resetWithRecoveryKey: async (recoveryKey, newPassword) => {
    try {
      const res = await window.api.resetPrivateWithRecoveryKey({ recoveryKey, newPassword });
      if (res.success) {
        if (res.recoveryKey) set({ pendingRecoveryKey: res.recoveryKey });
        await get().fetchStatus();
        await get().fetchConversations();
      } else {
        set({ lockedUntil: res.lockedUntil ?? get().lockedUntil });
      }
      return { success: res.success, error: res.error };
    } catch (err) {
      return { success: false, error: cleanIpcError(err) };
    }
  },

  resetWipe: async (confirmation) => {
    try {
      await window.api.resetPrivateWipe({ confirmation });
      set({ conversations: [], activeConversationId: null, messagesByConversation: {}, invitationsByConversation: {}, lockedUntil: null, error: null });
      await get().fetchStatus();
      return { success: true };
    } catch (err) {
      return { success: false, error: cleanIpcError(err) };
    }
  },

  clearPendingRecoveryKey: () => set({ pendingRecoveryKey: null }),
  setSecurityModalOpen: (open) => set({ isSecurityModalOpen: open }),
}));
