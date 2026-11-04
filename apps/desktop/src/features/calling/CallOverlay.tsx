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
  Check,
  X,
  Radio,
  Layers,
} from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { DesktopSourceItem } from '@ipm/shared';

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
    localStream,
    remoteStream,
    desktopSources,
    acceptIncomingCall,
    rejectIncomingCall,
    endActiveCall,
    toggleMute,
    toggleVideo,
    startScreenSharing,
    stopScreenSharing,
    fetchDesktopSources,
  } = useCallStore();

  const { devices } = useDeviceStore();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);

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
    }
  }, [remoteStream]);

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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-6 shadow-2xl text-center space-y-6">
          <div className="relative mx-auto w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <Phone className="w-10 h-10 text-primary animate-bounce" />
          </div>

          <div className="space-y-1">
            <h3 className="font-bold text-lg text-foreground">{callerName}</h3>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              Incoming {incomingCall.callType} Call...
            </p>
          </div>

          <div className="flex items-center justify-center gap-6 pt-2">
            <button
              onClick={rejectIncomingCall}
              className="w-14 h-14 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center shadow-lg transition-transform hover:scale-105"
              title="Decline"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
            <button
              onClick={acceptIncomingCall}
              className="w-14 h-14 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center shadow-lg transition-transform hover:scale-105"
              title="Accept"
            >
              <Phone className="w-6 h-6" />
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

  return (
    <div
      className={`fixed z-50 transition-all duration-300 bg-background/95 backdrop-blur-xl border border-border flex flex-col overflow-hidden shadow-2xl ${
        isFullscreen
          ? 'inset-0 rounded-0'
          : 'bottom-6 right-6 w-[480px] h-[360px] rounded-3xl'
      }`}
    >
      {/* Call Header */}
      <div className="p-3.5 bg-card/60 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <div>
            <h4 className="font-bold text-xs text-foreground truncate max-w-[180px]">{peerName}</h4>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
              <span className="capitalize">{callStatus}</span>
              <span>•</span>
              <span>{formatDuration(durationSeconds)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Video / Audio Stage */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {/* Remote Video Player (for Video & Screen sharing) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain ${callType === 'voice' ? 'hidden' : 'block'}`}
        />

        {/* Audio-only Visualizer Placeholder (when in Voice call or remote video is off) */}
        {callType === 'voice' && (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-24 h-24 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center animate-pulse">
              <User className="w-12 h-12 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <span className="font-semibold text-sm text-white">{peerName}</span>
              <p className="text-xs text-muted-foreground font-mono">LAN Peer Audio Connected</p>
            </div>
          </div>
        )}

        {/* Local Picture-in-Picture Preview (for Video & Screen sharing) */}
        {callType !== 'voice' && (
          <div className="absolute top-3 right-3 w-32 h-20 rounded-xl bg-black/80 border border-white/20 overflow-hidden shadow-lg z-10">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
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
              fetchDesktopSources();
              setIsSourcePickerOpen(true);
            }
          }}
          className={`p-3 rounded-full transition-colors ${
            isScreenSharing
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
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

      {/* Screen Source Picker Modal */}
      {isSourcePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-primary" /> Select Screen or Window to Share
              </h3>
              <button
                onClick={() => setIsSourcePickerOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto p-1">
              {desktopSources.map((source) => (
                <div
                  key={source.id}
                  onClick={() => {
                    startScreenSharing(source.id);
                    setIsSourcePickerOpen(false);
                  }}
                  className="p-2.5 rounded-xl border border-border bg-background hover:border-primary/60 cursor-pointer transition-all space-y-2 group"
                >
                  <div className="w-full h-24 bg-black rounded-lg overflow-hidden flex items-center justify-center">
                    <img
                      src={source.thumbnail}
                      alt={source.name}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <span className="text-xs font-semibold text-foreground truncate block" title={source.name}>
                    {source.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
