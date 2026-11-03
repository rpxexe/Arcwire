import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { DIRECTORY_NAMES } from '@ipm/shared';

export interface AppDirectoryPaths {
  appData: string;
  data: string;
  attachments: string;
  transfers: string;
  avatars: string;
  logs: string;
  backups: string;
  security: string;
  databaseFile: string;
}

export class AppPaths {
  private static paths: AppDirectoryPaths | null = null;

  public static get(): AppDirectoryPaths {
    if (this.paths) return this.paths;

    const baseDir = path.join(app.getPath('appData'), 'IPMessenger');
    const paths: AppDirectoryPaths = {
      appData: baseDir,
      data: path.join(baseDir, DIRECTORY_NAMES.DATA),
      attachments: path.join(baseDir, DIRECTORY_NAMES.ATTACHMENTS),
      transfers: path.join(baseDir, DIRECTORY_NAMES.TRANSFERS),
      avatars: path.join(baseDir, DIRECTORY_NAMES.AVATARS),
      logs: path.join(baseDir, DIRECTORY_NAMES.LOGS),
      backups: path.join(baseDir, DIRECTORY_NAMES.BACKUPS),
      security: path.join(baseDir, DIRECTORY_NAMES.SECURITY),
      databaseFile: path.join(baseDir, DIRECTORY_NAMES.DATA, 'ipm.db'),
    };

    // Ensure all directories exist
    Object.entries(paths).forEach(([key, dirPath]) => {
      if (key !== 'databaseFile' && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });

    this.paths = paths;
    return paths;
  }
}
