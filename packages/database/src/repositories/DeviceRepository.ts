import { eq, desc, lt, and, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../connection';
import { devices, deviceAddresses, trustedDevices } from '../schema/index';
import type { DeviceInfo, UserStatus } from '@ipm/shared';

export class DeviceRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public upsertDevice(data: {
    id: string;
    publicKey: string;
    displayName: string;
    hostname: string;
    ipAddress: string;
    tcpPort: number;
    signalingPort: number;
    status: UserStatus;
  }): DeviceInfo {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(devices)
      .values({
        id: data.id,
        publicKey: data.publicKey,
        displayName: data.displayName,
        hostname: data.hostname,
        lastSeen: now,
        status: data.status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          displayName: data.displayName,
          hostname: data.hostname,
          lastSeen: now,
          status: data.status,
          updatedAt: now,
        },
      })
      .run();

    const addressId = `addr_${data.id}_${data.ipAddress.replace(/[^a-zA-Z0-9]/g, '_')}`;
    db.insert(deviceAddresses)
      .values({
        id: addressId,
        deviceId: data.id,
        ipAddress: data.ipAddress,
        tcpPort: data.tcpPort,
        signalingPort: data.signalingPort,
        isReachable: 1,
        lastConnectedAt: now,
      })
      .onConflictDoUpdate({
        target: deviceAddresses.id,
        set: {
          tcpPort: data.tcpPort,
          signalingPort: data.signalingPort,
          isReachable: 1,
          lastConnectedAt: now,
        },
      })
      .run();

    const device = this.getDeviceById(data.id);
    if (!device) {
      throw new Error(`Failed to retrieve upserted device ${data.id}`);
    }
    return device;
  }

  public getAllDevices(): DeviceInfo[] {
    const db = this.dbService.getDb();
    const allDevices = db.select().from(devices).orderBy(desc(devices.lastSeen)).all();

    return allDevices.map((d) => {
      const addr = db
        .select()
        .from(deviceAddresses)
        .where(eq(deviceAddresses.deviceId, d.id))
        .limit(1)
        .all()[0];

      const trusted = db
        .select()
        .from(trustedDevices)
        .where(eq(trustedDevices.deviceId, d.id))
        .limit(1)
        .all()[0];

      return {
        id: d.id,
        publicKey: d.publicKey,
        displayName: d.displayName,
        hostname: d.hostname,
        ipAddress: addr?.ipAddress ?? 'unknown',
        tcpPort: addr?.tcpPort ?? 45821,
        signalingPort: addr?.signalingPort ?? 45822,
        lastSeen: d.lastSeen,
        status: d.status as UserStatus,
        isTrusted: !!trusted,
      };
    });
  }

  public getDeviceById(id: string): DeviceInfo | null {
    const db = this.dbService.getDb();
    const result = db.select().from(devices).where(eq(devices.id, id)).limit(1).all();
    if (!result || result.length === 0) return null;
    const d = result[0];
    if (!d) return null;

    const addr = db
      .select()
      .from(deviceAddresses)
      .where(eq(deviceAddresses.deviceId, d.id))
      .limit(1)
      .all()[0];

    const trusted = db
      .select()
      .from(trustedDevices)
      .where(eq(trustedDevices.deviceId, d.id))
      .limit(1)
      .all()[0];

    return {
      id: d.id,
      publicKey: d.publicKey,
      displayName: d.displayName,
      hostname: d.hostname,
      ipAddress: addr?.ipAddress ?? 'unknown',
      tcpPort: addr?.tcpPort ?? 45821,
      signalingPort: addr?.signalingPort ?? 45822,
      lastSeen: d.lastSeen,
      status: d.status as UserStatus,
      isTrusted: !!trusted,
    };
  }

  public setDeviceTrust(deviceId: string, isTrusted: boolean): void {
    const db = this.dbService.getDb();
    if (isTrusted) {
      const dev = this.getDeviceById(deviceId);
      if (!dev) {
        throw new Error(`Cannot trust non-existent device ${deviceId}`);
      }
      const fingerprint = createHash('sha256')
        .update(Buffer.from(dev.publicKey, 'base64'))
        .digest('hex');

      db.insert(trustedDevices)
        .values({
          id: `trust_${deviceId}`,
          deviceId,
          fingerprint,
          verificationState: 'verified',
          verifiedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: trustedDevices.deviceId,
          set: {
            fingerprint,
            verificationState: 'verified',
            verifiedAt: Date.now(),
          },
        })
        .run();
    } else {
      db.delete(trustedDevices).where(eq(trustedDevices.deviceId, deviceId)).run();
    }
  }

  public updateDeviceStatus(deviceId: string, status: UserStatus): void {
    const db = this.dbService.getDb();
    db.update(devices)
      .set({
        status,
        lastSeen: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(devices.id, deviceId))
      .run();
  }

  public markDevicesOfflineOlderThan(thresholdMs: number): string[] {
    const db = this.dbService.getDb();
    const cutoff = Date.now() - thresholdMs;

    const staleDevices = db
      .select()
      .from(devices)
      .where(and(lt(devices.lastSeen, cutoff), ne(devices.status, 'offline')))
      .all();

    if (staleDevices.length > 0) {
      const ids = staleDevices.map((d) => d.id);
      for (const id of ids) {
        db.update(devices)
          .set({ status: 'offline', updatedAt: Date.now() })
          .where(eq(devices.id, id))
          .run();
      }
      return ids;
    }
    return [];
  }
}
