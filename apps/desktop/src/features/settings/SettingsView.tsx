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
  Mic,
  ShieldAlert,
} from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProfileStore } from '../../stores/profileStore';
import { MediaPermissionPrompt } from './MediaPermissionPrompt';
import type { AppSettings, FirewallStatus } from '@ipm/shared';

export const SettingsView: React.FC = () => {
  const { theme, setTheme } = useThemeStore();
  const { systemInfo } = useProfileStore();
  const [showMediaPrompt, setShowMediaPrompt] = useState(false);
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallError, setFirewallError] = useState<string | null>(null);

  const [firewallChecking, setFirewallChecking] = useState(false);
  const refreshFirewall = async () => {
    setFirewallChecking(true);
    try {
      const status = await window.api?.getFirewallStatus?.();
      if (status) setFirewall(status);
    } catch {
      // keep the previous status
    } finally {
      setFirewallChecking(false);
    }
  };

  // Check on open and again whenever the window regains focus (e.g. after allowing Arcwire
  // in the Windows prompt or in wf.msc).
  useEffect(() => {
    void refreshFirewall();
    const onFocus = () => void refreshFirewall();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Sun className="w-4 h-4 text-primary" /> Appearance
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => setTheme('light')}
            className={`p-4 rounded-lg border flex flex-col items-center gap-3 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary ${
              theme === 'light'
                ? 'border-primary bg-primary/10 shadow-xs'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
              <Sun className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block whitespace-nowrap">Light Theme</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">High contrast clean light</span>
            </div>
          </button>

          <button
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-lg border flex flex-col items-center gap-3 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary ${
              theme === 'dark'
                ? 'border-primary bg-primary/10 shadow-xs'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Moon className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block whitespace-nowrap">Dark Theme</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">OLED slate dark palette</span>
            </div>
          </button>

          <button
            onClick={() => setTheme('system')}
            className={`p-4 rounded-lg border flex flex-col items-center gap-3 transition-colors duration-150 ease-out active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-primary ${
              theme === 'system'
                ? 'border-primary bg-primary/10 shadow-xs'
                : 'border-border bg-card hover:border-primary/50 text-muted-foreground'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-zinc-500/20 text-zinc-400 flex items-center justify-center">
              <Laptop className="w-5 h-5" />
            </div>
            <div className="text-center">
              <span className="font-semibold text-sm text-foreground block whitespace-nowrap">System Default</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">Syncs with Windows settings</span>
            </div>
          </button>
        </div>
      </section>

      {/* 2. Network Ports & Adapters */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" /> Networking Configuration
        </h2>
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-md bg-muted border border-border">
              <span className="text-muted-foreground block text-[11px] font-medium">UDP Discovery Port</span>
              <span className="font-mono text-base font-bold text-foreground">45820</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">Broadcast beacon port</span>
            </div>
            <div className="p-3 rounded-md bg-muted border border-border">
              <span className="text-muted-foreground block text-[11px] font-medium">TCP Core Messaging Port</span>
              <span className="font-mono text-base font-bold text-foreground">45821</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">TLS encrypted stream</span>
            </div>
            <div className="p-3 rounded-md bg-muted border border-border">
              <span className="text-muted-foreground block text-[11px] font-medium">Local Signaling Port</span>
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
                  className="flex items-center justify-between p-2.5 rounded-md bg-background border border-border text-xs"
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
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Folder className="w-4 h-4 text-primary" /> Local Storage Locations
        </h2>
        <div className="bg-card border border-border rounded-lg p-5 space-y-3 text-xs">
          <div>
            <span className="text-muted-foreground block font-medium text-[11px]">Database Location:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.data}\ipm.db</span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium text-[11px]">Attachments Directory:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.attachments}</span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium text-[11px]">DPAPI Encrypted Secrets:</span>
            <span className="font-mono text-foreground break-all select-all">{systemInfo?.paths.security}\identity.dat</span>
          </div>
        </div>
      </section>

      {/* 4. Desktop Behavior */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> Application Lifecycle
        </h2>
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
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

      {/* 5. Windows Firewall */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" /> Windows Firewall
        </h2>
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                {!firewall || (firewallChecking && !firewall.allowed)
                  ? 'Checking firewall…'
                  : !firewall.supported
                  ? 'Not applicable on this OS'
                  : firewall.blocked
                  ? 'Arcwire is blocked by Windows Firewall'
                  : firewall.allowed
                  ? 'Arcwire is allowed through Windows Firewall'
                  : 'Arcwire is not allowed through Windows Firewall'}
              </p>
              <p className="text-xs text-muted-foreground">
                Other PCs can only find and message this PC when it is allowed. Do this on every PC running Arcwire.
                {firewall?.networkCategory ? ` Current network: ${firewall.networkCategory}.` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void refreshFirewall()}
              disabled={firewallChecking}
              className="px-3 py-1.5 rounded-md border border-input text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RotateCw className={`w-3 h-3 ${firewallChecking ? 'animate-spin' : ''}`} /> Re-check
            </button>
            <button
              onClick={async () => {
                setFirewallBusy(true);
                setFirewallError(null);
                try {
                  setFirewall(await window.api.fixFirewall());
                } catch (err) {
                  setFirewallError(
                    ((err as Error)?.message ?? String(err)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
                  );
                } finally {
                  setFirewallBusy(false);
                }
              }}
              disabled={firewallBusy || (firewall?.allowed && !firewall?.blocked) || firewall?.supported === false}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {firewallBusy && <RotateCw className="w-3 h-3 animate-spin" />}
              {firewall?.allowed && !firewall?.blocked ? 'Allowed' : 'Allow through firewall'}
            </button>
            </div>
          </div>
          {(firewallError || firewall?.error) && (
            <p className="text-xs text-destructive">{firewallError ?? firewall?.error}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Windows will ask for administrator permission once. Rules cover UDP {settings?.udpPort ?? 45820} (discovery)
            and TCP {settings?.tcpPort ?? 45821}/{settings?.signalingPort ?? 45822} (messages, files, calls).
          </p>
        </div>
      </section>

      {/* 6. Device permissions */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary" /> Microphone &amp; Camera
        </h2>
        <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Call permissions</p>
            <p className="text-xs text-muted-foreground">
              Grant or re-check access used for voice calls, video calls and screen sharing.
            </p>
          </div>
          <button
            onClick={() => setShowMediaPrompt(true)}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
          >
            Check permissions
          </button>
        </div>
      </section>

      {showMediaPrompt && <MediaPermissionPrompt forceOpen onClose={() => setShowMediaPrompt(false)} />}
    </div>
  );
};
