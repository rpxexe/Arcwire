import React, { useEffect } from 'react';
import { TitleBar } from '../components/TitleBar';
import { Sidebar } from '../components/Sidebar';
import { OnboardingModal } from '../features/authentication/OnboardingModal';
import { ProfileModal } from '../features/authentication/ProfileModal';
import { ChatsView } from '../features/chats/ChatsView';
import { DevicesView } from '../features/devices/DevicesView';
import { FilesView } from '../features/files/FilesView';
import { SettingsView } from '../features/settings/SettingsView';
import { useNavigationStore } from '../stores/navigationStore';
import { useProfileStore } from '../stores/profileStore';
import { useThemeStore } from '../stores/themeStore';
import { Shield, PhoneCall, Users, Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { activeTab } = useNavigationStore();
  const { profile, isLoading, loadProfileAndSystem } = useProfileStore();
  const { initializeTheme } = useThemeStore();

  useEffect(() => {
    // 1. Initialize Theme from settings
    window.api
      .getSettings()
      .then((settings) => {
        initializeTheme(settings.theme);
      })
      .catch(() => {
        initializeTheme('system');
      });

    // 2. Load Profile and System information
    loadProfileAndSystem();
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-background flex flex-col items-center justify-center select-none text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-xs font-semibold tracking-wide">Initializing IP Messenger Engine...</span>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'chats':
        return <ChatsView />;
      case 'groups':
        return (
          <div className="flex-1 flex items-center justify-center p-8 select-none">
            <div className="p-8 rounded-2xl bg-card border border-border max-w-md text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-foreground">Distributed LAN Groups</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Group conversations coordinate dynamically through temporary group hosts with automatic host-loss
                detection and deterministic failover election. (Phase 3 module).
              </p>
            </div>
          </div>
        );
      case 'private':
        return (
          <div className="flex-1 flex items-center justify-center p-8 select-none">
            <div className="p-8 rounded-2xl bg-card border border-border max-w-md text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-foreground">Encrypted Private Workspace</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Hidden conversations isolated from normal searches, notifications, and chat lists. Protected by
                PRV-xxxx-xxxx invitation tokens and local Argon2id credentials. (Phase 4 module).
              </p>
            </div>
          </div>
        );
      case 'files':
        return <FilesView />;
      case 'calls':
        return (
          <div className="flex-1 flex items-center justify-center p-8 select-none">
            <div className="p-8 rounded-2xl bg-card border border-border max-w-md text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <PhoneCall className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-foreground">LAN WebRTC Voice & Video</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Real-time zero-cloud audio, video, and screen sharing using local TCP signaling (port 45822) and direct
                LAN peer media connections. (Phase 6-7 module).
              </p>
            </div>
          </div>
        );
      case 'devices':
        return <DevicesView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <ChatsView />;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Draggable Custom Windows Titlebar */}
      <TitleBar />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col bg-background overflow-hidden">{renderActiveView()}</main>
      </div>

      {/* Onboarding Dialog on first launch */}
      {!profile && <OnboardingModal />}

      {/* Profile & Device Identity Modal */}
      <ProfileModal />
    </div>
  );
};
