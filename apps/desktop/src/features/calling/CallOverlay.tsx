import React, { useRef, useEffect, useState } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Maximize2,
  Minimize2,
  User,
  Activity,
  Layers,
  Sparkles,
  RefreshCw,
  Expand,
  Shrink,
} from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { ScreenPickerModal } from './ScreenPickerModal';
import { ScreenShareOptions } from '@ipm/shared';

export const CallOverlay: React.FC = () => {
  const {
    activeCall,
    incomingCall,
    callStatus,
    callType,
    durationSeconds,
    isMuted,
    isVideoEnabled,
    isScreenSharing,
    isRemoteScreenSharing,
    sharedSourceName,
    remoteSourceName,
    isFitToWindow,
    stats,
    isScreenPickerOpen,
    localStream,
    remoteStream,
    acceptIncomingCall,
    rejectIncomingCall,
    endActiveCall,
    toggleMute,
    toggleVideo,
    startScreenSharing,
    switchScreenSource,
    stopScreenSharing,
    setScreenPickerOpen,
    toggleFitToWindow,
  } = useCallStore();

  const { devices } = useDeviceStore();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStatsHud, setShowStatsHud] = useState(false);

  // Attach local media stream to local preview
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote media stream to main video player
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      if (remoteStream) {
        remoteVideoRef.current.muted = false;
      }
    }
  }, [remoteStream]);

  // Fullscreen keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      } else if (e.key === 'f' || e.key === 'F') {
        if (activeCall && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          setIsFullscreen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, activeCall]);

  const formatDuration = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getPeerDisplayName = (peerId: string): string => {
    const device = devices.find((d) => d.id === peerId);
    return device?.displayName || peerId.slice(0, 8);
  };

  // 1. Incoming Call Prompt Modal
  if (incomingCall && !activeCall) {
    const callerName = getPeerDisplayName(incomingCall.callerDeviceId);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-sm bg-card border border-border rounded-xl p-6 shadow-md text-center space-y-6">
          <div className="relative mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            {incomingCall.callType === 'screen' ? (
              <Monitor className="w-8 h-8 text-primary" />
            ) : incomingCall.callType === 'video' ? (
              <Video className="w-8 h-8 text-primary" />
            ) : (
              <Phone className="w-8 h-8 text-primary" />
            )}
          </div>

          <div className="space-y-1">
            <h3 className="font-semibold text-lg text-foreground">{callerName}</h3>
            <p className="text-xs text-muted-foreground font-medium">
              Incoming {incomingCall.callType} call…
            </p>
          </div>

          <div className="flex items-center justify-center gap-6 pt-2">
            <button
              onClick={rejectIncomingCall}
              className="w-12 h-12 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center shadow-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-destructive active:scale-95"
              title="Decline"
              aria-label="Decline Call"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
            <button
              onClick={acceptIncomingCall}
              className="w-12 h-12 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center shadow-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-emerald-500 active:scale-95"
              title="Accept"
              aria-label="Accept Call"
            >
              <Phone className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Active Call Floating / Fullscreen Overlay
  if (!activeCall) return null;

  const peerId =
    activeCall.callerDeviceId === devices[0]?.id
      ? activeCall.receiverDeviceId
      : activeCall.callerDeviceId;
  const peerName = getPeerDisplayName(peerId);

  const isAnyScreenSharing = isScreenSharing || isRemoteScreenSharing || callType === 'screen';

  return (
    <div
      className={`fixed z-50 transition-opacity duration-150 ease-out bg-background border border-border flex flex-col overflow-hidden shadow-lg ${
        isFullscreen
          ? 'inset-0 rounded-none'
          : 'bottom-6 right-6 w-[560px] h-[420px] rounded-xl'
      }`}
    >
      {/* Top Presentation Notification Bar (when Local is Sharing) */}
      {isScreenSharing && (
        <div className="bg-primary/95 text-primary-foreground px-4 py-2 flex items-center justify-between text-xs font-semibold shrink-0 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 truncate">
            <Monitor className="w-4 h-4 shrink-0" />
            <span className="truncate">
              You are presenting: <strong className="underline">{sharedSourceName || 'Display'}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScreenPickerOpen(true)}
              className="px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Switch
            </button>
            <button
              onClick={stopScreenSharing}
              className="px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 text-[11px] font-bold transition-colors"
            >
              Stop Sharing
            </button>
          </div>
        </div>
      )}

      {/* Top Presentation Notification Bar (when Remote Peer is Sharing) */}
      {isRemoteScreenSharing && !isScreenSharing && (
        <div className="bg-amber-500/90 text-black px-4 py-1.5 flex items-center justify-between text-xs font-semibold shrink-0 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 truncate">
            <Monitor className="w-4 h-4 shrink-0" />
            <span className="truncate">
              <strong>{peerName}</strong> is sharing their screen
              {remoteSourceName ? ` (${remoteSourceName})` : ''}
            </span>
          </div>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-black/15">
            Remote feed
          </span>
        </div>
      )}

      {/* Call Header */}
      <div className="p-3 bg-card border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 motion-safe:animate-ping" />
          <div>
            <h4 className="font-semibold text-xs text-foreground truncate max-w-[200px]">{peerName}</h4>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="capitalize">{callStatus}</span>
              <span>•</span>
              <span className="font-mono">{formatDuration(durationSeconds)}</span>
              {isAnyScreenSharing && (
                <>
                  <span>•</span>
                  <span className="text-primary font-medium">Screen Share</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Fit to Window Toggle (only during Screen Share) */}
          {isAnyScreenSharing && (
            <button
              onClick={toggleFitToWindow}
              className={`p-1.5 rounded-md transition-colors duration-150 ease-out text-muted-foreground hover:text-foreground hover:bg-muted ${
                !isFitToWindow ? 'text-primary' : ''
              }`}
              title={isFitToWindow ? 'Switch to Original 100% Size' : 'Fit to Window'}
            >
              {isFitToWindow ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Diagnostics HUD Toggle */}
          <button
            onClick={() => setShowStatsHud(!showStatsHud)}
            className={`p-1.5 rounded-md transition-colors duration-150 ease-out text-muted-foreground hover:text-foreground hover:bg-muted ${
              showStatsHud ? 'bg-primary/20 text-primary' : ''
            }`}
            title="Toggle Stream Statistics"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 ease-out"
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen (F)'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Video / Screen Stage */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {/* Remote Video Player */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
          className={`w-full h-full ${
            callType === 'voice' && !isAnyScreenSharing ? 'hidden' : 'block'
          } ${isFitToWindow ? 'object-contain' : 'object-none'}`}
        />

        {/* Audio-only Visualizer Placeholder (when in Voice call without screen share) */}
        {callType === 'voice' && !isAnyScreenSharing && (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <User className="w-10 h-10 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <span className="font-medium text-sm text-white">{peerName}</span>
              <p className="text-xs text-muted-foreground">LAN Peer Audio Connected</p>
            </div>
          </div>
        )}

        {/* Local Picture-in-Picture Preview (Local camera or screen feedback) */}
        {(callType !== 'voice' || isAnyScreenSharing) && (
          <div className="absolute top-3 right-3 w-36 h-24 rounded-lg bg-black border border-white/20 overflow-hidden shadow-md z-10">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-1 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-white">
              {isScreenSharing ? 'Your Screen' : 'You'}
            </div>
          </div>
        )}

        {/* Live Stream Statistics HUD */}
        {showStatsHud && stats && (
          <div className="absolute top-3 left-3 bg-card/95 border border-border rounded-md p-2.5 text-[10px] font-mono text-emerald-500 space-y-1 z-20 shadow-md pointer-events-none select-none">
            <div className="flex items-center gap-1 font-semibold text-foreground border-b border-border pb-1">
              <Activity className="w-3 h-3 text-emerald-500" /> WebRTC Stream Diagnostics
            </div>
            <div>Resolution: <span className="text-white">{stats.resolution}</span></div>
            <div>Framerate: <span className="text-white">{stats.fps} FPS</span></div>
            <div>Bitrate: <span className="text-white">{stats.bitrateKbps} kbps</span></div>
            <div>Packet Loss: <span className="text-white">{stats.packetLossPercentage}%</span></div>
            <div>Latency: <span className="text-white">{stats.latencyMs} ms</span></div>
          </div>
        )}
      </div>

      {/* Call Controls Toolbar */}
      <div className="p-3 bg-card/90 border-t border-border flex items-center justify-center gap-3 shrink-0">
        {/* Mic Toggle */}
        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition-colors ${
            isMuted
              ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
              : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Camera Toggle */}
        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full transition-colors ${
            !isVideoEnabled
              ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
              : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        {/* Screen Share Button */}
        <button
          onClick={() => {
            if (isScreenSharing) {
              stopScreenSharing();
            } else {
              setScreenPickerOpen(true);
            }
          }}
          className={`p-3 rounded-full transition-colors ${
            isScreenSharing
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md'
              : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
        >
          <Monitor className="w-4 h-4" />
        </button>

        {/* Hang Up Button */}
        <button
          onClick={endActiveCall}
          className="p-3 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md transition-transform hover:scale-105"
          title="End Call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>

      {/* Dedicated Screen & Window Source Picker Modal */}
      <ScreenPickerModal
        isOpen={isScreenPickerOpen}
        onClose={() => setScreenPickerOpen(false)}
        isSwitching={isScreenSharing}
        onSelectSource={(sourceId, options) => {
          if (isScreenSharing) {
            switchScreenSource(sourceId, options);
          } else {
            startScreenSharing(sourceId, options);
          }
        }}
      />
    </div>
  );
};
