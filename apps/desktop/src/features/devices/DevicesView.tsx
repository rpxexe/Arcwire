import React from 'react';
import { Laptop, RefreshCw, Plus, ShieldCheck, Wifi, ExternalLink } from 'lucide-react';
import { useProfileStore } from '../../stores/profileStore';

export const DevicesView: React.FC = () => {
  const { systemInfo } = useProfileStore();

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-6 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Discovered LAN Devices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time peer discovery broadcasting on UDP port 45820 across active network adapters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3.5 py-2 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors"
            title="Broadcast UDP Discovery Query"
          >
            <RefreshCw className="w-3.5 h-3.5 text-primary" /> Scan LAN
          </button>
          <button
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
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Windows User: <span className="font-medium text-foreground">{systemInfo?.osUsername}</span> • Platform:{' '}
              <span className="font-medium text-foreground">{systemInfo?.platform} ({systemInfo?.arch})</span>
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-semibold">
            <Wifi className="w-3.5 h-3.5" /> Listening on 45821
          </span>
        </div>
      </div>

      {/* Discovered Peers List / Empty State */}
      <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card/20 space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
        <h3 className="font-bold text-base text-foreground">Listening for LAN Beacons</h3>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Computers on the same Wi-Fi router or Ethernet switch running IP Messenger will automatically appear here.
          You can also connect to an IP directly using the button above.
        </p>
      </div>
    </div>
  );
};
