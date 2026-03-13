import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  boolean,
  float,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Chiến dịch gửi tin nhắn
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  messageTemplate: text("messageTemplate").notNull(),
  status: mysqlEnum("status", ["draft", "running", "paused", "completed", "failed"])
    .default("draft")
    .notNull(),
  delayBetweenMessages: int("delayBetweenMessages").default(3000).notNull(), // ms
  maxRetries: int("maxRetries").default(3).notNull(),
  totalRecipients: int("totalRecipients").default(0).notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  failedCount: int("failedCount").default(0).notNull(),
  successRate: float("successRate").default(0),
  csvFileUrl: text("csvFileUrl"),
  csvFileKey: text("csvFileKey"),
  logFileUrl: text("logFileUrl"),
  logFileKey: text("logFileKey"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

// Người nhận tin nhắn
export const recipients = mysqlTable("recipients", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  facebookUid: varchar("facebookUid", { length: 128 }),
  facebookUrl: text("facebookUrl"),
  phone: varchar("phone", { length: 32 }),
  extraData: json("extraData"), // Dữ liệu bổ sung từ CSV
  status: mysqlEnum("status", ["pending", "sending", "sent", "failed", "skipped"])
    .default("pending")
    .notNull(),
  retryCount: int("retryCount").default(0).notNull(),
  errorMessage: text("errorMessage"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Recipient = typeof recipients.$inferSelect;
export type InsertRecipient = typeof recipients.$inferInsert;

// Lịch sử gửi tin nhắn
export const messageLogs = mysqlTable("message_logs", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  recipientId: int("recipientId").notNull(),
  userId: int("userId").notNull(),
  recipientName: varchar("recipientName", { length: 255 }),
  messageContent: text("messageContent"),
  status: mysqlEnum("status", ["success", "failed", "retry"]).notNull(),
  errorMessage: text("errorMessage"),
  attemptNumber: int("attemptNumber").default(1).notNull(),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});

export type MessageLog = typeof messageLogs.$inferSelect;
export type InsertMessageLog = typeof messageLogs.$inferInsert;

// Phiên đăng nhập Facebook (lưu cookies)
export const botSessions = mysqlTable("bot_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  sessionData: text("sessionData"), // JSON cookies
  extensionToken: varchar("extensionToken", { length: 128 }), // Token để extension xác thực
  isActive: boolean("isActive").default(false).notNull(),
  lastVerified: timestamp("lastVerified"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BotSession = typeof botSessions.$inferSelect;
export type InsertBotSession = typeof botSessions.$inferInsert;

// Thông báo in-app
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId"),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  type: mysqlEnum("type", ["info", "success", "warning", "error"]).default("info").notNull(),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
