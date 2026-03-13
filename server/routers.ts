import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createCampaign,
  getCampaignsByUserId,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  addRecipient,
  bulkAddRecipients,
  getRecipientsByCampaign,
  deleteRecipient,
  resetCampaignRecipients,
  getMessageLogsByCampaign,
  getMessageLogsByUser,
  upsertBotSession,
  getBotSession,
  deleteBotSession,
  getNotificationsByUser,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  getDashboardStats,
} from "./db";
import { startCampaign, stopCampaign, isCampaignRunning } from "./campaign.runner";
import { extractFacebookCookies } from "./puppeteer.service";
import { storagePut } from "./storage";
import { parse as csvParse } from "csv-parse/sync";
import { getExtensionStatus, sendCommandToExtension } from "./ws.service";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { botSessions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Campaign Router ──────────────────────────────────────────────────────────
const campaignRouter = router({
  list: protectedProcedure.query(({ ctx }) => getCampaignsByUserId(ctx.user.id)),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const c = await getCampaignById(input.id, ctx.user.id);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy chiến dịch" });
      return { ...c, isRunning: isCampaignRunning(c.id) };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        messageTemplate: z.string().min(1),
        delayBetweenMessages: z.number().min(1000).max(60000).default(3000),
        maxRetries: z.number().min(1).max(5).default(3),
      })
    )
    .mutation(({ ctx, input }) =>
      createCampaign({ ...input, userId: ctx.user.id, status: "draft" })
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        messageTemplate: z.string().min(1).optional(),
        delayBetweenMessages: z.number().min(1000).max(60000).optional(),
        maxRetries: z.number().min(1).max(5).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await updateCampaign(id, ctx.user.id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (isCampaignRunning(input.id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Không thể xóa chiến dịch đang chạy" });
      }
      await deleteCampaign(input.id, ctx.user.id);
      return { success: true };
    }),

  start: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await startCampaign(input.id, ctx.user.id);
        return { success: true };
      } catch (e: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Lỗi khi bắt đầu chiến dịch",
        });
      }
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await stopCampaign(input.id, ctx.user.id);
      return { success: true };
    }),

  resetRecipients: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (isCampaignRunning(input.id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Không thể reset khi chiến dịch đang chạy" });
      }
      await resetCampaignRecipients(input.id);
      await updateCampaign(input.id, ctx.user.id, { status: "draft", sentCount: 0, failedCount: 0, successRate: 0 });
      return { success: true };
    }),
});

// ─── Recipients Router ────────────────────────────────────────────────────────
const recipientRouter = router({
  list: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(({ input }) => getRecipientsByCampaign(input.campaignId)),

  add: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        name: z.string().min(1),
        facebookUid: z.string().optional(),
        facebookUrl: z.string().optional(),
        phone: z.string().optional(),
        extraData: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const recipient = await addRecipient({ ...input, userId: ctx.user.id, status: "pending" });
      const all = await getRecipientsByCampaign(input.campaignId);
      await updateCampaign(input.campaignId, ctx.user.id, { totalRecipients: all.length });
      return recipient;
    }),

  importCsv: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        csvContent: z.string(),
        fileName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const csvBuffer = Buffer.from(input.csvContent, "base64");
      const csvText = csvBuffer.toString("utf-8");

      let records: Record<string, string>[];
      try {
        records = csvParse(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Record<string, string>[];
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File CSV không hợp lệ" });
      }

      if (records.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File CSV không có dữ liệu" });
      }

      const toInsert = records.map((row) => {
        const name =
          row["name"] || row["Name"] || row["tên"] || row["Tên"] ||
          row["full_name"] || row["fullname"] || "";
        const facebookUrl =
          row["facebook_url"] || row["FacebookUrl"] || row["url"] || row["URL"] || row["link"] || "";
        const facebookUid =
          row["facebook_uid"] || row["FacebookUid"] || row["uid"] || row["UID"] || "";
        const phone = row["phone"] || row["Phone"] || row["sdt"] || row["SDT"] || "";

        const extraData: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (!["name", "Name", "tên", "Tên", "full_name", "fullname",
                "facebook_url", "FacebookUrl", "url", "URL", "link",
                "facebook_uid", "FacebookUid", "uid", "UID",
                "phone", "Phone", "sdt", "SDT"].includes(k)) {
            extraData[k] = v;
          }
        }

        return {
          campaignId: input.campaignId,
          userId: ctx.user.id,
          name: name || "Không tên",
          facebookUrl: facebookUrl || undefined,
          facebookUid: facebookUid || undefined,
          phone: phone || undefined,
          extraData: Object.keys(extraData).length > 0 ? extraData : undefined,
          status: "pending" as const,
        };
      });

      await bulkAddRecipients(toInsert);

      try {
        const fileKey = `csv-imports/${ctx.user.id}/${input.campaignId}-${Date.now()}-${input.fileName}`;
        const { url: csvFileUrl } = await storagePut(fileKey, csvBuffer, "text/csv");
        await updateCampaign(input.campaignId, ctx.user.id, {
          csvFileUrl,
          csvFileKey: fileKey,
          totalRecipients: (await getRecipientsByCampaign(input.campaignId)).length,
        });
      } catch (e) {
        console.warn("[importCsv] Failed to upload CSV:", e);
      }

      return { success: true, imported: toInsert.length };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number(), campaignId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteRecipient(input.id, ctx.user.id);
      const all = await getRecipientsByCampaign(input.campaignId);
      await updateCampaign(input.campaignId, ctx.user.id, { totalRecipients: all.length });
      return { success: true };
    }),
});

// ─── Logs Router ──────────────────────────────────────────────────────────────
const logsRouter = router({
  byCampaign: protectedProcedure
    .input(z.object({ campaignId: z.number(), limit: z.number().optional() }))
    .query(({ input }) => getMessageLogsByCampaign(input.campaignId, input.limit)),

  byUser: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(({ ctx, input }) => getMessageLogsByUser(ctx.user.id, input.limit)),
});

// ─── Bot Session & Extension Router ──────────────────────────────────────────
const botSessionRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const session = await getBotSession(ctx.user.id);
    if (!session) return null;
    return {
      isActive: session.isActive,
      lastVerified: session.lastVerified,
      extensionToken: session.extensionToken,
    };
  }),

  save: protectedProcedure
    .input(z.object({ sessionData: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await upsertBotSession({
        userId: ctx.user.id,
        sessionData: input.sessionData,
        isActive: true,
        lastVerified: new Date(),
      });
      return { success: true };
    }),

  delete: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteBotSession(ctx.user.id);
    return { success: true };
  }),

  // Tạo hoặc lấy extension token để kết nối với Chrome Extension
  getExtensionToken: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    let session = await getBotSession(ctx.user.id);
    if (!session) {
      await upsertBotSession({ userId: ctx.user.id, isActive: false });
      session = await getBotSession(ctx.user.id);
    }

    if (!session?.extensionToken) {
      const token = nanoid(32);
      await db.update(botSessions)
        .set({ extensionToken: token })
        .where(eq(botSessions.userId, ctx.user.id));
      return { token };
    }
    return { token: session.extensionToken };
  }),

  // Lấy trạng thái kết nối của extension
  extensionStatus: protectedProcedure.query(async ({ ctx }) => {
    const session = await getBotSession(ctx.user.id);
    if (!session?.extensionToken) {
      return { connected: false, streaming: false, botRunning: false, campaign: null };
    }
    return getExtensionStatus(session.extensionToken);
  }),

  // Gửi lệnh tới extension
  sendCommand: protectedProcedure
    .input(z.object({
      action: z.enum(["start_stream", "stop_stream", "stop_bot"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await getBotSession(ctx.user.id);
      if (!session?.extensionToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Chưa có extension token" });
      }
      const sent = sendCommandToExtension(session.extensionToken, input.action);
      if (!sent) throw new TRPCError({ code: "BAD_REQUEST", message: "Extension chưa kết nối" });
      return { success: true };
    }),

  // Tự động lấy cookies từ URL Facebook
  extractCookies: protectedProcedure
    .input(z.object({ url: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await extractFacebookCookies(ctx.user.id, input.url);
      if (!result.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error || "Không thể lấy cookies",
        });
      }
      // Tự động lưu cookies vào database nếu thành công
      if (result.cookies) {
        await upsertBotSession({
          userId: ctx.user.id,
          sessionData: result.cookies,
          isActive: true,
          lastVerified: new Date(),
        });
      }
      return {
        success: true,
        cookieCount: result.cookieCount,
        message: `Đã lấy thành công ${result.cookieCount} cookies và lưu vào hệ thống`,
      };
    }),

  // Bắt đầu chiến dịch qua extension
  startBotCampaign: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await getBotSession(ctx.user.id);
      if (!session?.extensionToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Chưa kết nối extension" });
      }

      const campaign = await getCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy chiến dịch" });

      const allRecipients = await getRecipientsByCampaign(input.campaignId);
      const pendingRecipients = allRecipients.filter(
        (r) => r.status === "pending" || r.status === "failed"
      );

      if (pendingRecipients.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Không có người nhận nào cần gửi" });
      }

      const sent = sendCommandToExtension(session.extensionToken, "start_bot", {
        campaignId: campaign.id,
        recipients: pendingRecipients.map((r) => ({
          id: r.id,
          name: r.name,
          facebookUrl: r.facebookUrl,
          facebookUid: r.facebookUid,
        })),
        messageTemplate: campaign.messageTemplate,
        delay: campaign.delayBetweenMessages,
        maxRetries: campaign.maxRetries,
        total: pendingRecipients.length,
      });

      if (!sent) throw new TRPCError({ code: "BAD_REQUEST", message: "Extension chưa kết nối" });

      await updateCampaign(input.campaignId, ctx.user.id, {
        status: "running",
        startedAt: new Date(),
      });
      return { success: true, total: pendingRecipients.length };
    }),
});

// ─── Notifications Router ─────────────────────────────────────────────────────
const notificationsRouter = router({
  list: protectedProcedure.query(({ ctx }) => getNotificationsByUser(ctx.user.id)),

  unreadCount: protectedProcedure.query(({ ctx }) => getUnreadNotificationCount(ctx.user.id)),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markNotificationRead(input.id, ctx.user.id);
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllNotificationsRead(ctx.user.id);
    return { success: true };
  }),
});

// ─── Dashboard Router ─────────────────────────────────────────────────────────
const dashboardRouter = router({
  stats: protectedProcedure.query(({ ctx }) => getDashboardStats(ctx.user.id)),
});

// ─── App Router ───────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  campaigns: campaignRouter,
  recipients: recipientRouter,
  logs: logsRouter,
  botSession: botSessionRouter,
  notifications: notificationsRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
