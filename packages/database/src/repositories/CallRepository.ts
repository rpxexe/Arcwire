import { eq, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { DatabaseService } from '../connection';
import { calls } from '../schema/index';
import type { CallItem, CallStatus, CallType } from '@ipm/shared';

export class CallRepository {
  constructor(private dbService: DatabaseService) {}

  public createCall(data: {
    id?: string;
    conversationId: string;
    callerDeviceId: string;
    receiverDeviceId: string;
    callType: CallType;
    status?: CallStatus;
    startedAt?: number;
  }): CallItem {
    const db = this.dbService.getDb();
    const id = data.id || crypto.randomUUID();
    const startedAt = data.startedAt || Date.now();
    const status = data.status || 'ringing';

    const newCall = {
      id,
      conversationId: data.conversationId,
      callerDeviceId: data.callerDeviceId,
      receiverDeviceId: data.receiverDeviceId,
      callType: data.callType,
      status,
      startedAt,
      endedAt: null,
      durationSeconds: 0,
    };

    db.insert(calls).values(newCall).run();
    return newCall as CallItem;
  }

  public getCallById(id: string): CallItem | null {
    const db = this.dbService.getDb();
    const result = db.select().from(calls).where(eq(calls.id, id)).get();
    if (!result) return null;

    return {
      id: result.id,
      conversationId: result.conversationId,
      callerDeviceId: result.callerDeviceId,
      receiverDeviceId: result.receiverDeviceId,
      callType: result.callType as CallType,
      status: result.status as CallStatus,
      startedAt: result.startedAt,
      endedAt: result.endedAt ?? null,
      durationSeconds: result.durationSeconds ?? 0,
    };
  }

  public updateCallStatus(
    id: string,
    status: CallStatus,
    endedAt?: number,
    durationSeconds?: number
  ): CallItem | null {
    const db = this.dbService.getDb();
    const existing = this.getCallById(id);
    if (!existing) return null;

    const valuesToUpdate: Partial<typeof calls.$inferInsert> = { status };
    if (endedAt !== undefined) {
      valuesToUpdate.endedAt = endedAt;
    }
    if (durationSeconds !== undefined) {
      valuesToUpdate.durationSeconds = durationSeconds;
    }

    db.update(calls).set(valuesToUpdate).where(eq(calls.id, id)).run();
    return this.getCallById(id);
  }

  public endCall(id: string, status: CallStatus = 'completed'): CallItem | null {
    const existing = this.getCallById(id);
    if (!existing) return null;

    const endedAt = Date.now();
    const durationSeconds = Math.max(0, Math.round((endedAt - existing.startedAt) / 1000));

    return this.updateCallStatus(id, status, endedAt, durationSeconds);
  }

  public listCalls(conversationId?: string, limit: number = 50): CallItem[] {
    const db = this.dbService.getDb();
    let query = db.select().from(calls);

    let rows: (typeof calls.$inferSelect)[];
    if (conversationId) {
      rows = query
        .where(eq(calls.conversationId, conversationId))
        .orderBy(desc(calls.startedAt))
        .limit(limit)
        .all();
    } else {
      rows = query.orderBy(desc(calls.startedAt)).limit(limit).all();
    }

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      callerDeviceId: r.callerDeviceId,
      receiverDeviceId: r.receiverDeviceId,
      callType: r.callType as CallType,
      status: r.status as CallStatus,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      durationSeconds: r.durationSeconds ?? 0,
    }));
  }
}

