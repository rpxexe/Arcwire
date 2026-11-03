import fs from 'node:fs';
import path from 'node:path';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index';

export interface DatabaseConfig {
  dbPath: string;
}

export class DatabaseService {
  private static instance: DatabaseService | null = null;
  private db: BetterSQLite3Database<typeof schema>;
  private sqlite: any;

  private constructor(config: DatabaseConfig) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite = require('better-sqlite3');
      const dbInstance = new BetterSqlite(config.dbPath);
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('synchronous = NORMAL');
      dbInstance.pragma('foreign_keys = ON');
      dbInstance.pragma('busy_timeout = 5000');
      this.sqlite = dbInstance;
    } catch {
      // Fallback for host environments (e.g. Node 24 test runner vs Electron Node 20 ABI)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      const syncDb = new DatabaseSync(config.dbPath);
      syncDb.exec('PRAGMA journal_mode = WAL;');
      syncDb.exec('PRAGMA synchronous = NORMAL;');
      syncDb.exec('PRAGMA foreign_keys = ON;');

      this.sqlite = {
        prepare(sql: string) {
          const s = syncDb.prepare(sql);
          let isRaw = false;
          return {
            all(...args: any[]) {
              if (isRaw) s.setReturnArrays(true);
              return s.all(...args);
            },
            get(...args: any[]) {
              if (isRaw) s.setReturnArrays(true);
              return s.get(...args);
            },
            run(...args: any[]) {
              return s.run(...args);
            },
            raw(enable = true) {
              isRaw = enable !== false;
              return this;
            },
            columns() {
              return s.columns();
            },
          };
        },
        exec(sql: string) {
          return syncDb.exec(sql);
        },
        pragma(sql: string, opts?: { simple?: boolean }) {
          if (opts && opts.simple) return 'wal';
          return syncDb.exec('PRAGMA ' + sql);
        },
        transaction(fn: any) {
          return (...args: any[]) => {
            syncDb.exec('BEGIN TRANSACTION');
            try {
              const res = fn(...args);
              syncDb.exec('COMMIT');
              return res;
            } catch (e) {
              syncDb.exec('ROLLBACK');
              throw e;
            }
          };
        },
        close() {
          return syncDb.close();
        },
      };
    }

    this.initTables();
    this.db = drizzle(this.sqlite, { schema });
  }

  public static initialize(config: DatabaseConfig): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService(config);
    }
    return DatabaseService.instance;
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      throw new Error('DatabaseService has not been initialized. Call initialize() first.');
    }
    return DatabaseService.instance;
  }

  public getDb(): BetterSQLite3Database<typeof schema> {
    return this.db;
  }

  public getRawSqlite(): any {
    return this.sqlite;
  }

  public close(): void {
    if (this.sqlite && typeof this.sqlite.close === 'function') {
      this.sqlite.close();
    }
    DatabaseService.instance = null;
  }

  private initTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar_url TEXT,
        status TEXT NOT NULL DEFAULT 'online',
        custom_status TEXT,
        os_username TEXT NOT NULL,
        computer_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        hostname TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'offline',
        is_blocked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_addresses (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL,
        tcp_port INTEGER NOT NULL DEFAULT 45821,
        signaling_port INTEGER NOT NULL DEFAULT 45822,
        interface_name TEXT,
        is_reachable INTEGER NOT NULL DEFAULT 1,
        last_connected_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_device_addresses_dev ON device_addresses(device_id);

      CREATE TABLE IF NOT EXISTS trusted_devices (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        verification_state TEXT NOT NULL DEFAULT 'unverified',
        verified_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT,
        last_message_id TEXT,
        last_activity_at INTEGER NOT NULL,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_activity ON conversations(last_activity_at);

      CREATE TABLE IF NOT EXISTS conversation_members (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        UNIQUE(conversation_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text',
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        sent_at INTEGER NOT NULL,
        delivered_at INTEGER,
        read_at INTEGER,
        is_encrypted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(delivery_status);

      CREATE TABLE IF NOT EXISTS message_receipts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        receipt_type TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        UNIQUE(message_id, device_id, receipt_type)
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        host_device_id TEXT NOT NULL REFERENCES devices(id),
        is_host INTEGER NOT NULL DEFAULT 0,
        avatar_url TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id),
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS private_conversations (
        id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        creator_device_id TEXT NOT NULL,
        session_key_hash TEXT NOT NULL,
        is_locked INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS private_members (
        id TEXT PRIMARY KEY,
        private_conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id),
        approved_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS private_credentials (
        id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        recovery_hint TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        private_conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
        creator_device_id TEXT NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        local_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        remote_device_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        temp_path TEXT NOT NULL,
        final_path TEXT,
        bytes_transferred INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'offered',
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shared_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL,
        default_permission TEXT NOT NULL DEFAULT 'read_only',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS folder_permissions (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        permission_level TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        UNIQUE(folder_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        caller_device_id TEXT NOT NULL,
        receiver_device_id TEXT NOT NULL,
        call_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_seconds INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}
