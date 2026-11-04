import { desktopCapturer, BrowserWindow, Notification } from 'electron';
import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import type { CallRepository, SettingsRepository } from '@ipm/database';
import type { LanTransportAdapter } from '@ipm/networking';
import {
  IpmEventType,
  IpcChannels,
  NetworkEnvelope,
  CallItem,
  CallType,
  CallStatus,
  InitiateCallInput,
  CallSignalInput,
  DesktopSourceItem,
} from '@ipm/shared';

export interface CallSignalingServiceOptions {
  localDeviceId: string;
  callRepo: CallRepository;
  settingsRepo: SettingsRepository;
  getLanAdapter: () => LanTransportAdapter | null;
  getMainWindow: () => BrowserWindow | null;
}

export class CallSignalingService extends EventEmitter {
  private localDeviceId: string;
  private callRepo: CallRepository;
  private settingsRepo: SettingsRepository;
  private getLanAdapter: () => LanTransportAdapter | null;
  private getMainWindow: () => BrowserWindow | null;

  constructor(options: CallSignalingServiceOptions) {
    super();
    this.localDeviceId = options.localDeviceId;
    this.callRepo = options.callRepo;
    this.settingsRepo = options.settingsRepo;
    this.getLanAdapter = options.getLanAdapter;
    this.getMainWindow = options.getMainWindow;
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  // ==========================================
  // Outgoing Call Actions
  // ==========================================

  public async initiateCall(input: InitiateCallInput): Promise<CallItem> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('Networking adapter not available');

    const callId = crypto.randomUUID();
    const call = this.callRepo.createCall({
      id: callId,
      conversationId: input.conversationId,
      callerDeviceId: this.localDeviceId,
      receiverDeviceId: input.receiverDeviceId,
      callType: input.callType,
      status: 'ringing',
    });

    // Send CALL_REQUEST packet to peer over TLS transport
    await adapter.sendPayload(
      input.receiverDeviceId,
      IpmEventType.CALL_REQUEST,
      {
        callId,
        conversationId: input.conversationId,
        callerDeviceId: this.localDeviceId,
        callType: input.callType,
      },
      input.conversationId
    );

    return call;
  }

  public async acceptCall(callId: string): Promise<void> {
    const call = this.callRepo.getCallById(callId);
    const adapter = this.getLanAdapter();
    if (!call || !adapter) throw new Error('Call or network adapter not found');

    this.callRepo.updateCallStatus(callId, 'ongoing');

    // Notify caller
    await adapter.sendPayload(
      call.callerDeviceId,
      IpmEventType.CALL_ACCEPT,
      { callId, responderDeviceId: this.localDeviceId },
      call.conversationId
    );
  }

  public async rejectCall(callId: string): Promise<void> {
    const call = this.callRepo.getCallById(callId);
    const adapter = this.getLanAdapter();
    if (call && adapter) {
      this.callRepo.updateCallStatus(callId, 'rejected');
      const targetPeer = call.callerDeviceId === this.localDeviceId ? call.receiverDeviceId : call.callerDeviceId;
      await adapter.sendPayload(
        targetPeer,
        IpmEventType.CALL_REJECT,
        { callId, responderDeviceId: this.localDeviceId },
        call.conversationId
      );
    }
  }

  public async endCall(callId: string): Promise<void> {
    const call = this.callRepo.getCallById(callId);
    const adapter = this.getLanAdapter();
    if (call && adapter) {
      this.callRepo.endCall(callId, 'completed');
      const targetPeer = call.callerDeviceId === this.localDeviceId ? call.receiverDeviceId : call.callerDeviceId;
      await adapter.sendPayload(
        targetPeer,
        IpmEventType.CALL_END,
        { callId, senderDeviceId: this.localDeviceId },
        call.conversationId
      );
    }
  }

  public async sendSignal(input: CallSignalInput): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('Networking adapter not available');

    const call = this.callRepo.getCallById(input.callId);
    const conversationId = call?.conversationId || 'global';

    await adapter.sendPayload(
      input.targetDeviceId,
      IpmEventType.CALL_SIGNAL,
      {
        callId: input.callId,
        targetDeviceId: input.targetDeviceId,
        signalType: input.signalType,
        data: input.data,
      },
      conversationId
    );
  }

  public async getDesktopSources(): Promise<DesktopSourceItem[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      display_id: s.display_id,
    }));
  }

  // ==========================================
  // Incoming Call Packet Handlers
  // ==========================================

  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<void> {
    const win = this.getMainWindow();

    switch (envelope.type) {
      case IpmEventType.CALL_REQUEST: {
        const payload = envelope.payload as {
          callId: string;
          conversationId: string;
          callerDeviceId: string;
          callType: CallType;
        };

        const incomingCall = this.callRepo.createCall({
          id: payload.callId,
          conversationId: payload.conversationId,
          callerDeviceId: payload.callerDeviceId,
          receiverDeviceId: this.localDeviceId,
          callType: payload.callType,
          status: 'ringing',
        });

        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CALL_INCOMING, incomingCall);
        }

        const settings = this.settingsRepo.getSettings();
        if ((settings.notificationsEnabled ?? true) && win && !win.isFocused()) {
          new Notification({
            title: `Incoming ${payload.callType} call`,
            body: `LAN peer is calling you...`,
          }).show();
        }
        break;
      }

      case IpmEventType.CALL_ACCEPT: {
        const payload = envelope.payload as { callId: string; responderDeviceId: string };
        this.callRepo.updateCallStatus(payload.callId, 'ongoing');

        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CALL_ACCEPTED, { callId: payload.callId });
        }
        break;
      }

      case IpmEventType.CALL_REJECT: {
        const payload = envelope.payload as { callId: string; responderDeviceId: string };
        this.callRepo.updateCallStatus(payload.callId, 'rejected');

        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CALL_REJECTED, { callId: payload.callId });
        }
        break;
      }

      case IpmEventType.CALL_END: {
        const payload = envelope.payload as { callId: string; senderDeviceId: string; reason?: string };
        this.callRepo.endCall(payload.callId, 'completed');

        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CALL_ENDED, { callId: payload.callId });
        }
        break;
      }

      case IpmEventType.CALL_SIGNAL: {
        const payload = envelope.payload as CallSignalInput;
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CALL_SIGNAL, payload);
        }
        break;
      }

      default:
        break;
    }
  }

  public destroy(): void {
    this.removeAllListeners();
  }
}

