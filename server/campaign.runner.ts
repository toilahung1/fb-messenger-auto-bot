import {
  getCampaignById,
  getRecipientsByCampaign,
  updateCampaign,
  updateRecipientStatus,
  addMessageLog,
  createNotification,
  getBotSession,
} from "./db";
import { sendMessengerMessage, interpolateMessage, closeBrowser } from "./puppeteer.service";
import { storagePut } from "./storage";
import {
  SAFETY_PRESETS,
  type AntiCheckpointConfig,
  type SafetyLevel,
  calculateDelay,
  checkRateLimit,
  recordMessageSent,
  recordCheckpoint,
  resetConsecutive,
  getRiskInfo,
  assessCampaignRisk,
} from "./anti-checkpoint.service";

// Trạng thái các chiến dịch đang chạy (in-memory)
const runningCampaigns = new Map<number, {
  stop: boolean;
  userId: number;
  paused: boolean;
  pauseReason?: string;
  safetyLevel: SafetyLevel;
}>();

export function isCampaignRunning(campaignId: number): boolean {
  return runningCampaigns.has(campaignId);
}

export function getCampaignRunState(campaignId: number) {
  return runningCampaigns.get(campaignId) ?? null;
}

export async function stopCampaign(campaignId: number, _userId: number): Promise<void> {
  const state = runningCampaigns.get(campaignId);
  if (state) state.stop = true;
}

export async function pauseCampaign(campaignId: number, reason: string): Promise<void> {
  const state = runningCampaigns.get(campaignId);
  if (state) {
    state.paused = true;
    state.pauseReason = reason;
  }
}

export async function resumeCampaign(campaignId: number): Promise<void> {
  const state = runningCampaigns.get(campaignId);
  if (state) {
    state.paused = false;
    state.pauseReason = undefined;
  }
}

export async function startCampaign(
  campaignId: number,
  userId: number,
  safetyLevel: SafetyLevel = "medium"
): Promise<void> {
  if (runningCampaigns.has(campaignId)) {
    throw new Error("Chiến dịch đang chạy");
  }

  const campaign = await getCampaignById(campaignId, userId);
  if (!campaign) throw new Error("Không tìm thấy chiến dịch");

  const session = await getBotSession(userId);
  if (!session?.sessionData || !session.isActive) {
    throw new Error("Chưa có phiên đăng nhập Facebook. Vui lòng cấu hình session trước.");
  }

  const config = SAFETY_PRESETS[safetyLevel];

  // Kiểm tra rate limit trước khi bắt đầu
  const rateCheck = checkRateLimit(userId, config);
  if (!rateCheck.allowed) {
    throw new Error(rateCheck.reason ?? "Vượt giới hạn gửi tin nhắn");
  }

  // Đánh dấu đang chạy
  runningCampaigns.set(campaignId, { stop: false, userId, paused: false, safetyLevel });

  // Cập nhật trạng thái campaign
  await updateCampaign(campaignId, userId, {
    status: "running",
    startedAt: new Date(),
    sentCount: 0,
    failedCount: 0,
  });

  // Chạy bất đồng bộ
  runCampaignAsync(campaignId, userId, session.sessionData, campaign, config).catch(async (err) => {
    console.error(`[CampaignRunner] Campaign ${campaignId} crashed:`, err);
    runningCampaigns.delete(campaignId);
    await updateCampaign(campaignId, userId, { status: "failed" });
    await createNotification({
      userId,
      campaignId,
      title: "Chiến dịch gặp lỗi nghiêm trọng",
      content: `Chiến dịch "${campaign.name}" đã dừng do lỗi: ${err.message}`,
      type: "error",
    });
  });
}

async function runCampaignAsync(
  campaignId: number,
  userId: number,
  sessionData: string,
  campaign: { name: string; messageTemplate: string; delayBetweenMessages: number; maxRetries: number },
  config: AntiCheckpointConfig
) {
  const recipients = await getRecipientsByCampaign(campaignId);
  const pendingRecipients = recipients.filter((r) => r.status === "pending" || r.status === "failed");

  let sentCount = 0;
  let failedCount = 0;
  let checkpointDetected = false;
  const logs: string[] = [
    `[${new Date().toISOString()}] ═══ BẮT ĐẦU CHIẾN DỊCH: ${campaign.name} ═══`,
    `[${new Date().toISOString()}] Chế độ bảo vệ: ${config.safetyLevel.toUpperCase()}`,
    `[${new Date().toISOString()}] Giới hạn: ${config.maxMessagesPerHour} tin/giờ, ${config.maxMessagesPerDay} tin/ngày`,
    `[${new Date().toISOString()}] Delay: ${config.minDelay}ms - ${config.maxDelay}ms`,
    `[${new Date().toISOString()}] Nghỉ ngơi: mỗi ${config.breakAfterMessages} tin, ${config.breakDurationMin}-${config.breakDurationMax}s`,
    `[${new Date().toISOString()}] Tổng người nhận cần gửi: ${pendingRecipients.length}`,
    `───────────────────────────────────────────────────────`,
  ];

  for (let i = 0; i < pendingRecipients.length; i++) {
    const recipient = pendingRecipients[i];
    const state = runningCampaigns.get(campaignId);
    if (!state || state.stop) {
      logs.push(`[${new Date().toISOString()}] ⏹ Chiến dịch bị dừng thủ công`);
      break;
    }

    // Chờ nếu đang bị pause (do checkpoint hoặc rate limit)
    if (state.paused) {
      logs.push(`[${new Date().toISOString()}] ⏸ Đang tạm dừng: ${state.pauseReason}`);
      // Chờ tối đa 30 phút, kiểm tra mỗi 10 giây
      let waitedSeconds = 0;
      while (state.paused && waitedSeconds < 1800) {
        await sleep(10000);
        waitedSeconds += 10;
        const currentState = runningCampaigns.get(campaignId);
        if (!currentState || currentState.stop) break;
      }
      if (state.paused) {
        // Vẫn còn pause sau 30 phút → dừng hẳn
        state.stop = true;
        logs.push(`[${new Date().toISOString()}] ⏹ Tự động dừng sau 30 phút tạm dừng`);
        break;
      }
      logs.push(`[${new Date().toISOString()}] ▶ Tiếp tục chiến dịch`);
    }

    // Kiểm tra rate limit trước mỗi tin
    const rateCheck = checkRateLimit(userId, config);
    if (!rateCheck.allowed) {
      logs.push(`[${new Date().toISOString()}] ⏸ Rate limit: ${rateCheck.reason}`);
      await pauseCampaign(campaignId, rateCheck.reason ?? "Rate limit");
      await createNotification({
        userId,
        campaignId,
        title: "Bot tạm dừng - Giới hạn tốc độ",
        content: rateCheck.reason ?? "Đã đạt giới hạn gửi tin nhắn",
        type: "warning",
      });
      // Chờ đúng thời gian cần thiết
      if (rateCheck.waitMs) {
        await sleep(Math.min(rateCheck.waitMs, 3600000)); // tối đa 1 giờ
      }
      await resumeCampaign(campaignId);
    }

    // Đánh dấu đang gửi
    await updateRecipientStatus(recipient.id, "sending");

    // Thay thế biến động trong tin nhắn
    const now = new Date();
    const message = interpolateMessage(campaign.messageTemplate, {
      name: recipient.name,
      firstName: recipient.name.split(" ")[0] ?? recipient.name,
      date: now.toLocaleDateString("vi-VN"),
      time: now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      ...(recipient.extraData as Record<string, string> ?? {}),
    });

    let success = false;
    let lastError = "";
    const maxRetries = campaign.maxRetries;

    // Retry loop với anti-checkpoint
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await sendMessengerMessage(userId, {
        recipientName: recipient.name,
        facebookUrl: recipient.facebookUrl ?? recipient.facebookUid ?? undefined,
        message,
        sessionData,
        antiCheckpointConfig: config,
        messageIndex: i,
      });

      // Kiểm tra nếu kết quả là checkpoint
      if (result.checkpointDetected) {
        checkpointDetected = true;
        recordCheckpoint(userId);
        logs.push(`[${new Date().toISOString()}] 🚨 CHECKPOINT PHÁT HIỆN! Dừng chiến dịch ngay lập tức`);

        await pauseCampaign(campaignId, "Phát hiện checkpoint Facebook");
        await createNotification({
          userId,
          campaignId,
          title: "🚨 Phát hiện Checkpoint Facebook!",
          content: `Bot đã dừng khẩn cấp sau ${sentCount} tin nhắn. Facebook yêu cầu xác minh bảo mật. Vui lòng kiểm tra tài khoản và cập nhật session.`,
          type: "error",
        });

        await addMessageLog({
          campaignId,
          recipientId: recipient.id,
          userId,
          recipientName: recipient.name,
          messageContent: message,
          status: "failed",
          errorMessage: "Checkpoint Facebook detected - campaign paused",
          attemptNumber: attempt,
          sentAt: new Date(),
        });

        // Dừng hẳn campaign
        const currentState = runningCampaigns.get(campaignId);
        if (currentState) currentState.stop = true;
        break;
      }

      await addMessageLog({
        campaignId,
        recipientId: recipient.id,
        userId,
        recipientName: recipient.name,
        messageContent: message,
        status: result.success ? "success" : attempt < maxRetries ? "retry" : "failed",
        errorMessage: result.error,
        attemptNumber: attempt,
        sentAt: new Date(),
      });

      if (result.success) {
        success = true;
        recordMessageSent(userId);
        const riskInfo = getRiskInfo(userId, config);
        logs.push(
          `[${new Date().toISOString()}] ✓ Gửi thành công: ${recipient.name} (lần ${attempt}) | ` +
          `Đã gửi giờ này: ${riskInfo.sentThisHour}/${riskInfo.maxPerHour} | Risk: ${riskInfo.riskScore}%`
        );
        break;
      } else {
        lastError = result.error ?? "Lỗi không xác định";
        logs.push(`[${new Date().toISOString()}] ✗ Thất bại: ${recipient.name} (lần ${attempt}): ${lastError}`);
        if (attempt < maxRetries) {
          // Exponential backoff với jitter
          const backoffMs = 2000 * attempt + Math.random() * 1000;
          await sleep(backoffMs);
        }
      }
    }

    // Nếu phát hiện checkpoint, dừng vòng lặp
    if (checkpointDetected) break;

    if (success) {
      sentCount++;
      await updateRecipientStatus(recipient.id, "sent", { sentAt: new Date() });
    } else {
      failedCount++;
      await updateRecipientStatus(recipient.id, "failed", {
        errorMessage: lastError,
        retryCount: maxRetries,
      });
    }

    // Cập nhật tiến độ campaign
    const total = sentCount + failedCount;
    const successRate = total > 0 ? (sentCount / total) * 100 : 0;
    await updateCampaign(campaignId, userId, { sentCount, failedCount, successRate });

    // Tính delay thông minh cho tin tiếp theo
    const currentState = runningCampaigns.get(campaignId);
    if (currentState && !currentState.stop && i < pendingRecipients.length - 1) {
      const smartDelay = calculateDelay(config, i, userId);
      logs.push(`[${new Date().toISOString()}] ⏱ Chờ ${(smartDelay / 1000).toFixed(1)}s trước tin tiếp theo...`);
      await sleep(smartDelay);
    }
  }

  // Kết thúc chiến dịch
  const state = runningCampaigns.get(campaignId);
  const wasStopped = state?.stop ?? false;
  runningCampaigns.delete(campaignId);
  resetConsecutive(userId);

  logs.push(`───────────────────────────────────────────────────────`);
  logs.push(`[${new Date().toISOString()}] ═══ KẾT THÚC CHIẾN DỊCH ═══`);
  logs.push(`Đã gửi: ${sentCount} | Thất bại: ${failedCount} | Checkpoint: ${checkpointDetected ? "CÓ" : "KHÔNG"}`);

  const finalStatus = checkpointDetected ? "failed" : wasStopped ? "paused" : "completed";
  await updateCampaign(campaignId, userId, {
    status: finalStatus,
    completedAt: new Date(),
    sentCount,
    failedCount,
    successRate: (sentCount + failedCount) > 0 ? (sentCount / (sentCount + failedCount)) * 100 : 0,
  });

  // Lưu log lên S3
  try {
    const logContent = logs.join("\n");
    const logKey = `campaign-logs/${userId}/${campaignId}-${Date.now()}.txt`;
    const { url: logUrl } = await storagePut(logKey, Buffer.from(logContent, "utf-8"), "text/plain");
    await updateCampaign(campaignId, userId, { logFileUrl: logUrl, logFileKey: logKey });
  } catch (e) {
    console.warn("[CampaignRunner] Failed to upload log:", e);
  }

  // Gửi thông báo tổng kết
  let notifType: "success" | "warning" | "error" | "info" = "info";
  let notifTitle = "";
  let notifContent = "";

  if (checkpointDetected) {
    notifType = "error";
    notifTitle = `🚨 Checkpoint phát hiện: ${campaign.name}`;
    notifContent = `Bot dừng khẩn cấp sau ${sentCount} tin. Facebook yêu cầu xác minh. Hãy kiểm tra tài khoản và cập nhật session.`;
  } else if (wasStopped) {
    notifType = "warning";
    notifTitle = `⏹ Chiến dịch đã dừng: ${campaign.name}`;
    notifContent = `Đã gửi: ${sentCount}, Thất bại: ${failedCount}.`;
  } else {
    notifType = failedCount === 0 ? "success" : "info";
    notifTitle = `✅ Chiến dịch hoàn thành: ${campaign.name}`;
    notifContent = `Đã gửi ${sentCount}/${sentCount + failedCount} tin. Tỷ lệ thành công: ${
      (sentCount + failedCount) > 0 ? Math.round((sentCount / (sentCount + failedCount)) * 100) : 0
    }%.`;
  }

  await createNotification({ userId, campaignId, title: notifTitle, content: notifContent, type: notifType });
  await closeBrowser();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export để dùng trong routers
export { assessCampaignRisk, SAFETY_PRESETS, getRiskInfo };
