import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  MessageSquare,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
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
} from 'lucide-react';
import { useChatStore, ChatFilter } from '../../stores/chatStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProfileStore } from '../../stores/profileStore';
import { useTransferStore } from '../../stores/transferStore';
import { useCallStore } from '../../stores/callStore';
import { CreateGroupModal } from './CreateGroupModal';
import { NewDirectChatModal } from './NewDirectChatModal';
import { DirectConnectModal } from '../devices/DirectConnectModal';
import { MessageItem, ConversationItem } from '@ipm/shared';

export const ChatsView: React.FC = () => {
  const { profile } = useProfileStore();
  const { devices } = useDeviceStore();
  const { selectAndSendFile } = useTransferStore();
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
    fetchConversations,
    selectConversation,
    createDirectChat,
    sendMessage,
    sendTyping,
    searchMessages,
    clearSearch,
    setFilterTab,
    setGroupModalOpen,
    setDirectChatModalOpen,
    initListeners,
  } = useChatStore();

  const [messageInput, setMessageInput] = useState('');
  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [isDirectConnectOpen, setIsDirectConnectOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCurrentlyTypingRef = useRef(false);

  // Initialize listeners and fetch conversations
  useEffect(() => {
    fetchConversations();
    const cleanup = initListeners();
    return () => {
      cleanup();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Scroll to bottom on new messages
  const activeMessages = activeConversationId
    ? messagesByConversation[activeConversationId] ?? []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeConversationId]);

  // Current active conversation object
  const activeConv: ConversationItem | undefined = conversations.find(
    (c) => c.id === activeConversationId
  );

  // Peer device for direct conversation
  const targetPeerDeviceId =
    activeConv?.peerDeviceId ||
    activeConv?.memberDeviceIds?.find(
      (id) => id !== profile?.id && id !== profile?.deviceId
    );
  const peerDevice = targetPeerDeviceId
    ? devices.find((d) => d.id === targetPeerDeviceId)
    : undefined;

  // Resolve device display name helper
  const getDeviceDisplayName = (deviceId: string) => {
    if (profile && (profile.id === deviceId || profile.deviceId === deviceId)) {
      return `${profile.displayName} (You)`;
    }
    const dev = devices.find((d) => d.id === deviceId);
    return dev ? dev.displayName : `Device ${deviceId.slice(0, 8)}`;
  };

  // Typing peer names in active conversation
  const currentTypingDeviceIds = activeConversationId
    ? typingPeers[activeConversationId] ?? []
    : [];

  const typingNames = currentTypingDeviceIds
    .filter((id) => id !== profile?.id && id !== profile?.deviceId)
    .map(getDeviceDisplayName);

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    // 1. Tab filter
    if (filterTab === 'direct' && c.type !== 'direct') return false;
    if (filterTab === 'groups' && c.type !== 'group') return false;

    // 2. Search filter
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      const matchTitle = c.title.toLowerCase().includes(q);
      const matchLast = c.lastMessage ? c.lastMessage.toLowerCase().includes(q) : false;
      return matchTitle || matchLast;
    }

    return true;
  });

  const matchingLanDevices = filterSearch.trim()
    ? devices.filter(
        (d) =>
          d.id !== profile?.id &&
          d.id !== profile?.deviceId &&
          (d.displayName.toLowerCase().includes(filterSearch.toLowerCase()) ||
            d.hostname.toLowerCase().includes(filterSearch.toLowerCase()) ||
            d.ipAddress.includes(filterSearch))
      )
    : [];

  // Handle typing input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    if (val.trim().length > 0) {
      if (!isCurrentlyTypingRef.current) {
        isCurrentlyTypingRef.current = true;
        sendTyping(true);
      }
      // Reset debounce timer
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || isSending || !activeConversationId) return;

    if (isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = false;
      sendTyping(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }

    setMessageInput('');
    const replyId = replyingTo?.id;
    setReplyingTo(null);

    try {
      await sendMessage(trimmed, replyId);
    } catch (err) {
      console.error('Send message error:', err);
    }
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const renderReceiptIcon = (deliveryStatus: MessageItem['deliveryStatus']) => {
    switch (deliveryStatus) {
      case 'pending':
        return (
          <span title="Pending delivery">
            <Clock className="w-3 h-3 text-muted-foreground/70" />
          </span>
        );
      case 'sent':
        return (
          <span title="Sent to network">
            <Check className="w-3 h-3 text-muted-foreground/80" />
          </span>
        );
      case 'delivered':
        return (
          <span title="Delivered to device">
            <CheckCheck className="w-3 h-3 text-muted-foreground" />
          </span>
        );
      case 'read':
        return (
          <span title="Read by recipient">
            <CheckCheck className="w-3 h-3 text-sky-400 stroke-[2.5]" />
          </span>
        );
      case 'failed':
        return (
          <span title="Delivery failed">
            <AlertCircle className="w-3 h-3 text-rose-500" />
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. Left Conversation List Sidebar                                         */}
      {/* ========================================================================= */}
      <div className="w-80 border-r border-border flex flex-col bg-card/40 shrink-0">
        {/* Top Header */}
        <div className="p-3 border-b border-border space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" /> Conversations
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDirectChatModalOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="New Direct Chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGroupModalOpen(true)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="New Group Chat"
              >
                <Users className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => {
                setFilterSearch(e.target.value);
                if (e.target.value.length > 2) {
                  searchMessages(e.target.value);
                } else if (!e.target.value) {
                  clearSearch();
                }
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
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center bg-muted p-0.5 rounded-md text-xs font-medium">
            {(['all', 'direct', 'groups'] as ChatFilter[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`flex-1 py-1 rounded text-[11px] capitalize transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary ${
                  filterTab === tab
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Global Message Search Results Overlay */}
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
                <div
                  key={sm.id}
                  onClick={() => selectConversation(sm.conversationId)}
                  className="p-1.5 rounded-lg hover:bg-card cursor-pointer text-xs truncate transition-colors"
                >
                  <p className="text-[11px] font-medium text-foreground truncate">{sm.content}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimestamp(sm.sentAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversation Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/30">
          {/* LAN Peers matching username or IP search */}
          {matchingLanDevices.length > 0 && (
            <div className="p-2 border-b border-border bg-primary/5">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center justify-between">
                <span>LAN Peers ({matchingLanDevices.length})</span>
                <span className="text-[11px] text-primary font-normal">Click Chat to message</span>
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
                        <div className="text-[10px] text-muted-foreground truncate">{d.ipAddress} • {d.hostname}</div>
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
                <MessageSquare className="w-5 h-5" />
              </div>
              <p className="text-xs text-muted-foreground">
                {filterSearch ? 'No matching conversations.' : 'No conversations yet.'}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  onClick={() => setDirectChatModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
                >
                  Start Direct Chat
                </button>
                <button
                  onClick={() => setGroupModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors"
                >
                  Create LAN Group
                </button>
              </div>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = activeConversationId === c.id;
              const peer = c.peerDeviceId ? devices.find((d) => d.id === c.peerDeviceId) : null;
              const isOnline = c.type === 'direct' ? peer?.status === 'online' : true;

              return (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  className={`w-full p-3 flex items-start gap-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-primary'
                      : 'hover:bg-muted/40'
                  }`}
                >
                  {/* Avatar with Online/Group indicator */}
                  <div className="relative shrink-0">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${
                        c.type === 'group'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-primary/15 text-primary'
                      }`}
                    >
                      {c.type === 'group' ? (
                        <Users className="w-5 h-5" />
                      ) : (
                        c.title.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    {c.type === 'direct' && (
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background ${
                          isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/60'
                        }`}
                      />
                    )}
                  </div>

                  {/* Conv Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-foreground truncate">
                        {c.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                        {formatTimestamp(c.lastActivityAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs text-muted-foreground truncate flex-1">
                        {c.lastMessage ? c.lastMessage : 'No messages yet'}
                      </p>

                      {c.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                          {c.unreadCount}
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

      {/* ========================================================================= */}
      {/* 2. Main Chat Conversation Pane                                            */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
        {activeConv ? (
          <>
            {/* Chat Top Header */}
            <div className="h-14 border-b border-border px-5 flex items-center justify-between bg-card/30 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                    activeConv.type === 'group'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-primary/15 text-primary'
                  }`}
                >
                  {activeConv.type === 'group' ? (
                    <Users className="w-5 h-5" />
                  ) : (
                    activeConv.title.slice(0, 2).toUpperCase()
                  )}
                </div>

                <div className="truncate">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xs text-foreground truncate">{activeConv.title}</h3>
                    {activeConv.type === 'group' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                        {activeConv.isHost ? (
                          <>
                            <Crown className="w-2.5 h-2.5" /> You are Host
                          </>
                        ) : (
                          'LAN Group'
                        )}
                      </span>
                    )}
                    {activeConv.type === 'direct' && peerDevice && (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          peerDevice.isTrusted
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-muted text-muted-foreground'
                        }`}
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
                    {activeConv.type === 'group'
                      ? `${activeConv.memberDeviceIds?.length || 1} members • Failover Protected`
                      : peerDevice
                      ? `${peerDevice.hostname} • ${peerDevice.ipAddress}:${peerDevice.tcpPort} (${peerDevice.status})`
                      : 'Direct P2P Link (Encrypted TLS 1.3)'}
                  </p>
                </div>
              </div>

              {/* Call & Tool Shortcuts */}
              <div className="flex items-center gap-1">
                <button
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={targetPeerDeviceId ? 'Start Voice Call' : 'Voice calls available in direct chats'}
                  disabled={!targetPeerDeviceId}
                  onClick={() => {
                    if (targetPeerDeviceId && activeConv) {
                      startCall(activeConv.id, targetPeerDeviceId, 'voice');
                    }
                  }}
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={targetPeerDeviceId ? 'Start Video Call' : 'Video calls available in direct chats'}
                  disabled={!targetPeerDeviceId}
                  onClick={() => {
                    if (targetPeerDeviceId && activeConv) {
                      startCall(activeConv.id, targetPeerDeviceId, 'video');
                    }
                  }}
                >
                  <Video className="w-4 h-4" />
                </button>
                <button
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title={targetPeerDeviceId ? 'Share Screen with Peer' : 'Screen sharing available in direct chats'}
                  disabled={!targetPeerDeviceId}
                  onClick={() => {
                    if (targetPeerDeviceId && activeConv) {
                      startCall(activeConv.id, targetPeerDeviceId, 'screen');
                    }
                  }}
                >
                  <Monitor className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoadingMessages && activeMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2 text-primary" /> Loading messages...
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 select-none text-muted-foreground">
                  <MessageSquare className="w-10 h-10 stroke-1" />
                  <p className="text-xs font-semibold text-foreground">No messages in this chat yet</p>
                  <p className="text-[11px] max-w-xs text-muted-foreground">
                    Send a message below. Messages are transferred directly over local TLS TCP with delivery receipts.
                  </p>
                </div>
              ) : (
                activeMessages.map((msg) => {
                  const isMe = profile
                    ? msg.senderId === profile.id || msg.senderId === profile.deviceId
                    : false;
                  const replyTarget = msg.replyToId
                    ? activeMessages.find((m) => m.id === msg.replyToId)
                    : null;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group`}
                    >
                      {/* Sender Name in Group Chat for incoming messages */}
                      {!isMe && activeConv.type === 'group' && (
                        <span className="text-[10px] text-muted-foreground font-semibold px-2 mb-0.5">
                          {getDeviceDisplayName(msg.senderId)}
                        </span>
                      )}

                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs relative shadow-xs transition-shadow ${
                          isMe
                            ? 'bg-primary text-primary-foreground rounded-br-xs'
                            : 'bg-card border border-border text-foreground rounded-bl-xs'
                        }`}
                      >
                        {/* Replying quote if present */}
                        {replyTarget && (
                          <div
                            className={`mb-1.5 p-1.5 rounded-lg text-[10px] border-l-2 truncate ${
                              isMe
                                ? 'bg-black/10 border-white/50 text-white/90'
                                : 'bg-muted/80 border-primary text-foreground/80'
                            }`}
                          >
                            <span className="font-semibold block truncate">
                              {getDeviceDisplayName(replyTarget.senderId)}
                            </span>
                            <span className="truncate block opacity-80">
                              {replyTarget.content}
                            </span>
                          </div>
                        )}

                        {/* Message text */}
                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                          {msg.content}
                        </p>

                        {/* Message metadata footer: timestamp + receipt */}
                        <div
                          className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                            isMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
                          }`}
                        >
                          <span>{formatTimestamp(msg.sentAt)}</span>
                          {isMe && renderReceiptIcon(msg.deliveryStatus)}
                        </div>
                      </div>

                      {/* Quick reply action button on hover */}
                      <button
                        onClick={() => setReplyingTo(msg)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-foreground transition-opacity px-2 mt-0.5"
                      >
                        Reply
                      </button>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing Indicator Banner */}
            {typingNames.length > 0 && (
              <div className="px-5 py-1 text-[11px] text-muted-foreground flex items-center gap-1.5 bg-card/20 border-t border-border/40">
                <span className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:200ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse [animation-delay:400ms]" />
                </span>
                <span>
                  {typingNames.join(', ')} {typingNames.length > 1 ? 'are' : 'is'} typing…
                </span>
              </div>
            )}

            {/* Replying Banner */}
            {replyingTo && (
              <div className="px-5 py-1.5 bg-muted/60 border-t border-border flex items-center justify-between text-xs">
                <div className="truncate mr-2">
                  <span className="text-[10px] font-semibold text-primary block">
                    Replying to {getDeviceDisplayName(replyingTo.senderId)}
                  </span>
                  <p className="text-[11px] text-foreground/80 truncate">{replyingTo.content}</p>
                </div>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message Composer */}
            <div className="p-3 border-t border-border bg-card/20 shrink-0">
              <div className="flex items-end gap-2 bg-background border border-input rounded-2xl p-2 focus-within:ring-1 focus-within:ring-primary">
                <button
                  type="button"
                  onClick={() => {
                    const peerId = activeConv.peerDeviceId || (activeConv.memberDeviceIds && activeConv.memberDeviceIds[0]);
                    if (peerId) {
                      selectAndSendFile(activeConv.id, peerId);
                    }
                  }}
                  className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Share File"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <textarea
                  value={messageInput}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${activeConv.title}... (Enter to send, Shift+Enter for newline)`}
                  rows={1}
                  className="flex-1 max-h-32 min-h-[24px] py-1 text-xs bg-transparent border-0 focus:outline-none resize-none text-foreground placeholder:text-muted-foreground"
                />

                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || isSending}
                  className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
                  title="Send Message"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty selection state */
          <div className="flex-1 flex flex-col items-center justify-center p-8 select-none text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center shadow-inner">
              <MessageSquare className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="font-bold text-base text-foreground">Select a Conversation</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect and communicate directly over your local Wi-Fi or Ethernet network without internet access or cloud servers.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setDirectChatModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm"
              >
                Start Direct Chat
              </button>
              <button
                onClick={() => setGroupModalOpen(true)}
                className="px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground transition-colors"
              >
                Create LAN Group
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. Dialogs & Modals                                                       */}
      {/* ========================================================================= */}
      <CreateGroupModal
        isOpen={isGroupModalOpen}
        onClose={() => setGroupModalOpen(false)}
      />

      <NewDirectChatModal
        isOpen={isDirectChatModalOpen}
        onClose={() => setDirectChatModalOpen(false)}
        onOpenDirectConnect={() => setIsDirectConnectOpen(true)}
      />

      <DirectConnectModal
        isOpen={isDirectConnectOpen}
        onClose={() => setIsDirectConnectOpen(false)}
      />
    </div>
  );
};
