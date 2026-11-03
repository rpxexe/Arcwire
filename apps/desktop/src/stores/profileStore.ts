import { create } from 'zustand';
import type { Profile, ProfileCreateInput, ProfileUpdateInput, SystemInfo } from '@ipm/shared';

interface ProfileState {
  profile: Profile | null;
  systemInfo: SystemInfo | null;
  isLoading: boolean;
  isProfileModalOpen: boolean;
  openProfileModal: () => void;
  closeProfileModal: () => void;
  loadProfileAndSystem: () => Promise<void>;
  createProfile: (input: ProfileCreateInput) => Promise<Profile>;
  updateProfile: (input: ProfileUpdateInput) => Promise<Profile>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  systemInfo: null,
  isLoading: true,
  isProfileModalOpen: false,

  openProfileModal: () => set({ isProfileModalOpen: true }),
  closeProfileModal: () => set({ isProfileModalOpen: false }),

  loadProfileAndSystem: async () => {
    try {
      set({ isLoading: true });
      const [sysInfo, prof] = await Promise.all([
        window.api.getSystemInfo(),
        window.api.getProfile(),
      ]);
      set({ systemInfo: sysInfo, profile: prof, isLoading: false });
    } catch (err) {
      console.error('Failed to load profile and system info:', err);
      set({ isLoading: false });
    }
  },

  createProfile: async (input: ProfileCreateInput) => {
    const newProfile = await window.api.createProfile(input);
    set({ profile: newProfile });
    return newProfile;
  },

  updateProfile: async (input: ProfileUpdateInput) => {
    const updated = await window.api.updateProfile(input);
    set({ profile: updated });
    return updated;
  },
}));
