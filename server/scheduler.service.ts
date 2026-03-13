/**
 * Scheduler Service
 * Kiểm tra lịch hẹn mỗi phút và tự động khởi động chiến dịch đúng giờ.
 */
import { getAllActiveSchedules, updateSchedule, getScheduleById } from "./db";
import { startCampaign } from "./campaign.runner";
import { createNotification } from "./db";
import type { Schedule } from "../drizzle/schema";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ─── Tính nextRunAt cho một lịch ─────────────────────────────────────────────

export function computeNextRunAt(schedule: Schedule): Date | null {
  const now = new Date();

  if (schedule.repeatType === "once") {
    if (!schedule.runDate) return null;
    const runDate = new Date(schedule.runDate);
    runDate.setHours(schedule.hour, schedule.minute, 0, 0);
    // Nếu đã qua rồi thì không chạy nữa
    return runDate > now ? runDate : null;
  }

  // Tính ngày tiếp theo phù hợp
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  // Nếu giờ hôm nay đã qua → sang ngày mai
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }

  if (schedule.repeatType === "daily") {
    return candidate;
  }

  if (schedule.repeatType === "weekdays") {
    // Tìm ngày làm việc tiếp theo (Mon-Fri)
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  if (schedule.repeatType === "weekends") {
    // Tìm ngày cuối tuần tiếp theo (Sat-Sun)
    while (candidate.getDay() !== 0 && candidate.getDay() !== 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  return null;
}

// ─── Kiểm tra và chạy lịch đến hạn ──────────────────────────────────────────

async function checkAndRunSchedules() {
  try {
    const activeSchedules = await getAllActiveSchedules();
    const now = new Date();

    for (const schedule of activeSchedules) {
      if (!schedule.nextRunAt) continue;

      const nextRun = new Date(schedule.nextRunAt);
      // Cho phép sai lệch 90 giây (1.5 lần interval)
      const diffMs = now.getTime() - nextRun.getTime();
      if (diffMs < 0 || diffMs > 90_000) continue;

      console.log(`[Scheduler] Kích hoạt lịch #${schedule.id} "${schedule.name}" cho chiến dịch #${schedule.campaignId}`);

      try {
        await startCampaign(schedule.campaignId, schedule.userId, schedule.safetyLevel);

        // Tính lần chạy tiếp theo
        const updatedSchedule = await getScheduleById(schedule.id, schedule.userId);
        const nextRunAt = updatedSchedule ? computeNextRunAt({ ...updatedSchedule, lastRunAt: now }) : null;

        await updateSchedule(schedule.id, schedule.userId, {
          lastRunAt: now,
          nextRunAt: nextRunAt ?? undefined,
          runCount: (schedule.runCount ?? 0) + 1,
          // Nếu là "once" thì tắt sau khi chạy
          isActive: schedule.repeatType !== "once" ? true : false,
        });

        // Gửi thông báo in-app
        await createNotification({
          userId: schedule.userId,
          campaignId: schedule.campaignId,
          title: "Lịch hẹn đã kích hoạt",
          content: `Lịch "${schedule.name}" đã tự động khởi động chiến dịch #${schedule.campaignId} lúc ${now.toLocaleTimeString("vi-VN")}.`,
          type: "success",
        });
      } catch (err) {
        console.error(`[Scheduler] Lỗi khi chạy lịch #${schedule.id}:`, err);

        await createNotification({
          userId: schedule.userId,
          campaignId: schedule.campaignId,
          title: "Lịch hẹn gặp lỗi",
          content: `Lịch "${schedule.name}" không thể khởi động chiến dịch: ${err instanceof Error ? err.message : "Lỗi không xác định"}`,
          type: "error",
        });

        // Vẫn tính nextRunAt để lần sau thử lại
        const nextRunAt = computeNextRunAt(schedule);
        await updateSchedule(schedule.id, schedule.userId, {
          lastRunAt: now,
          nextRunAt: nextRunAt ?? undefined,
        });
      }
    }
  } catch (err) {
    console.error("[Scheduler] Lỗi khi kiểm tra lịch:", err);
  }
}

// ─── Khởi động / dừng scheduler ──────────────────────────────────────────────

export function startScheduler() {
  if (schedulerInterval) return;
  console.log("[Scheduler] Đã khởi động, kiểm tra mỗi 60 giây");
  // Chạy ngay lần đầu sau 5 giây để tránh race condition khi server khởi động
  setTimeout(checkAndRunSchedules, 5000);
  schedulerInterval = setInterval(checkAndRunSchedules, 60_000);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Đã dừng");
  }
}
