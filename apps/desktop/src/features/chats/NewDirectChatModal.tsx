import React, { useState } from 'react';
import { X, MessageSquare, Search, Globe, AlertCircle, Loader2 } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { useChatStore } from '../../stores/chatStore';

interface NewDirectChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDirectConnect: () => void;
}

export const NewDirectChatModal: React.FC<NewDirectChatModalProps> = ({
  isOpen,
  onClose,
  onOpenDirectConnect,
}) => {
  const { devices } = useDeviceStore();
  const { createDirectChat } = useChatStore();

  const [search, setSearch] = useState('');
  const [loadingDeviceId, setLoadingDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredDevices = devices.filter(
    (d) =>
      d.displayName.toLowerCase().includes(search.toLowerCase()) ||
      d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.ipAddress.includes(search)
  );

  const handleSelectPeer = async (deviceId: string) => {
    setLoadingDeviceId(deviceId);
    setError(null);
    try {
      await createDirectChat(deviceId);
      setLoadingDeviceId(null);
      onClose();
    } catch (err) {
      setLoadingDeviceId(null);
      setError(err instanceof Error ? err.message : 'Failed to start direct chat');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">New Direct Chat</h2>
              <p className="text-xs text-muted-foreground">Select a peer on your local network</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, computer or IP..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-background border border-input focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Peer List */}
          <div className="max-h-60 overflow-y-auto rounded-xl border border-border divide-y divide-border/40 bg-background/50">
            {filteredDevices.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  {search ? 'No matching peers found.' : 'No LAN peers discovered yet.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDirectConnect();
                  }}
                  className="text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1"
                >
                  <Globe className="w-3 h-3" /> Connect manually via IP
                </button>
              </div>
            ) : (
              filteredDevices.map((device) => {
                const isLoading = loadingDeviceId === device.id;
                return (
                  <button
                    key={device.id}
                    disabled={Boolean(loadingDeviceId)}
                    onClick={() => handleSelectPeer(device.id)}
                    className="w-full p-2.5 flex items-center justify-between hover:bg-muted/50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                          {device.displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <span
                          className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border-2 border-background ${
                            device.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/60'
                          }`}
                        />
                      </div>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {device.displayName}
                          </span>
                          <span className="text-[10px] text-muted-foreground">({device.hostname})</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate font-mono">
                          {device.ipAddress}:{device.tcpPort}
                        </p>
                      </div>
                    </div>

                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <span className="text-[11px] font-semibold text-primary">Chat →</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Can’t find a computer?</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDirectConnect();
              }}
              className="text-primary font-semibold hover:underline flex items-center gap-1"
            >
              <Globe className="w-3 h-3" /> Direct IP Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

