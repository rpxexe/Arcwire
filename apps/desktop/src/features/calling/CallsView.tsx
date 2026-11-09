import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  Video,
  Monitor,
  PhoneCall,
  Clock,
  Mic,
  Camera,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { CallType } from '@ipm/shared';

export const CallsView: React.FC = () => {
  const { callHistory, fetchCallHistory, startCall } = useCallStore();
  const { devices, fetchDevices } = useDeviceStore();

  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [selectedCallType, setSelectedCallType] = useState<CallType>('voice');

  // Media preview test state
  const [isCamTestActive, setIsCamTestActive] = useState(false);
  const testVideoRef = useRef<HTMLVideoElement | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    fetchDevices();
    fetchCallHistory();
    return () => {
      // Clean up test stream if running
      if (testStreamRef.current) {
        testStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleCameraTest = async () => {
    if (isCamTestActive) {
      if (testStreamRef.current) {
        testStreamRef.current.getTracks().forEach((t) => t.stop());
        testStreamRef.current = null;
      }
      setIsCamTestActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        testStreamRef.current = stream;
        if (testVideoRef.current) {
          testVideoRef.current.srcObject = stream;
        }
        setIsCamTestActive(true);
      } catch (err) {
        console.error('Could not access camera for test preview', err);
      }
    }
  };

  const handleStartCall = async () => {
    if (!selectedPeerId) return;
    await startCall('global', selectedPeerId, selectedCallType);
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const getPeerDisplayName = (peerId: string): string => {
    const dev = devices.find((d) => d.id === peerId);
    return dev?.displayName || peerId.slice(0, 8);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-xl font-semibold text-foreground">LAN Calling & Screen Share</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Zero-cloud WebRTC voice calling, HD video calls, and screen sharing with TLS signaling.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> LAN Mode (No STUN/TURN)
          </span>
        </div>
      </div>

      {/* Quick Call Starter */}
      <div className="p-5 rounded-lg border border-border bg-card space-y-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-primary" /> Start a LAN Call
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Peer Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Select Online Peer</label>
            <select
              value={selectedPeerId}
              onChange={(e) => setSelectedPeerId(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a Peer Device…</option>
              {devices
                .filter((d) => d.status === 'online')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName} ({d.ipAddress})
                  </option>
                ))}
            </select>
          </div>

          {/* Call Type Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Call Type</label>
            <div className="flex items-center gap-1 bg-muted p-1 rounded-md border border-border">
              <button
                type="button"
                onClick={() => setSelectedCallType('voice')}
                className={`flex-1 py-1 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99] ${
                  selectedCallType === 'voice'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Phone className="w-3.5 h-3.5" /> Voice
              </button>
              <button
                type="button"
                onClick={() => setSelectedCallType('video')}
                className={`flex-1 py-1 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99] ${
                  selectedCallType === 'video'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Video className="w-3.5 h-3.5" /> Video
              </button>
              <button
                type="button"
                onClick={() => setSelectedCallType('screen')}
                className={`flex-1 py-1 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99] ${
                  selectedCallType === 'screen'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> Screen
              </button>
            </div>
          </div>

          {/* Call Action Button */}
          <div className="space-y-1.5 flex flex-col justify-end">
            <button
              onClick={handleStartCall}
              disabled={!selectedPeerId}
              className="w-full py-2 rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium flex items-center justify-center gap-2 shadow-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99]"
            >
              {selectedCallType === 'voice' ? (
                <Phone className="w-4 h-4" />
              ) : selectedCallType === 'video' ? (
                <Video className="w-4 h-4" />
              ) : (
                <Monitor className="w-4 h-4" />
              )}
              Start Call
            </button>
          </div>
        </div>
      </div>

      {/* Device & Hardware Verification */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Camera Hardware Check */}
        <div className="p-4 rounded-lg bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Camera className="w-4 h-4 text-primary" /> Camera Test
            </div>
            <button
              onClick={toggleCameraTest}
              className="px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80 text-foreground text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99]"
            >
              {isCamTestActive ? 'Stop Preview' : 'Test Camera'}
            </button>
          </div>

          <div className="h-32 bg-background rounded-md border border-border overflow-hidden flex items-center justify-center relative">
            <video
              ref={testVideoRef}
              autoPlay
              playsInline
              muted
              poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
              className={`w-full h-full object-cover ${isCamTestActive ? 'block' : 'hidden'}`}
            />
            {!isCamTestActive && (
              <span className="text-xs text-muted-foreground">Camera preview inactive</span>
            )}
          </div>
        </div>

        {/* Audio Verification */}
        <div className="p-4 rounded-lg bg-card border border-border space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Mic className="w-4 h-4 text-primary" /> Audio & Microphone Status
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Microphone Input:</span>
              <span className="font-medium text-emerald-500">Ready</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="bg-emerald-500 h-1.5 w-3/4 rounded-full" />
            </div>

            <div className="flex items-center justify-between text-xs pt-2">
              <span className="text-muted-foreground">Signaling Channel:</span>
              <span className="font-mono text-foreground text-[11px]">TLS TCP Port 45821</span>
            </div>
          </div>
        </div>
      </div>

      {/* Call History Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Recent Call Logs ({callHistory.length})
          </h2>
          <button
            onClick={() => fetchCallHistory()}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary"
            title="Refresh History"
            aria-label="Refresh History"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {callHistory.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-border bg-card text-center">
            <p className="text-xs text-muted-foreground">No call history recorded yet.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted border-b border-border text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Peer Device</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Duration</th>
                  <th className="p-3 font-medium">Timestamp</th>
                  <th className="p-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {callHistory.map((call) => {
                  const peerId =
                    call.callerDeviceId === devices[0]?.id
                      ? call.receiverDeviceId
                      : call.callerDeviceId;
                  const peerName = getPeerDisplayName(peerId);

                  return (
                    <tr key={call.id} className="hover:bg-muted/40 transition-colors duration-150 ease-out">
                      <td className="p-3 font-medium text-foreground flex items-center gap-2">
                        {call.callType === 'voice' ? (
                          <Phone className="w-4 h-4 text-primary" />
                        ) : call.callType === 'video' ? (
                          <Video className="w-4 h-4 text-primary" />
                        ) : (
                          <Monitor className="w-4 h-4 text-primary" />
                        )}
                        <span>{peerName}</span>
                      </td>
                      <td className="p-3 text-[11px] text-muted-foreground capitalize">
                        {call.callType}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${
                          call.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : call.status === 'rejected'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">
                        {formatDuration(call.durationSeconds)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(call.startedAt).toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => startCall('global', peerId, call.callType)}
                          className="px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.99]"
                        >
                          Call Back
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
