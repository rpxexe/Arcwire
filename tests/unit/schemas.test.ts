import { describe, it, expect } from 'vitest';
import {
  NetworkEnvelopeSchema,
  ProfileCreateSchema,
  AppSettingsSchema,
  IpmEventType,
  IPM_PROTOCOL,
} from '@ipm/shared';

describe('Shared Package - Zod Validation Schemas', () => {
  it('validates a correct network envelope', () => {
    const validEnvelope = {
      protocol: IPM_PROTOCOL,
      id: 'a0b1c2d3-e4f5-4a7b-8c9d-0e1f2a3b4c5d',
      type: IpmEventType.CHAT_MESSAGE,
      senderId: 'dev_1234567890abcdef1234',
      receiverId: 'dev_abcdef1234567890abcd',
      conversationId: 'conv_123',
      timestamp: Date.now(),
      sequence: 1,
      payload: { content: 'Hello World' },
    };

    const parsed = NetworkEnvelopeSchema.safeParse(validEnvelope);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid network envelopes', () => {
    const invalidEnvelope = {
      protocol: 'INVALID/9',
      id: 'not-a-uuid',
      type: 'UNKNOWN_TYPE',
    };

    const parsed = NetworkEnvelopeSchema.safeParse(invalidEnvelope);
    expect(parsed.success).toBe(false);
  });

  it('validates and enforces profile input boundaries', () => {
    const validProfile = {
      displayName: 'Alice Engineer',
      username: 'alice_eng',
      status: 'online',
    };
    expect(ProfileCreateSchema.safeParse(validProfile).success).toBe(true);

    const emptyName = {
      displayName: '',
      username: 'alice',
    };
    expect(ProfileCreateSchema.safeParse(emptyName).success).toBe(false);
  });

  it('validates and defaults app settings', () => {
    const defaultSettings = {
      theme: 'dark' as const,
      udpPort: 45820,
      tcpPort: 45821,
      signalingPort: 45822,
      minimizeToTray: true,
      startWithWindows: false,
      notificationsEnabled: true,
      autoDownloadFiles: false,
    };
    const parsed = AppSettingsSchema.safeParse(defaultSettings);
    expect(parsed.success).toBe(true);
  });
});

