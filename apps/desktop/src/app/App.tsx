import React, { useEffect } from 'react';
import { TitleBar } from '../components/TitleBar';
import { Sidebar } from '../components/Sidebar';
import { OnboardingModal } from '../features/authentication/OnboardingModal';
import { ProfileModal } from '../features/authentication/ProfileModal';
import { ChatsView } from '../features/chats/ChatsView';
import { DevicesView } from '../features/devices/DevicesView';
import { FilesView } from '../features/files/FilesView';
import { CallsView } from '../features/calling/CallsView';
import { CallOverlay } from '../features/calling/CallOverlay';
import { SettingsView } from '../features/settings/SettingsView';
import { PrivateUnlockScreen } from '../features/private/PrivateUnlockScreen';
import { PrivateChatsWorkspace } from '../features/private/PrivateChatsWorkspace';
import { useNavigationStore } from '../stores/navigationStore';
import { useProfileStore } from '../stores/profileStore';
import { useThemeStore } from '../stores/themeStore';
import { usePrivateChatStore } from '../stores/privateChatStore';
import { useCallStore } from '../stores/callStore';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { activeTab } = useNavigationStore();
  const { profile, isLoading, loadProfileAndSystem } = useProfileStore();
  const { initializeTheme } = useThemeStore();
  const { isUnlocked, init: initPrivateStore } = usePrivateChatStore();
  const { initListeners: initCallListeners } = useCallStore();

  useEffect(() => {
    // 1. Initialize Theme from settings
    if (window.api?.getSettings) {
      window.api
        .getSettings()
        .then((settings) => {
          initializeTheme(settings.theme);
        })
        .catch(() => {
          initializeTheme('system');
        });
    } else {
      initializeTheme('system');
    }

    // 2. Load Profile and System information
    loadProfileAndSystem();

    // 3. Initialize Private Chat store and listeners
    initPrivateStore();

    // 4. Initialize Calling store listeners
    const unsubCalls = initCallListeners();

    return () => {
      unsubCalls?.();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-background flex flex-col items-center justify-center select-none text-muted-foreground gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-xs font-semibold tracking-wide">Initializing Arcwire LAN Engine...</span>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'chats':
      case 'groups':
        return <ChatsView />;
      case 'private':
        return isUnlocked ? <PrivateChatsWorkspace /> : <PrivateUnlockScreen />;
      case 'files':
        return <FilesView />;
      case 'calls':
        return <CallsView />;
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

      {/* Profile & First-Launch Onboarding Modals */}
      <OnboardingModal />
      <ProfileModal />

      {/* Global Active Call & Incoming Prompt Overlay */}
      <CallOverlay />
    </div>
  );
};
