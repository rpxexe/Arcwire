import { eq, desc } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { devices, deviceAddresses } from '../schema/index';
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
  }): void {
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
        isTrusted: false,
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
      isTrusted: false,
    };
  }
}
