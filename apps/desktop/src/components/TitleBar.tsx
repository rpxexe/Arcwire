import React, { useEffect, useRef } from 'react';
import { Minus, Square, X, Radio } from 'lucide-react';
import { useProfileStore } from '../stores/profileStore';
import { useThemeStore } from '../stores/themeStore';

/** Width Windows reserves for the native minimize / maximize / close buttons (3 × 46px). */
const NATIVE_CONTROLS_WIDTH = 138;

const toHex = (cssColor: string): string | null => {
  const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
};

export const TitleBar: React.FC = () => {
  const { systemInfo } = useProfileStore();
  const isDark = useThemeStore((s) => s.resolvedDark);
  const barRef = useRef<HTMLDivElement>(null);
  const nativeControls = Boolean(window.api?.hasNativeWindowControls);

  // Keep the native caption buttons in the same colors as our title bar
  useEffect(() => {
    if (!nativeControls || !barRef.current) return;
    const frame = requestAnimationFrame(() => {
      const el = barRef.current;
      if (!el) return;
      const style = getComputedStyle(el);
      const color = toHex(style.backgroundColor);
      const symbolColor = toHex(getComputedStyle(document.body).color) ?? (isDark ? '#f0f7f9' : '#05161a');
      if (color && symbolColor) void window.api.setTitleBarOverlay({ color, symbolColor });
    });
    return () => cancelAnimationFrame(frame);
  }, [isDark, nativeControls]);

  const ipCount = systemInfo?.networkInterfaces.length || 0;
  const primaryIp = systemInfo?.networkInterfaces.find((i) => !i.internal)?.address || '127.0.0.1';

  return (
    <div
      ref={barRef}
      className="app-drag-region h-9 w-full shrink-0 bg-sidebar border-b border-sidebar-border flex items-center justify-between pl-3 select-none text-xs text-muted-foreground z-50"
      style={{ paddingRight: nativeControls ? NATIVE_CONTROLS_WIDTH : 0 }}
    >
      {/* Left: App Branding */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-primary flex items-center justify-center text-primary-foreground">
          <Radio className="w-2.5 h-2.5" />
        </div>
        <span className="font-semibold text-foreground">Arcwire</span>
        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">LAN</span>
      </div>

      {/* Center: Network Pill */}
      <div className="flex items-center gap-1.5 bg-background border border-border rounded-full px-2.5 py-0.5">
        <span className="relative flex h-2 w-2">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="text-[11px] font-mono text-foreground">{primaryIp}</span>
        <span className="text-[10px] text-muted-foreground">({ipCount} adapter{ipCount === 1 ? '' : 's'})</span>
      </div>

      {/* Right: window controls — native on Windows, custom elsewhere */}
      {nativeControls ? (
        <div className="w-px" aria-hidden />
      ) : (
        <div className="app-no-drag flex items-center">
          <button
            onClick={() => window.api.minimizeWindow()}
            className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary"
            title="Minimize"
            aria-label="Minimize window"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => window.api.maximizeWindow()}
            className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary"
            title="Maximize"
            aria-label="Maximize window"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="h-9 w-11 flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-destructive"
            title="Close to tray"
            aria-label="Close to tray"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
