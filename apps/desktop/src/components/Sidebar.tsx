import React from 'react';
import {
  MessageSquare,
  Users,
  Shield,
  FolderSync,
  PhoneCall,
  Laptop,
  Settings,
  Lock,
} from 'lucide-react';
import { useNavigationStore, NavTab } from '../stores/navigationStore';
import { useProfileStore } from '../stores/profileStore';
import { useChatStore } from '../stores/chatStore';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
  isLocked?: boolean;
}

const navItems: NavItem[] = [
  { id: 'chats', label: 'All Chats', icon: MessageSquare },
  { id: 'groups', label: 'Groups', icon: Users },
  { id: 'private', label: 'Private Chats', icon: Shield, badge: 'Locked', isLocked: true },
  { id: 'files', label: 'File Sharing', icon: FolderSync },
  { id: 'calls', label: 'Calls', icon: PhoneCall },
  { id: 'devices', label: 'Devices', icon: Laptop },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab } = useNavigationStore();
  const { profile, openProfileModal } = useProfileStore();
  const { setFilterTab } = useChatStore();

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'online':
        return 'bg-emerald-500';
      case 'busy':
        return 'bg-rose-500';
      case 'away':
        return 'bg-amber-500';
      default:
        return 'bg-zinc-400';
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return 'IP';
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const handleNavClick = (tab: NavTab) => {
    if (tab === 'groups') {
      setFilterTab('groups');
      setActiveTab('chats');
    } else if (tab === 'chats') {
      setFilterTab('all');
      setActiveTab('chats');
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col justify-between select-none">
      {/* Navigation Links */}
      <div className="p-3 space-y-1">
        <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Menu
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (item.id === 'groups' && activeTab === 'chats' && useChatStore.getState().filterTab === 'groups') ||
            (item.id === 'chats' && activeTab === 'chats' && useChatStore.getState().filterTab !== 'groups');

          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {item.isLocked && <Lock className="w-2.5 h-2.5" />}
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Profile Bar */}
      <div className="p-3 border-t border-border bg-sidebar/50">
        <button
          onClick={openProfileModal}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left group"
        >
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-semibold text-primary text-xs">
              {getInitials(profile?.displayName)}
            </div>
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-sidebar ${getStatusColor(
                profile?.status
              )}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {profile?.displayName || 'Loading...'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              @{profile?.username || 'user'}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
};
