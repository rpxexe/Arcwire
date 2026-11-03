import React, { useState } from 'react';
import { Search, MessageSquare, Send, Paperclip, CheckCheck, Shield, Plus } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';

export const ChatsView: React.FC = () => {
  const { profile } = useProfileStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');

  // Initial mock conversations to demonstrate layout & typography
  const conversations = [
    {
      id: 'conv_sample_1',
      title: 'Local Loopback Channel',
      lastMessage: 'IP Messenger Phase 1 desktop shell initialized.',
      time: 'Just now',
      unread: 0,
      status: 'online',
    },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Conversation List Sidebar */}
      <div className="w-80 border-r border-border flex flex-col bg-card/40">
        {/* Search Header */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-foreground">Conversations</h2>
            <button
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Start New Direct Chat"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Conversation Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedConvId(c.id)}
              className={`w-full p-3 flex items-start gap-3 text-left transition-colors ${
                selectedConvId === c.id ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/50'
              }`}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold text-xs">
                  {c.title.slice(0, 2).toUpperCase()}
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-xs text-foreground truncate">{c.title}</span>
                  <span className="text-[10px] text-muted-foreground">{c.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{c.lastMessage}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Timeline */}
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
        {selectedConvId ? (
          <>
            {/* Chat Header */}
            <div className="h-14 border-b border-border px-4 flex items-center justify-between bg-card/20">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                  LL
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-foreground">Local Loopback Channel</h3>
                  <p className="text-[10px] text-emerald-500 font-medium">Ready (Direct P2P Link)</p>
                </div>
              </div>
            </div>

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex justify-center">
                <span className="text-[10px] bg-muted px-2.5 py-1 rounded-full text-muted-foreground">
                  Today • IPM/1 Protocol
                </span>
              </div>

              {/* Sample Message from System */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                  IP
                </div>
                <div className="max-w-[70%]">
                  <div className="p-3 rounded-2xl rounded-tl-sm bg-card border border-border text-xs text-foreground space-y-1">
                    <p>
                      Welcome <span className="font-semibold text-primary">{profile?.displayName}</span>! IP Messenger
                      is operating in full Windows LAN mode.
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      SQLite Write-Ahead Logging database is active at{' '}
                      <span className="font-mono text-[10px] text-foreground">%APPDATA%\IPMessenger\data\ipm.db</span>.
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground block mt-1 ml-1">12:00 PM</span>
                </div>
              </div>
            </div>

            {/* Message Composer */}
            <div className="p-3 border-t border-border bg-card/30">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Attach File (256 KB Chunked Stream)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type a message (Enter to send)..."
                  className="flex-1 px-3 py-2 text-xs rounded-lg bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
                <button
                  type="button"
                  className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  title="Send Message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-base text-foreground">Select a Conversation</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              Choose an active peer from the list or browse discovered LAN computers to begin real-time communication.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
