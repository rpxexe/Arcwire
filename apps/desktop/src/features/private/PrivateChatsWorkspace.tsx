import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Lock,
  Plus,
  Key,
  Send,
  UserPlus,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  MessageSquare,
  ShieldCheck,
  LockKeyhole,
} from 'lucide-react';
import { usePrivateChatStore } from '../../stores/privateChatStore';
import { useProfileStore } from '../../stores/profileStore';
import { CreatePrivateChatModal } from './CreatePrivateChatModal';
import { InviteToPrivateChatModal } from './InviteToPrivateChatModal';
import { JoinPrivateChatModal } from './JoinPrivateChatModal';

export const PrivateChatsWorkspace: React.FC = () => {
  const {
    conversations,
    activeConversationId,
    messagesByConversation,
    selectConversation,
    sendMessage,
    lock,
    setCreateModalOpen,
    setInviteModalOpen,
    setJoinModalOpen,
    isSending,
  } = usePrivateChatStore();

  const { profile } = useProfileStore();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const activeMessages = activeConversationId ? messagesByConversation[activeConversationId] || [] : [];

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending) return;

    const text = inputText;
    setInputText('');
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderReceipt = (status: string) => {
    switch (status) {
      case 'read':
        return (
          <span title="Read">
            <CheckCheck className="w-3.5 h-3.5 text-sky-400" />
          </span>
        );
      case 'delivered':
        return (
          <span title="Delivered">
            <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
        );
      case 'sent':
        return (
          <span title="Sent">
            <Check className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
        );
      default:
        return (
          <span title="Pending">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
        );
    }
  };

  return (
    <div className="flex-1 h-full flex overflow-hidden bg-background select-none">
      {/* Left Column: Private Conversation List */}
      <div className="w-80 border-r border-border flex flex-col bg-card/40">
        {/* Workspace Sub-header */}
        <div className="p-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-xs text-foreground">Private Workspace</h2>
              <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Argon2id Unlocked
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setJoinModalOpen(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Join via PRV Code"
            >
              <Key className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="New Private Chat"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => lock()}
              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors ml-1"
              title="Lock Workspace Now"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Shield className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-foreground">No Private Chats</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Start a private chat or enter a PRV token from a peer to establish an encrypted session.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-sm hover:bg-primary/90 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                >
                  Create Chat
                </button>
                <button
                  onClick={() => setJoinModalOpen(true)}
                  className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                >
                  Join via Code
                </button>
              </div>
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = conv.id === activeConversationId;
              return (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`w-full text-left p-3 rounded-md transition-colors duration-150 ease-out flex items-start gap-3 cursor-pointer focus-visible:outline-2 focus-visible:outline-primary ${
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'hover:bg-muted/60 text-foreground'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs truncate">{conv.title}</span>
                      {conv.lastActivityAt > 0 && (
                        <span
                          className={`text-[10px] shrink-0 ml-1 ${
                            isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}
                        >
                          {formatTime(conv.lastActivityAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p
                        className={`text-[11px] truncate ${
                          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        }`}
                      >
                        {conv.lastMessage || 'End-to-End Encrypted'}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Chat Room / Timeline */}
      {activeConv ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          {/* Header */}
          <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-card/20">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <span>{activeConv.title}</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold border border-emerald-500/20 flex items-center gap-1">
                    <LockKeyhole className="w-2.5 h-2.5" />
                    AES-256-GCM
                  </span>
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  Isolated session • {activeConv.memberDeviceIds?.length || 1} participant(s)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setInviteModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite Peer</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {activeMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
                <h4 className="font-bold text-sm text-foreground">Encrypted Channel Initialized</h4>
                <p className="text-xs max-w-sm leading-relaxed">
                  Messages sent in this conversation are encrypted end-to-end, persisted with AES-256-GCM, and excluded
                  from regular search indexation.
                </p>
              </div>
            ) : (
              activeMessages.map((msg) => {
                const isMine = msg.senderId === profile?.deviceId;

                return (
                  <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm text-xs space-y-1 relative group ${
                        isMine
                          ? 'bg-primary text-primary-foreground rounded-tr-xs'
                          : 'bg-card border border-border text-foreground rounded-tl-xs'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                      <div
                        className={`flex items-center gap-1 text-[10px] justify-end ${
                          isMine ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}
                      >
                        <span>{formatTime(msg.sentAt)}</span>
                        {isMine && renderReceipt(msg.deliveryStatus)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Box */}
          <div className="p-3.5 border-t border-border bg-card/20">
            <form onSubmit={handleSend} className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type secure encrypted message…"
                disabled={isSending}
                className="flex-1 px-3 py-2 rounded-md bg-background border border-input text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-150 ease-out"
              />
              <button
                type="submit"
                disabled={isSending || !inputText.trim()}
                className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors duration-150 ease-out shadow-sm flex items-center justify-center cursor-pointer active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary"
                title="Send Message"
                aria-label="Send Message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Shield className="w-6 h-6" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="font-semibold text-base text-foreground">Select or Create a Private Chat</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Private chats feature independent key exchange, separate notification masking, and strict cryptographic
              isolation.
            </p>
          </div>
          <div className="flex items-center gap-2.5 pt-2">
            <button
              onClick={() => setCreateModalOpen(true)}
              className="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-sm hover:bg-primary/90 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
            >
              Create New Chat
            </button>
            <button
              onClick={() => setJoinModalOpen(true)}
              className="px-3.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
            >
              Join via Code
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreatePrivateChatModal />
      <InviteToPrivateChatModal />
      <JoinPrivateChatModal />
    </div>
  );
};
