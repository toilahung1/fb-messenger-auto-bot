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
  createSchedule,
  getSchedulesByUser,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
} from "./db";
import { computeNextRunAt } from "./scheduler.service";
import { startCampaign, stopCampaign, isCampaignRunning, assessCampaignRisk, SAFETY_PRESETS, getRiskInfo } from "./campaign.runner";
import { SAFETY_PRESETS as _SP, type SafetyLevel } from "./anti-checkpoint.service";
import { extractFacebookCookies } from "./puppeteer.service";
import { storagePut } from "./storage";
import { parse as csvParse } from "csv-parse/sync";
import { broadcastToUser } from "./ws.service";

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
    .input(z.object({
      id: z.number(),
      safetyLevel: z.enum(["low", "medium", "high", "extreme"]).default("medium"),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        await startCampaign(input.id, ctx.user.id, input.safetyLevel as SafetyLevel);
        return { success: true };
      } catch (e: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Lỗi khi bắt đầu chiến dịch",
        });
      }
    }),

  assess: protectedProcedure
    .input(z.object({
      id: z.number(),
      safetyLevel: z.enum(["low", "medium", "high", "extreme"]).default("medium"),
    }))
    .query(async ({ ctx, input }) => {
      const recipients = await import("./db").then(m => m.getRecipientsByCampaign(input.id));
      const pending = recipients.filter(r => r.status === "pending" || r.status === "failed");
      const config = SAFETY_PRESETS[input.safetyLevel as SafetyLevel];
      return assessCampaignRisk(pending.length, config, ctx.user.id);
    }),

  riskInfo: protectedProcedure
    .input(z.object({ safetyLevel: z.enum(["low", "medium", "high", "extreme"]).default("medium") }))
    .query(({ ctx, input }) => {
      const config = SAFETY_PRESETS[input.safetyLevel as SafetyLevel];
      return getRiskInfo(ctx.user.id, config);
    }),

  safetyPresets: publicProcedure.query(() => {
    return Object.entries(SAFETY_PRESETS).map(([level, cfg]) => ({
      level,
      label: level === "low" ? "Thấp (Nhanh)" : level === "medium" ? "Trung bình" : level === "high" ? "Cao (An toàn)" : "Cực cao (Tối đa)",
      description: level === "low" ? "2-5s delay, 60 tin/giờ - Nhanh nhưng rủi ro cao"
        : level === "medium" ? "5-12s delay, 30 tin/giờ - Cân bằng tốc độ và an toàn"
        : level === "high" ? "10-25s delay, 15 tin/giờ - An toàn, giả lập người dùng thật"
        : "20-60s delay, 8 tin/giờ - Bảo vệ tối đa, rủi ro checkpoint thấp nhất",
      ...cfg,
    }));
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

});

// Placeholder - extensionStatus query removed (no more extension)

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
});// ─── Schedules Router ────────────────────────────────────────────────────────────────
const schedulesRouter = router({
  list: protectedProcedure.query(({ ctx }) => getSchedulesByUser(ctx.user.id)),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      campaignId: z.number(),
      hour: z.number().min(0).max(23),
      minute: z.number().min(0).max(59).default(0),
      repeatType: z.enum(["once", "daily", "weekdays", "weekends"]),
      runDate: z.string().optional(), // ISO date string cho repeatType = once
      safetyLevel: z.enum(["low", "medium", "high", "extreme"]).default("medium"),
    }))
    .mutation(async ({ ctx, input }) => {
      const scheduleData = {
        userId: ctx.user.id,
        campaignId: input.campaignId,
        name: input.name,
        hour: input.hour,
        minute: input.minute,
        repeatType: input.repeatType,
        runDate: input.runDate ? new Date(input.runDate) : undefined,
        safetyLevel: input.safetyLevel,
        isActive: true,
        runCount: 0,
      };
      // Tính nextRunAt ngay khi tạo
      const nextRunAt = computeNextRunAt({
        ...scheduleData,
        id: 0,
        lastRunAt: null,
        nextRunAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        runDate: scheduleData.runDate ?? null,
      });
      const id = await createSchedule({ ...scheduleData, nextRunAt: nextRunAt ?? undefined });
      return { success: true, id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      hour: z.number().min(0).max(23).optional(),
      minute: z.number().min(0).max(59).optional(),
      repeatType: z.enum(["once", "daily", "weekdays", "weekends"]).optional(),
      runDate: z.string().optional(),
      safetyLevel: z.enum(["low", "medium", "high", "extreme"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, runDate, ...rest } = input;
      const existing = await getScheduleById(id, ctx.user.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy lịch" });
      const updateData = {
        ...rest,
        ...(runDate ? { runDate: new Date(runDate) } : {}),
      };
      // Tính lại nextRunAt
      const merged = { ...existing, ...updateData };
      const nextRunAt = computeNextRunAt(merged);
      await updateSchedule(id, ctx.user.id, { ...updateData, nextRunAt: nextRunAt ?? undefined });
      return { success: true };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getScheduleById(input.id, ctx.user.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy lịch" });
      let nextRunAt = existing.nextRunAt;
      if (input.isActive && !nextRunAt) {
        nextRunAt = computeNextRunAt(existing);
      }
      await updateSchedule(input.id, ctx.user.id, { isActive: input.isActive, nextRunAt: nextRunAt ?? undefined });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteSchedule(input.id, ctx.user.id);
      return { success: true };
    }),
});

// ─── Dashboard Router ────────────────────────────────────────────────────────────────
const dashboardRouter = router({
  stats: protectedProcedure.query(({ ctx }) => getDashboardStats(ctx.user.id)),
});
// --- App Router ---
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
  schedules: schedulesRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
