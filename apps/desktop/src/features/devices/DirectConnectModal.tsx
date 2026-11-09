import React, { useState } from 'react';
import { X, Globe, AlertCircle, Loader2 } from 'lucide-react';
import { useDeviceStore } from '../../stores/deviceStore';
import { useChatStore } from '../../stores/chatStore';
import { useNavigationStore } from '../../stores/navigationStore';

interface DirectConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DirectConnectModal: React.FC<DirectConnectModalProps> = ({ isOpen, onClose }) => {
  const { connectManual } = useDeviceStore();
  const { createDirectChat } = useChatStore();
  const { setActiveTab } = useNavigationStore();
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('45821');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipAddress.trim()) {
      setError('Please enter a valid IP address');
      return;
    }

    const portNum = Number(port) || 45821;
    if (portNum < 1 || portNum > 65535) {
      setError('Port must be between 1 and 65535');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const dev = await connectManual(ipAddress.trim(), portNum);
      if (dev && dev.id) {
        try {
          await createDirectChat(dev.id);
          setActiveTab('chats');
        } catch (chatErr) {
          console.warn('[DirectConnect] Created peer but chat failed:', chatErr);
          setActiveTab('chats');
        }
      }
      setIsSubmitting(false);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : 'Connection failed or timed out');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Direct IP Connect</h2>
              <p className="text-xs text-muted-foreground">Connect directly to a known LAN peer</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              IP Address <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 192.168.1.150 or 10.0.0.42"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors text-foreground"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              TCP Port
            </label>
            <input
              type="number"
              placeholder="45821"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors text-foreground"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Default IP Messenger TCP communication port is 45821.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
                  Connecting…
                </>
              ) : (
                'Connect Peer'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

