import React, { useState, useEffect } from 'react';
import {
  Monitor,
  AppWindow,
  X,
  Volume2,
  Sparkles,
  Zap,
  FileText,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { DesktopSourceItem, ScreenSharePreset, ScreenShareOptions } from '@ipm/shared';

export interface ScreenPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (sourceId: string, options: ScreenShareOptions) => void;
  isSwitching?: boolean;
}

export const ScreenPickerModal: React.FC<ScreenPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
  isSwitching = false,
}) => {
  const { desktopSources, fetchDesktopSources } = useCallStore();

  const [activeTab, setActiveTab] = useState<'screen' | 'window'>('screen');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [preset, setPreset] = useState<ScreenSharePreset>('balanced');
  const [withAudio, setWithAudio] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchDesktopSources();
    }
  }, [isOpen, fetchDesktopSources]);

  // Separate sources into screens and windows
  const screenSources = desktopSources.filter(
    (s) => s.type === 'screen' || s.id.startsWith('screen:')
  );
  const windowSources = desktopSources.filter(
    (s) => s.type === 'window' && !s.id.startsWith('screen:')
  );

  const displayedSources = activeTab === 'screen' ? screenSources : windowSources;

  // Auto-select first source if none selected
  useEffect(() => {
    if (displayedSources.length > 0 && !selectedSourceId) {
      const first = displayedSources[0];
      if (first) {
        setSelectedSourceId(first.id);
      }
    }
  }, [displayedSources, selectedSourceId]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDesktopSources();
    setIsRefreshing(false);
  };

  const handleConfirmShare = () => {
    if (!selectedSourceId) return;

    const source = desktopSources.find((s) => s.id === selectedSourceId);
    const sourceName = source ? source.name : 'Desktop Screen';

    const maxFrameRate = preset === 'smooth' ? 60 : preset === 'crisp' ? 15 : 30;
    const contentHint = preset === 'smooth' ? 'motion' : 'detail';

    onSelectSource(selectedSourceId, {
      sourceId: selectedSourceId,
      sourceName,
      preset,
      withAudio,
      maxFrameRate,
      contentHint,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/50 shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-base text-foreground">
              {isSwitching ? 'Switch Shared Screen' : 'Share Your Screen'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className={`p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              title="Refresh Windows & Displays"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Buttons (Screens vs Windows) */}
        <div className="px-6 pt-3 pb-2 flex items-center justify-between border-b border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('screen');
                const first = screenSources[0];
                if (first) setSelectedSourceId(first.id);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'screen'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" /> Entire Screens ({screenSources.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('window');
                const first = windowSources[0];
                if (first) setSelectedSourceId(first.id);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'window'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <AppWindow className="w-3.5 h-3.5" /> Application Windows ({windowSources.length})
            </button>
          </div>

          <span className="text-[11px] text-muted-foreground font-medium">
            Select a source to broadcast
          </span>
        </div>

        {/* Sources Grid Container */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[220px]">
          {displayedSources.length === 0 ? (
            <div className="h-44 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
              <Monitor className="w-10 h-10 stroke-1 opacity-50" />
              <p className="text-xs font-semibold">No active {activeTab} sources detected</p>
              <p className="text-[11px]">Make sure the application window is open and unminimized.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              {displayedSources.map((source) => {
                const isSelected = selectedSourceId === source.id;
                return (
                  <div
                    key={source.id}
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={handleConfirmShare}
                    className={`group relative p-2 rounded-xl border transition-all cursor-pointer flex flex-col space-y-2 ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/30 shadow-md'
                        : 'border-border bg-card/60 hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    {/* Thumbnail Preview */}
                    <div className="w-full aspect-video bg-black/90 rounded-lg overflow-hidden flex items-center justify-center relative border border-border/40">
                      <img
                        src={source.thumbnail}
                        alt={source.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                      />
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md animate-in zoom-in-50">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </div>

                    {/* Source Name & Icon */}
                    <div className="flex items-center gap-1.5 min-w-0 px-0.5">
                      {source.appIcon ? (
                        <img src={source.appIcon} alt="" className="w-4 h-4 rounded shrink-0 object-contain" />
                      ) : activeTab === 'screen' ? (
                        <Monitor className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : (
                        <AppWindow className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-medium text-foreground truncate" title={source.name}>
                        {source.name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quality Presets & Audio Settings Footer */}
        <div className="px-6 py-3.5 bg-muted/30 border-t border-border flex flex-wrap items-center justify-between gap-4 shrink-0">
          {/* Preset Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Quality:
            </span>
            <div className="inline-flex rounded-lg bg-card border border-border p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setPreset('balanced')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  preset === 'balanced'
                    ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="1080p @ 30fps - Balanced performance"
              >
                <Zap className="w-3 h-3" /> Balanced (30fps)
              </button>
              <button
                type="button"
                onClick={() => setPreset('smooth')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  preset === 'smooth'
                    ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="1080p @ 60fps - High framerate for video & motion"
              >
                <Sparkles className="w-3 h-3" /> Smooth (60fps)
              </button>
              <button
                type="button"
                onClick={() => setPreset('crisp')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  preset === 'crisp'
                    ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="1080p @ 15fps - Razor sharp text for code & spreadsheets"
              >
                <FileText className="w-3 h-3" /> Crisp Text (15fps)
              </button>
            </div>
          </div>

          {/* System Audio Checkbox */}
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
            <input
              type="checkbox"
              checked={withAudio}
              onChange={(e) => setWithAudio(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
            />
            <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Share computer audio</span>
          </label>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-border bg-card hover:bg-muted text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmShare}
              disabled={!selectedSourceId}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Monitor className="w-3.5 h-3.5" />
              {isSwitching ? 'Switch Screen' : 'Share Screen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
