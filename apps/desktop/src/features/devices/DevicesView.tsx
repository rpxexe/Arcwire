import React, { useEffect, useState } from 'react';
import {
  Laptop,
  RefreshCw,
  Plus,
  ShieldCheck,
  Shield,
  Wifi,
  MessageSquare,
  FileText,
  Clock,
} from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useChatStore } from '../../stores/chatStore';
import { DirectConnectModal } from './DirectConnectModal';
import { DeviceInfo } from '@ipm/shared';

export const DevicesView: React.FC = () => {
  const { systemInfo, profile } = useProfileStore();
  const { devices, isScanning, scanLan, toggleTrust, initListeners } = useDeviceStore();
  const { setActiveTab } = useNavigationStore();
  const { createDirectChat } = useChatStore();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const cleanup = initListeners();
    return () => {
      cleanup();
    };
  }, [initListeners]);

  // Filter out our own device from remote peer list if present
  const remoteDevices = devices.filter((d) => d.id !== profile?.deviceId);

  const getStatusBadge = (status: DeviceInfo['status']) => {
    switch (status) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
        );
      case 'busy':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Busy
          </span>
        );
      case 'away':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Away
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
            Offline
          </span>
        );
    }
  };

  const formatLastSeen = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 15000) return 'Just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleStartChat = async (deviceId: string) => {
    try {
      await createDirectChat(deviceId);
      setActiveTab('chats');
    } catch {
      setActiveTab('chats');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-6 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Discovered LAN Devices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time peer discovery broadcasting on UDP port 45820 & mDNS across active network adapters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => scanLan()}
            disabled={isScanning}
            className="px-3.5 py-2 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Broadcast Discovery Query on LAN"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-primary ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Scanning...' : 'Scan LAN'}
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow transition-colors"
            title="Connect directly to known IP address"
          >
            <Plus className="w-3.5 h-3.5" /> Direct IP Connect
          </button>
        </div>
      </div>

      {/* Local Node Card */}
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-foreground">{systemInfo?.computerName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold">
                THIS COMPUTER
              </span>
              <span className="text-xs text-muted-foreground">({profile?.displayName})</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Windows User: <span className="font-medium text-foreground">{systemInfo?.osUsername}</span> • Device ID:{' '}
              <span className="font-mono text-[11px] text-foreground">{profile?.deviceId}</span>
            </p>
          </div>
        </div>

        <div className="text-right space-y-1">
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-semibold">
            <Wifi className="w-3.5 h-3.5" /> Listening on TCP 45821
          </span>
          <p className="text-[11px] text-muted-foreground">
            {systemInfo?.networkInterfaces?.[0]?.address || '127.0.0.1'}
          </p>
        </div>
      </div>

      {/* Discovered Peers List */}
      {remoteDevices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card/20 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center text-muted-foreground">
            <RefreshCw className={`w-6 h-6 text-primary ${isScanning ? 'animate-spin' : ''}`} />
          </div>
          <h3 className="font-bold text-base text-foreground">Listening for LAN Beacons</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Computers on the same Wi-Fi router or Ethernet switch running IP Messenger will automatically appear here.
            You can also connect to an IP directly using the button above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-1">
            <span>AVAILABLE PEERS ({remoteDevices.length})</span>
            <span>ED25519 VERIFIED</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {remoteDevices.map((device) => (
              <div
                key={device.id}
                className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/30 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-muted border border-border flex items-center justify-center text-foreground font-bold text-sm relative">
                    <Laptop className="w-5 h-5 text-muted-foreground" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${
                        device.status === 'online'
                          ? 'bg-emerald-500'
                          : device.status === 'busy'
                          ? 'bg-rose-500'
                          : device.status === 'away'
                          ? 'bg-amber-500'
                          : 'bg-muted-foreground/60'
                      }`}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">{device.displayName}</span>
                      <span className="text-xs text-muted-foreground">({device.hostname})</span>
                      {getStatusBadge(device.status)}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        IP: <span className="font-mono text-foreground font-medium">{device.ipAddress}:{device.tcpPort}</span>
                      </span>
                      <span>•</span>
                      <span>
                        ID: <span className="font-mono text-[11px] text-foreground">{device.id.slice(0, 16)}...</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatLastSeen(device.lastSeen)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Trust Verification Toggle */}
                  <button
                    onClick={() => toggleTrust(device.id, !device.isTrusted)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      device.isTrusted
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20'
                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title={device.isTrusted ? 'Device is trusted (Click to untrust)' : 'Click to mark as trusted device'}
                  >
                    {device.isTrusted ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" /> Trusted
                      </>
                    ) : (
                      <>
                        <Shield className="w-3.5 h-3.5" /> Verify
                      </>
                    )}
                  </button>

                  {/* Quick Action: Message */}
                  <button
                    onClick={() => handleStartChat(device.id)}
                    className="p-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Send Message"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>

                  {/* Quick Action: Files */}
                  <button
                    onClick={() => setActiveTab('files')}
                    className="p-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Share Files"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Direct Connect Modal */}
      <DirectConnectModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
};
