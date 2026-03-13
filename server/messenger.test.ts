import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { COOKIE_NAME } from "../shared/const";

// Mock database helpers
vi.mock("./db", () => ({
  getCampaignsByUserId: vi.fn().mockResolvedValue([]),
  getCampaignById: vi.fn().mockResolvedValue(null),
  createCampaign: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    name: "Test Campaign",
    description: null,
    messageTemplate: "Hello {{name}}",
    status: "draft",
    delayBetweenMessages: 3000,
    maxRetries: 3,
    totalRecipients: 0,
    sentCount: 0,
    failedCount: 0,
    successRate: 0,
    csvFileUrl: null,
    csvFileKey: null,
    logFileUrl: null,
    logFileKey: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  updateCampaign: vi.fn().mockResolvedValue(undefined),
  deleteCampaign: vi.fn().mockResolvedValue(undefined),
  addRecipient: vi.fn().mockResolvedValue({
    id: 1,
    campaignId: 1,
    userId: 1,
    name: "Nguyen Van A",
    facebookUid: null,
    facebookUrl: null,
    phone: null,
    extraData: null,
    status: "pending",
    retryCount: 0,
    errorMessage: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  bulkAddRecipients: vi.fn().mockResolvedValue(undefined),
  getRecipientsByCampaign: vi.fn().mockResolvedValue([]),
  updateRecipientStatus: vi.fn().mockResolvedValue(undefined),
  deleteRecipient: vi.fn().mockResolvedValue(undefined),
  resetCampaignRecipients: vi.fn().mockResolvedValue(undefined),
  getMessageLogsByCampaign: vi.fn().mockResolvedValue([]),
  getMessageLogsByUser: vi.fn().mockResolvedValue([]),
  upsertBotSession: vi.fn().mockResolvedValue(undefined),
  getBotSession: vi.fn().mockResolvedValue(null),
  deleteBotSession: vi.fn().mockResolvedValue(undefined),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  getDashboardStats: vi.fn().mockResolvedValue({
    campaigns: { total: 0, running: 0, completed: 0, failed: 0 },
    messages: { totalSent: 0, totalFailed: 0 },
  }),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
  addMessageLog: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./campaign.runner", () => ({
  startCampaign: vi.fn().mockResolvedValue(undefined),
  stopCampaign: vi.fn().mockResolvedValue(undefined),
  isCampaignRunning: vi.fn().mockReturnValue(false),
}));

vi.mock("./puppeteer.service", () => ({
  verifyFacebookSession: vi.fn().mockResolvedValue(false),
  sendMessengerMessage: vi.fn().mockResolvedValue({ success: true }),
  interpolateMessage: vi.fn().mockImplementation((t: string) => t),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "https://cdn.example.com/test" }),
  storageGet: vi.fn().mockResolvedValue({ key: "test-key", url: "https://cdn.example.com/test" }),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-openid",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
}

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });

  it("auth.me returns current user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user?.name).toBe("Test User");
    expect(user?.email).toBe("test@example.com");
  });
});

describe("campaigns", () => {
  it("list returns empty array when no campaigns", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.campaigns.list();
    expect(result).toEqual([]);
  });

  it("create campaign with valid data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.campaigns.create({
      name: "Test Campaign",
      messageTemplate: "Hello {{name}}",
      delayBetweenMessages: 3000,
      maxRetries: 3,
    });
    expect(result).toBeDefined();
    expect(result?.name).toBe("Test Campaign");
  });

  it("get campaign returns null for non-existent id", async () => {
    const { getCampaignById } = await import("./db");
    vi.mocked(getCampaignById).mockResolvedValueOnce(undefined);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.campaigns.get({ id: 999 })).rejects.toThrow("Không tìm thấy chiến dịch");
  });

  it("delete running campaign throws error", async () => {
    const { isCampaignRunning } = await import("./campaign.runner");
    vi.mocked(isCampaignRunning).mockReturnValueOnce(true);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.campaigns.delete({ id: 1 })).rejects.toThrow("Không thể xóa chiến dịch đang chạy");
  });
});

describe("recipients", () => {
  it("list returns empty array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.recipients.list({ campaignId: 1 });
    expect(result).toEqual([]);
  });

  it("add recipient with valid data", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.recipients.add({
      campaignId: 1,
      name: "Nguyen Van A",
      facebookUrl: "https://www.messenger.com/t/nguyen.van.a",
    });
    expect(result).toBeDefined();
    expect(result?.name).toBe("Nguyen Van A");
  });

  it("import CSV with valid data", async () => {
    const csvContent = "name,facebook_url\nNguyen Van A,https://messenger.com/t/test";
    const base64 = btoa(csvContent);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.recipients.importCsv({
      campaignId: 1,
      csvContent: base64,
      fileName: "test.csv",
    });
    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
  });

  it("import invalid CSV throws error", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.recipients.importCsv({
        campaignId: 1,
        csvContent: btoa("invalid\x00csv\x00content"),
        fileName: "bad.csv",
      })
    ).rejects.toThrow();
  });
});

describe("notifications", () => {
  it("list returns empty array", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notifications.list();
    expect(result).toEqual([]);
  });

  it("unreadCount returns 0", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notifications.unreadCount();
    expect(result).toBe(0);
  });
});

describe("dashboard", () => {
  it("stats returns valid structure", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.stats();
    expect(result).toBeDefined();
    expect(result?.campaigns).toBeDefined();
    expect(result?.messages).toBeDefined();
  });
});

describe("interpolateMessage", () => {
  it("replaces variables correctly", async () => {
    const { interpolateMessage } = await import("./puppeteer.service");
    vi.mocked(interpolateMessage).mockImplementation((template: string, data: Record<string, string>) => {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
    });
    const result = interpolateMessage("Hello {{name}}, today is {{date}}", {
      name: "Nguyen Van A",
      date: "13/03/2026",
    });
    expect(result).toBe("Hello Nguyen Van A, today is 13/03/2026");
  });

  it("keeps unknown variables as-is", async () => {
    const { interpolateMessage } = await import("./puppeteer.service");
    vi.mocked(interpolateMessage).mockImplementation((template: string, data: Record<string, string>) => {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
    });
    const result = interpolateMessage("Hello {{name}} {{unknown}}", { name: "Test" });
    expect(result).toBe("Hello Test {{unknown}}");
  });
});
