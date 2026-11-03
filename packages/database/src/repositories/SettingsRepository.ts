import { eq } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { settings } from '../schema/index';
import { AppSettings, DEFAULT_APP_SETTINGS } from '@ipm/shared';

const SETTINGS_KEY = 'app_settings';

export class SettingsRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public getSettings(): AppSettings {
    const db = this.dbService.getDb();
    const result = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1).all();

    if (!result || result.length === 0) {
      this.saveDefaultSettings();
      return { ...DEFAULT_APP_SETTINGS };
    }

    try {
      const row = result[0];
      if (!row) return { ...DEFAULT_APP_SETTINGS };
      const parsed = JSON.parse(row.value) as Partial<AppSettings>;
      return {
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
      };
    } catch {
      return { ...DEFAULT_APP_SETTINGS };
    }
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...partial,
    };

    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(settings)
      .values({
        key: SETTINGS_KEY,
        value: JSON.stringify(updated),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: JSON.stringify(updated),
          updatedAt: now,
        },
      })
      .run();

    return updated;
  }

  private saveDefaultSettings(): void {
    const db = this.dbService.getDb();
    db.insert(settings)
      .values({
        key: SETTINGS_KEY,
        value: JSON.stringify(DEFAULT_APP_SETTINGS),
        updatedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
  }
}
