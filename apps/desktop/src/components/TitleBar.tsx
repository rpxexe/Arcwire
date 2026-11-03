import React from 'react';
import { Minus, Square, X, Radio } from 'lucide-react';
import { useProfileStore } from '../stores/profileStore';

export const TitleBar: React.FC = () => {
  const { systemInfo } = useProfileStore();

  const handleMinimize = () => window.api.minimizeWindow();
  const handleMaximize = () => window.api.maximizeWindow();
  const handleClose = () => window.api.closeWindow();

  const ipCount = systemInfo?.networkInterfaces.length || 0;
  const primaryIp = systemInfo?.networkInterfaces.find((i) => !i.internal)?.address || '127.0.0.1';

  return (
    <div className="titlebar-drag-region h-9 w-full bg-sidebar/80 backdrop-blur border-b border-border flex items-center justify-between px-3 select-none text-xs text-muted-foreground z-50">
      {/* Left: App Branding */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-primary flex items-center justify-center text-primary-foreground">
          <Radio className="w-2.5 h-2.5" />
        </div>
        <span className="font-semibold text-foreground tracking-tight">IP Messenger</span>
        <span className="text-[10px] text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted">LAN 1.0</span>
      </div>

      {/* Center: Network Pill */}
      <div className="flex items-center gap-1.5 bg-background/60 border border-border/60 rounded-full px-2.5 py-0.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="text-[11px] font-medium text-foreground">{primaryIp}</span>
        <span className="text-[10px] text-muted-foreground">({ipCount} adapter{ipCount === 1 ? '' : 's'})</span>
      </div>

      {/* Right: Windows Controls */}
      <div className="titlebar-no-drag flex items-center -mr-3">
        <button
          onClick={handleMinimize}
          className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
          title="Close to Tray"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
