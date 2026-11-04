import { eq } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { profiles, devices } from '../schema/index';
import type { Profile, ProfileCreateInput, ProfileUpdateInput } from '@ipm/shared';

export class ProfileRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public getProfile(): Profile | null {
    const db = this.dbService.getDb();
    const result = db.select().from(profiles).limit(1).all();
    if (!result || result.length === 0) {
      return null;
    }
    const row = result[0];
    if (!row) return null;
    db.insert(devices)
      .values({
        id: row.deviceId,
        publicKey: row.publicKey,
        displayName: row.displayName,
        hostname: row.computerName,
        lastSeen: Date.now(),
        status: 'online',
        createdAt: row.createdAt,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          displayName: row.displayName,
          hostname: row.computerName,
          lastSeen: Date.now(),
          status: 'online',
          updatedAt: Date.now(),
        },
      })
      .run();
    return {
      id: row.id,
      deviceId: row.deviceId,
      displayName: row.displayName,
      username: row.username,
      avatarUrl: row.avatarUrl,
      status: row.status as Profile['status'],
      customStatus: row.customStatus,
      osUsername: row.osUsername,
      computerName: row.computerName,
      publicKey: row.publicKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public createProfile(
    input: ProfileCreateInput,
    systemInfo: { osUsername: string; computerName: string },
    cryptoIdentity: { deviceId: string; publicKey: string }
  ): Profile {
    const db = this.dbService.getDb();
    const now = Date.now();
    const profileId = 'prof_local';

    const newProfile = {
      id: profileId,
      deviceId: cryptoIdentity.deviceId,
      displayName: input.displayName.trim(),
      username: input.username.trim(),
      avatarUrl: input.avatarUrl || null,
      status: input.status || 'online',
      customStatus: input.customStatus || null,
      osUsername: systemInfo.osUsername,
      computerName: systemInfo.computerName,
      publicKey: cryptoIdentity.publicKey,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(profiles).values(newProfile).run();

    return {
      ...newProfile,
      status: newProfile.status as Profile['status'],
    };
  }

  public updateProfile(input: ProfileUpdateInput): Profile {
    const db = this.dbService.getDb();
    const existing = this.getProfile();
    if (!existing) {
      throw new Error('Cannot update profile: No profile has been created yet.');
    }

    const now = Date.now();
    const updateValues: Partial<typeof profiles.$inferInsert> = {
      updatedAt: now,
    };

    if (input.displayName !== undefined) updateValues.displayName = input.displayName.trim();
    if (input.username !== undefined) updateValues.username = input.username.trim();
    if (input.avatarUrl !== undefined) updateValues.avatarUrl = input.avatarUrl;
    if (input.status !== undefined) updateValues.status = input.status;
    if (input.customStatus !== undefined) updateValues.customStatus = input.customStatus;

    db.update(profiles)
      .set(updateValues)
      .where(eq(profiles.id, existing.id))
      .run();

    const updated = this.getProfile();
    if (!updated) {
      throw new Error('Failed to retrieve updated profile');
    }
    return updated;
  }
}
