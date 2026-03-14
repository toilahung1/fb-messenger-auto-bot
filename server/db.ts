import { eq, desc, and, sql, count, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  campaigns,
  recipients,
  messageLogs,
  botSessions,
  notifications,
  schedules,
  type Campaign,
  type InsertCampaign,
  type Recipient,
  type InsertRecipient,
  type InsertMessageLog,
  type InsertBotSession,
  type InsertNotification,
  type InsertSchedule,
  type Schedule,
  localUsers,
  type LocalUser,
  type InsertLocalUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function createCampaign(data: InsertCampaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(campaigns).values(data);
  const insertId = (result as unknown as { insertId: number }[])[0]?.insertId ?? 0;
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, insertId)).limit(1);
  return rows[0];
}

export async function getCampaignsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns).where(eq(campaigns.userId, userId)).orderBy(desc(campaigns.createdAt));
}

export async function getCampaignById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function updateCampaign(id: number, userId: number, data: Partial<Campaign>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(campaigns)
    .set(data)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
}

export async function deleteCampaign(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Xóa recipients và logs trước
  const recipientRows = await db.select({ id: recipients.id }).from(recipients).where(eq(recipients.campaignId, id));
  if (recipientRows.length > 0) {
    const ids = recipientRows.map((r) => r.id);
    await db.delete(messageLogs).where(inArray(messageLogs.recipientId, ids));
  }
  await db.delete(recipients).where(eq(recipients.campaignId, id));
  await db.delete(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
}

// ─── Recipients ──────────────────────────────────────────────────────────────

export async function addRecipient(data: InsertRecipient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(recipients).values(data);
  const insertId = (result as unknown as { insertId: number }[])[0]?.insertId ?? 0;
  const rows = await db.select().from(recipients).where(eq(recipients.id, insertId)).limit(1);
  return rows[0];
}

export async function bulkAddRecipients(data: InsertRecipient[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(recipients).values(data);
}

export async function getRecipientsByCampaign(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recipients).where(eq(recipients.campaignId, campaignId)).orderBy(recipients.id);
}

export async function updateRecipientStatus(
  id: number,
  status: Recipient["status"],
  extra?: { errorMessage?: string; sentAt?: Date; retryCount?: number }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(recipients)
    .set({ status, ...extra })
    .where(eq(recipients.id, id));
}

export async function deleteRecipient(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messageLogs).where(eq(messageLogs.recipientId, id));
  await db.delete(recipients).where(and(eq(recipients.id, id), eq(recipients.userId, userId)));
}

export async function resetCampaignRecipients(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(recipients)
    .set({ status: "pending", retryCount: 0, errorMessage: null, sentAt: null })
    .where(eq(recipients.campaignId, campaignId));
}

// ─── Message Logs ─────────────────────────────────────────────────────────────

export async function addMessageLog(data: InsertMessageLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(messageLogs).values(data);
}

export async function getMessageLogsByCampaign(campaignId: number, limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messageLogs)
    .where(eq(messageLogs.campaignId, campaignId))
    .orderBy(desc(messageLogs.sentAt))
    .limit(limit);
}

export async function getMessageLogsByUser(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messageLogs)
    .where(eq(messageLogs.userId, userId))
    .orderBy(desc(messageLogs.sentAt))
    .limit(limit);
}

// ─── Bot Sessions ─────────────────────────────────────────────────────────────

export async function upsertBotSession(data: InsertBotSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(botSessions)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        sessionData: data.sessionData,
        isActive: data.isActive,
        lastVerified: data.lastVerified,
      },
    });
}

export async function getBotSession(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(botSessions).where(eq(botSessions.userId, userId)).limit(1);
  return rows[0];
}

export async function deleteBotSession(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(botSessions).where(eq(botSessions.userId, userId));
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(notifications).values(data);
}

export async function getNotificationsByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ cnt: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return rows[0]?.cnt ?? 0;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [campaignStats] = await db
    .select({
      total: count(),
      running: sql<number>`SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)`,
      completed: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(campaigns)
    .where(eq(campaigns.userId, userId));

  const [msgStats] = await db
    .select({
      totalSent: sql<number>`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
      totalFailed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(messageLogs)
    .where(eq(messageLogs.userId, userId));

  return {
    campaigns: {
      total: Number(campaignStats?.total ?? 0),
      running: Number(campaignStats?.running ?? 0),
      completed: Number(campaignStats?.completed ?? 0),
      failed: Number(campaignStats?.failed ?? 0),
    },
    messages: {
      totalSent: Number(msgStats?.totalSent ?? 0),
      totalFailed: Number(msgStats?.totalFailed ?? 0),
    },
  };
}

// ─── Schedules ────────────────────────────────────────────────────────────────

export async function createSchedule(data: InsertSchedule): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(schedules).values(data);
  return (result as { insertId: number }).insertId;
}

export async function getSchedulesByUser(userId: number): Promise<Schedule[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(schedules).where(eq(schedules.userId, userId)).orderBy(desc(schedules.createdAt));
}

export async function getScheduleById(id: number, userId: number): Promise<Schedule | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.userId, userId))).limit(1);
  return result[0];
}

export async function updateSchedule(id: number, userId: number, data: Partial<InsertSchedule>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(schedules).set(data).where(and(eq(schedules.id, id), eq(schedules.userId, userId)));
}

export async function deleteSchedule(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.userId, userId)));
}

export async function getAllActiveSchedules(): Promise<Schedule[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(schedules).where(eq(schedules.isActive, true));
}

// ─── Local Users (Railway deployment - no Manus OAuth) ───────────────────────

export async function createLocalUser(data: InsertLocalUser): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(localUsers).values(data);
}

export async function getLocalUserByUsername(username: string): Promise<LocalUser | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(localUsers).where(eq(localUsers.username, username)).limit(1);
  return result[0];
}

export async function getLocalUserById(id: number): Promise<LocalUser | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(localUsers).where(eq(localUsers.id, id)).limit(1);
  return result[0];
}
