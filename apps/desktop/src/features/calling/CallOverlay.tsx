import React, { useRef, useEffect, useState } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Maximize2,
  Minimize2,
  User,
  Activity,
  RefreshCw,
  Expand,
  Shrink,
  AlertTriangle,
  X,
  Settings2,
} from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProfileStore } from '../../stores/profileStore';
import { ScreenPickerModal } from './ScreenPickerModal';
import type { CallStreamStats } from '@ipm/shared';

const formatDuration = (totalSeconds: number): string => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatKbps = (kbps: number): string => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`);

const StreamRow: React.FC<{ label: string; s?: CallStreamStats | null }> = ({ label, s }) => (
  <div className="grid grid-cols-[64px_1fr] gap-x-2">
    <span className="text-muted-foreground">{label}</span>
    {s ? (
      <span className="text-foreground">
        {s.resolution} · {s.fps} fps · {formatKbps(s.bitrateKbps)}
        {s.codec ? ` · ${s.codec}` : ''}
        {s.isScreen ? ' · screen' : ''}
      </span>
    ) : (
      <span className="text-muted-foreground">no video</span>
    )}
  </div>
);

const statusLabel: Record<string, string> = {
  idle: 'Idle',
  'outgoing-ringing': 'Ringing…',
  'incoming-ringing': 'Incoming…',
  connecting: 'Connecting…',
  connected: 'Connected',
  ended: 'Ended',
};

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
    hasRemoteVideo,
    sharedSourceName,
    remoteSourceName,
    isFitToWindow,
    stats,
    isScreenPickerOpen,
    pendingScreenCall,
    localStream,
    remoteStream,
    error,
    warning,
    isLoading,
    acceptIncomingCall,
    rejectIncomingCall,
    endActiveCall,
    toggleMute,
    toggleVideo,
    startCall,
    startScreenSharing,
    switchScreenSource,
    stopScreenSharing,
    setScreenPickerOpen,
    cancelPendingScreenCall,
    toggleFitToWindow,
    clearError,
  } = useCallStore();

  const { devices } = useDeviceStore();
  const { profile } = useProfileStore();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStatsHud, setShowStatsHud] = useState(false);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    el.muted = false;
    if (remoteStream) el.play().catch(() => {});
  }, [remoteStream, activeCall]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeCall) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
      else if (e.key === 'f' || e.key === 'F') setIsFullscreen((prev) => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, activeCall]);

  // Auto-dismiss non-blocking notices
  useEffect(() => {
    if (!error && !warning) return;
    const t = setTimeout(clearError, 9000);
    return () => clearTimeout(t);
  }, [error, warning, clearError]);

  const getPeerDisplayName = (peerId: string): string => {
    const device = devices.find((d) => d.id === peerId);
    return device?.displayName || peerId.slice(0, 8);
  };

  const isPermissionMessage = (msg: string | null) => Boolean(msg && /Privacy|blocked/i.test(msg));

  const noticeBanner = (msg: string | null, tone: 'error' | 'warning') =>
    msg ? (
      <div
        role="alert"
        className={`flex items-start gap-2 px-3 py-2 text-[11px] leading-snug ${
          tone === 'error' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="flex-1">{msg}</span>
        {isPermissionMessage(msg) && (
          <button
            onClick={() => window.api?.openPrivacySettings?.(/camera/i.test(msg) ? 'camera' : 'microphone')}
            className="inline-flex items-center gap-1 underline underline-offset-2 shrink-0"
          >
            <Settings2 className="w-3 h-3" /> Open settings
          </button>
        )}
        <button onClick={clearError} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ) : null;

  const picker = (
    <ScreenPickerModal
      isOpen={isScreenPickerOpen}
      onClose={() => (pendingScreenCall ? cancelPendingScreenCall() : setScreenPickerOpen(false))}
      isSwitching={isScreenSharing}
      onSelectSource={(sourceId, options) => {
        if (pendingScreenCall) {
          void startCall(pendingScreenCall.conversationId, pendingScreenCall.receiverDeviceId, 'screen', sourceId, options);
        } else if (isScreenSharing) {
          void switchScreenSource(sourceId, options);
        } else {
          void startScreenSharing(sourceId, options);
        }
      }}
    />
  );

  // 1. Incoming Call Prompt
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
              {incomingCall.callType === 'screen' ? 'Wants to share their screen' : `Incoming ${incomingCall.callType} call…`}
            </p>
          </div>

          <div className="flex items-center justify-center gap-6 pt-2">
            <button
              onClick={rejectIncomingCall}
              className="w-12 h-12 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center shadow-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-destructive active:scale-95"
              title="Decline"
              aria-label="Decline call"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
            <button
              onClick={acceptIncomingCall}
              disabled={isLoading}
              className="w-12 h-12 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center shadow-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-emerald-500 active:scale-95 disabled:opacity-60"
              title="Accept"
              aria-label="Accept call"
            >
              <Phone className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. No call: only the pre-call picker and any error toast
  if (!activeCall) {
    return (
      <>
        {picker}
        {(error || warning) && (
          <div className="fixed bottom-6 right-6 z-50 w-[380px] rounded-lg border border-border bg-card shadow-lg overflow-hidden">
            {noticeBanner(error, 'error')}
            {noticeBanner(warning, 'warning')}
          </div>
        )}
      </>
    );
  }

  const myId = profile?.deviceId;
  const peerId = activeCall.callerDeviceId === myId ? activeCall.receiverDeviceId : activeCall.callerDeviceId;
  const peerName = getPeerDisplayName(peerId);
  const showRemoteVideo = hasRemoteVideo;
  const showLocalPreview = Boolean(localStream && localStream.getVideoTracks().length > 0);
  const isAnyScreenSharing = isScreenSharing || isRemoteScreenSharing;

  return (
    <div
      className={`fixed z-50 transition-opacity duration-150 ease-out bg-background border border-border flex flex-col overflow-hidden shadow-lg ${
        isFullscreen ? 'inset-0 rounded-none' : 'bottom-6 right-6 w-[600px] h-[450px] rounded-xl'
      }`}
    >
      {isScreenSharing && (
        <div className="bg-primary/95 text-primary-foreground px-4 py-2 flex items-center justify-between text-xs font-semibold shrink-0">
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
              Stop sharing
            </button>
          </div>
        </div>
      )}

      {isRemoteScreenSharing && !isScreenSharing && (
        <div className="bg-amber-500/90 text-black px-4 py-1.5 flex items-center gap-2 text-xs font-semibold shrink-0 truncate">
          <Monitor className="w-4 h-4 shrink-0" />
          <span className="truncate">
            <strong>{peerName}</strong> is sharing their screen{remoteSourceName ? ` (${remoteSourceName})` : ''}
          </span>
        </div>
      )}

      {noticeBanner(error, 'error')}
      {noticeBanner(warning, 'warning')}

      {/* Header */}
      <div className="p-3 bg-card border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              callStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500 motion-safe:animate-pulse'
            }`}
          />
          <div className="min-w-0">
            <h4 className="font-semibold text-xs text-foreground truncate max-w-[240px]">{peerName}</h4>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{statusLabel[callStatus] ?? callStatus}</span>
              <span>•</span>
              <span className="font-mono">{formatDuration(durationSeconds)}</span>
              {isAnyScreenSharing && (
                <>
                  <span>•</span>
                  <span className="text-primary font-medium">Screen share</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {showRemoteVideo && (
            <button
              onClick={toggleFitToWindow}
              className={`p-1.5 rounded-md transition-colors duration-150 ease-out hover:bg-muted ${
                !isFitToWindow ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              title={isFitToWindow ? 'Show at original size' : 'Fit to window'}
            >
              {isFitToWindow ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => setShowStatsHud(!showStatsHud)}
            className={`p-1.5 rounded-md transition-colors duration-150 ease-out hover:bg-muted ${
              showStatsHud ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Stream statistics"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 ease-out"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {/* Always mounted so remote audio plays even without video */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full ${showRemoteVideo ? 'block' : 'hidden'} ${
            isFitToWindow ? 'object-contain' : 'object-none'
          }`}
        />

        {!showRemoteVideo && (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <User className="w-10 h-10 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <span className="font-medium text-sm text-white">{peerName}</span>
              <p className="text-xs text-white/60">
                {callStatus === 'connected'
                  ? callType === 'video'
                    ? 'Camera is off'
                    : 'Audio connected'
                  : statusLabel[callStatus]}
              </p>
            </div>
          </div>
        )}

        {showLocalPreview && (
          <div className="absolute top-3 right-3 w-40 h-[90px] rounded-lg bg-black border border-white/20 overflow-hidden shadow-md z-10">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-1 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-white">
              {isScreenSharing ? 'Your screen' : 'You'}
            </div>
          </div>
        )}

        {showStatsHud && (
          <div className="absolute top-3 left-3 max-w-[calc(100%-200px)] bg-card/95 border border-border rounded-md p-2.5 text-[10px] font-mono space-y-1 z-20 shadow-md pointer-events-none select-none">
            <div className="flex items-center gap-1 font-semibold text-foreground border-b border-border pb-1">
              <Activity className="w-3 h-3 text-primary" /> Stream statistics
            </div>
            {stats ? (
              <>
                <StreamRow label="Sending" s={stats.outbound} />
                <StreamRow label="Receiving" s={stats.inbound} />
                <div className="grid grid-cols-[64px_1fr] gap-x-2">
                  <span className="text-muted-foreground">Audio</span>
                  <span className="text-foreground">{formatKbps(stats.audioBitrateKbps ?? 0)}</span>
                </div>
                <div className="grid grid-cols-[64px_1fr] gap-x-2">
                  <span className="text-muted-foreground">Network</span>
                  <span className="text-foreground">
                    {stats.latencyMs !== undefined ? `${stats.latencyMs} ms RTT` : 'RTT n/a'} · {stats.packetLossPercentage}% loss
                    {stats.jitterMs !== undefined ? ` · ${stats.jitterMs} ms jitter` : ''}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">
                {callStatus === 'connected' ? 'Collecting statistics…' : 'Available once the call connects'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-3 bg-card/90 border-t border-border flex items-center justify-center gap-3 shrink-0">
        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition-colors ${
            isMuted ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={isMuted}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <button
          onClick={() => void toggleVideo()}
          className={`p-3 rounded-full transition-colors ${
            !isVideoEnabled ? 'bg-muted hover:bg-muted/80 text-muted-foreground' : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          aria-pressed={isVideoEnabled}
        >
          {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        <button
          onClick={() => (isScreenSharing ? void stopScreenSharing() : setScreenPickerOpen(true))}
          className={`p-3 rounded-full transition-colors ${
            isScreenSharing ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md' : 'bg-muted hover:bg-muted/80 text-foreground'
          }`}
          title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          aria-pressed={isScreenSharing}
        >
          {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        </button>

        <button
          onClick={() => void endActiveCall('hangup')}
          className="p-3 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md transition-colors"
          title="End call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>

      {picker}
    </div>
  );
};
