import { create } from 'zustand';

export type NavTab = 'chats' | 'groups' | 'private' | 'files' | 'calls' | 'devices' | 'settings';

interface NavigationState {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeTab: 'chats',
  setActiveTab: (tab: NavTab) => set({ activeTab: tab }),
}));
