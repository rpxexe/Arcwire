import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Laptop,
  Network,
  Folder,
  Shield,
  Bell,
  Check,
  RotateCw,
} from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProfileStore } from '../../stores/profileStore';
import type { AppSettings } from '@ipm/shared';

export const SettingsView: React.FC = () => {
  const { theme, setTheme } = useThemeStore();
  const { systemInfo } = useProfileStore();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const handleToggleMinimizeToTray = async () => {
    if (!settings) return;
    const updated = await window.api.updateSettings({
      minimizeToTray: !settings.minimizeToTray,
    });
    setSettings(updated);
    showSavedBadge();
  };

  const handleToggleNotifications = async () => {
    if (!settings) return;
    const updated = await window.api.updateSettings({
      notificationsEnabled: !settings.notificationsEnabled,
    });
    setSettings(updated);
    showSavedBadge();
  };

  const showSavedBadge = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto space-y-8 select-none">
      {/* Title */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings & Preferences</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure application appearance, network ports, and storage.
          </p>
        </div>
        {isSaved && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-semibold animate-in fade-in">
            <Check className="w-3.5 h-3.5" /> Settings Saved
          </div>
        )}
      </div>

      {/* 1. Appearance / Theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sun className="w-4 h-4 text-primary" /> Appearance
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => setTheme('light')}
            className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
              theme === 'light'
                ? 'border-primary bg-primary/10 shadow-sm'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
              <Sun className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block">Light Theme</span>
              <span className="text-xs text-muted-foreground">High contrast clean light</span>
            </div>
          </button>

          <button
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
              theme === 'dark'
                ? 'border-primary bg-primary/10 shadow-sm'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Moon className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block">Dark Theme</span>
              <span className="text-xs text-muted-foreground">OLED slate dark palette</span>
            </div>
          </button>

          <button
            onClick={() => setTheme('system')}
            className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
              theme === 'system'
                ? 'border-primary bg-primary/10 shadow-sm'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-zinc-500/20 text-zinc-400 flex items-center justify-center">
              <Laptop className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block">System Default</span>
              <span className="text-xs text-muted-foreground">Syncs with Windows settings</span>
            </div>
          </button>
        </div>
      </section>

      {/* 2. Network Ports & Adapters */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" /> Networking Configuration
        </h2>
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-muted/40 border border-border/80">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">UDP Discovery Port</span>
              <span className="font-mono text-base font-bold text-foreground">45820</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">Broadcast beacon port</span>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/80">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">TCP Core Messaging Port</span>
              <span className="font-mono text-base font-bold text-foreground">45821</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">TLS encrypted stream</span>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border border-border/80">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Local Signaling Port</span>
              <span className="font-mono text-base font-bold text-foreground">45822</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">WebRTC call negotiation</span>
            </div>
          </div>

          <div className="pt-2">
            <span className="text-xs font-semibold text-foreground block mb-2">Detected Network Interfaces:</span>
            <div className="space-y-2">
              {systemInfo?.networkInterfaces.map((iface, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border text-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="font-medium text-foreground">{iface.name}</span>
                    <span className="text-muted-foreground font-mono">({iface.mac})</span>
                  </div>
                  <div className="font-mono text-foreground font-semibold">
                    {iface.address} <span className="text-muted-foreground font-normal">/ {iface.netmask}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Storage Hierarchy */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Folder className="w-4 h-4 text-primary" /> Local Storage Locations
        </h2>
        <div className="bg-card border border-border rounded-xl p-5 space-y-3 text-xs">
          <div>
            <span className="text-muted-foreground block font-semibold text-[10px] uppercase">Database Location:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.data}\ipm.db</span>
          </div>
          <div>
            <span className="text-muted-foreground block font-semibold text-[10px] uppercase">Attachments Directory:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.attachments}</span>
          </div>
          <div>
            <span className="text-muted-foreground block font-semibold text-[10px] uppercase">DPAPI Encrypted Secrets:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.security}\identity.dat</span>
          </div>
        </div>
      </section>

      {/* 4. Desktop Behavior */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> Application Lifecycle
        </h2>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Minimize to System Tray on Close</p>
              <p className="text-xs text-muted-foreground">
                Keep the application running in the Windows notification area to receive LAN calls and messages.
              </p>
            </div>
            <button
              onClick={handleToggleMinimizeToTray}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                settings?.minimizeToTray ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings?.minimizeToTray ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Desktop Notifications</p>
              <p className="text-xs text-muted-foreground">
                Display Windows desktop toasts for incoming messages and file transfer requests.
              </p>
            </div>
            <button
              onClick={handleToggleNotifications}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                settings?.notificationsEnabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings?.notificationsEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
