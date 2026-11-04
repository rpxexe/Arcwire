import EventEmitter from 'node:events';
import type { CallType, CallStatus } from '@ipm/shared';

export interface CallSessionOptions {
  callId: string;
  conversationId: string;
  peerDeviceId: string;
  callType: CallType;
  direction: 'incoming' | 'outgoing';
}

export class CallSession extends EventEmitter {
  public readonly callId: string;
  public readonly conversationId: string;
  public readonly peerDeviceId: string;
  public callType: CallType;
  public readonly direction: 'incoming' | 'outgoing';
  public status: CallStatus;
  public readonly startedAt: number;
  public connectedAt: number | null = null;
  public endedAt: number | null = null;
  public isMuted: boolean = false;
  public isVideoEnabled: boolean = true;
  public isScreenSharing: boolean = false;
  public sharedSourceName: string | null = null;

  private durationTimer: NodeJS.Timeout | null = null;
  private durationSeconds: number = 0;

  constructor(options: CallSessionOptions) {
    super();
    this.callId = options.callId;
    this.conversationId = options.conversationId;
    this.peerDeviceId = options.peerDeviceId;
    this.callType = options.callType;
    this.direction = options.direction;
    this.status = 'ringing';
    this.startedAt = Date.now();
    this.isVideoEnabled = options.callType !== 'voice';
  }

  public getDurationSeconds(): number {
    return this.durationSeconds;
  }

  public accept(): void {
    if (this.status === 'ringing') {
      this.status = 'ongoing';
      this.connectedAt = Date.now();
      this.startDurationTimer();
      this.emit('accepted');
      this.emit('stateChanged', this.status);
    }
  }

  public reject(): void {
    this.status = 'rejected';
    this.endedAt = Date.now();
    this.stopDurationTimer();
    this.emit('rejected');
    this.emit('stateChanged', this.status);
  }

  public connect(): void {
    if (this.status !== 'completed' && this.status !== 'rejected') {
      this.status = 'ongoing';
      if (!this.connectedAt) {
        this.connectedAt = Date.now();
        this.startDurationTimer();
      }
      this.emit('connected');
      this.emit('stateChanged', this.status);
    }
  }

  public end(status: CallStatus = 'completed'): void {
    this.status = status;
    this.endedAt = Date.now();
    this.stopDurationTimer();
    this.emit('ended', status);
    this.emit('stateChanged', this.status);
  }

  public toggleMute(muted?: boolean): boolean {
    this.isMuted = muted !== undefined ? muted : !this.isMuted;
    this.emit('audioToggled', !this.isMuted);
    return this.isMuted;
  }

  public toggleVideo(enabled?: boolean): boolean {
    this.isVideoEnabled = enabled !== undefined ? enabled : !this.isVideoEnabled;
    this.emit('videoToggled', this.isVideoEnabled);
    return this.isVideoEnabled;
  }

  public setScreenSharing(sharing: boolean, sourceName?: string): void {
    this.isScreenSharing = sharing;
    this.sharedSourceName = sharing ? (sourceName || 'Display') : null;
    if (sharing) {
      this.callType = 'screen';
    }
    this.emit('screenShareToggled', { isScreenSharing: sharing, sourceName: this.sharedSourceName });
  }

  private startDurationTimer(): void {
    if (this.durationTimer) return;
    this.durationTimer = setInterval(() => {
      this.durationSeconds++;
      this.emit('duration', this.durationSeconds);
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  public destroy(): void {
    this.stopDurationTimer();
    this.removeAllListeners();
  }
}

