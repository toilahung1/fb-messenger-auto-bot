import {
  getCampaignById,
  getRecipientsByCampaign,
  updateCampaign,
  updateRecipientStatus,
  addMessageLog,
  createNotification,
  getBotSession,
  bulkAddRecipients,
} from "./db";
import {
  interpolateMessage,
  closeBrowser,
  openConversationAndSend,
  scanMessengerInbox,
  sendMessengerMessage,
} from "./puppeteer.service";
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
import {
  broadcastToUser,
  setRunningCampaign,
  updateCampaignProgress,
  clearRunningCampaign,
} from "./ws.service";

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
  const mode = (campaign as { mode?: string }).mode ?? "inbox_scan";
  const maxSendCount = (campaign as { maxSendCount?: number }).maxSendCount ?? 0;

  const runner = mode === "inbox_scan"
    ? runInboxScanCampaign(campaignId, userId, session.sessionData, campaign, config, maxSendCount)
    : runManualCampaign(campaignId, userId, session.sessionData, campaign, config);

  runner.catch(async (err) => {
    console.error(`[CampaignRunner] Campaign ${campaignId} crashed:`, err);
    runningCampaigns.delete(campaignId);
    clearRunningCampaign(userId);
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

// ─── Inbox Scan Mode: tự động quét inbox và gửi từng hội thoại ───────────────
async function runInboxScanCampaign(
  campaignId: number,
  userId: number,
  sessionData: string,
  campaign: { name: string; messageTemplate: string; delayBetweenMessages: number; maxRetries: number },
  config: AntiCheckpointConfig,
  maxSendCount: number // 0 = không giới hạn
) {
  let sentCount = 0;
  let failedCount = 0;
  let checkpointDetected = false;
  const logs: string[] = [
    `[${new Date().toISOString()}] ═══ BẮT ĐẦU CHIẾN DỊCH (INBOX SCAN): ${campaign.name} ═══`,
    `[${new Date().toISOString()}] Chế độ: TỰ ĐỘNG QUÉT INBOX`,
    `[${new Date().toISOString()}] Giới hạn gửi: ${maxSendCount === 0 ? "Không giới hạn" : maxSendCount + " người"}`,
    `[${new Date().toISOString()}] Chế độ bảo vệ: ${config.safetyLevel.toUpperCase()}`,
    `[${new Date().toISOString()}] Delay: ${config.minDelay}ms - ${config.maxDelay}ms`,
    `───────────────────────────────────────────────────────`,
  ];

  // Thông báo bắt đầu quét
  broadcastToUser(userId, "bot_log", { message: "Đang quét danh sách hội thoại trong inbox..." });
  broadcastToUser(userId, "bot_started", { campaignId });

  // Bước 1: Quét inbox để lấy danh sách hội thoại
  logs.push(`[${new Date().toISOString()}] 🔍 Đang quét inbox Messenger...`);
  const scanResult = await scanMessengerInbox(userId, sessionData, maxSendCount);

  if (scanResult.error) {
    logs.push(`[${new Date().toISOString()}] ❌ Lỗi quét inbox: ${scanResult.error}`);
    runningCampaigns.delete(campaignId);
    clearRunningCampaign(userId);
    await updateCampaign(campaignId, userId, { status: "failed" });
    await createNotification({
      userId,
      campaignId,
      title: "Lỗi quét inbox",
      content: scanResult.error,
      type: "error",
    });
    return;
  }

  const contacts = scanResult.contacts;
  logs.push(`[${new Date().toISOString()}] ✅ Tìm thấy ${contacts.length} hội thoại trong inbox`);
  broadcastToUser(userId, "bot_log", { message: `Tìm thấy ${contacts.length} hội thoại. Bắt đầu gửi tin nhắn...` });

  // Cập nhật tổng số người nhận
  await updateCampaign(campaignId, userId, { totalRecipients: contacts.length });
  setRunningCampaign(userId, campaignId, contacts.length);

  // Bước 2: Gửi tin nhắn cho từng hội thoại
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const state = runningCampaigns.get(campaignId);
    if (!state || state.stop) {
      logs.push(`[${new Date().toISOString()}] ⏹ Chiến dịch bị dừng thủ công`);
      break;
    }

    // Chờ nếu đang bị pause
    if (state.paused) {
      logs.push(`[${new Date().toISOString()}] ⏸ Đang tạm dừng: ${state.pauseReason}`);
      let waitedSeconds = 0;
      while (state.paused && waitedSeconds < 1800) {
        await sleep(10000);
        waitedSeconds += 10;
        const currentState = runningCampaigns.get(campaignId);
        if (!currentState || currentState.stop) break;
      }
      if (state.paused) {
        state.stop = true;
        logs.push(`[${new Date().toISOString()}] ⏹ Tự động dừng sau 30 phút tạm dừng`);
        break;
      }
      logs.push(`[${new Date().toISOString()}] ▶ Tiếp tục chiến dịch`);
    }

    // Kiểm tra rate limit
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
      if (rateCheck.waitMs) {
        await sleep(Math.min(rateCheck.waitMs, 3600000));
      }
      await resumeCampaign(campaignId);
    }

    // Tạo nội dung tin nhắn
    const now = new Date();
    const message = interpolateMessage(campaign.messageTemplate, {
      name: contact.name,
      firstName: contact.name.split(" ")[0] ?? contact.name,
      date: now.toLocaleDateString("vi-VN"),
      time: now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    });

    broadcastToUser(userId, "bot_log", {
      message: `[${i + 1}/${contacts.length}] Đang gửi đến: ${contact.name}`,
    });
    logs.push(`[${new Date().toISOString()}] 📤 [${i + 1}/${contacts.length}] Gửi đến: ${contact.name} (${contact.conversationUrl})`);

    let success = false;
    let lastError = "";
    const maxRetries = campaign.maxRetries;

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await openConversationAndSend(
        userId,
        contact.conversationUrl,
        message,
        sessionData,
        config
      );

      if (result.checkpointDetected) {
        checkpointDetected = true;
        recordCheckpoint(userId);
        logs.push(`[${new Date().toISOString()}] 🚨 CHECKPOINT PHÁT HIỆN! Dừng chiến dịch`);
        await pauseCampaign(campaignId, "Phát hiện checkpoint Facebook");
        await createNotification({
          userId,
          campaignId,
          title: "🚨 Phát hiện Checkpoint Facebook!",
          content: `Bot đã dừng khẩn cấp sau ${sentCount} tin nhắn. Facebook yêu cầu xác minh bảo mật.`,
          type: "error",
        });
        await addMessageLog({
          campaignId,
          recipientId: 0,
          userId,
          recipientName: contact.name,
          messageContent: message,
          status: "failed",
          errorMessage: "Checkpoint Facebook detected",
          attemptNumber: attempt,
          sentAt: new Date(),
        });
        const currentState = runningCampaigns.get(campaignId);
        if (currentState) currentState.stop = true;
        break;
      }

      await addMessageLog({
        campaignId,
        recipientId: 0,
        userId,
        recipientName: contact.name,
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
          `[${new Date().toISOString()}] ✓ Gửi thành công: ${contact.name} | ` +
          `Đã gửi giờ này: ${riskInfo.sentThisHour}/${riskInfo.maxPerHour} | Risk: ${riskInfo.riskScore}%`
        );
        break;
      } else {
        lastError = result.error ?? "Lỗi không xác định";
        logs.push(`[${new Date().toISOString()}] ✗ Thất bại: ${contact.name} (lần ${attempt}): ${lastError}`);
        if (attempt < maxRetries) {
          await sleep(2000 * attempt + Math.random() * 1000);
        }
      }
    }

    if (checkpointDetected) break;

    if (success) {
      sentCount++;
    } else {
      failedCount++;
    }

    // Cập nhật tiến độ
    const total = sentCount + failedCount;
    const successRate = total > 0 ? (sentCount / total) * 100 : 0;
    await updateCampaign(campaignId, userId, { sentCount, failedCount, successRate });
    updateCampaignProgress(userId, i + 1);

    // Delay trước tin tiếp theo
    const currentState = runningCampaigns.get(campaignId);
    if (currentState && !currentState.stop && i < contacts.length - 1) {
      const smartDelay = calculateDelay(config, i, userId);
      logs.push(`[${new Date().toISOString()}] ⏱ Chờ ${(smartDelay / 1000).toFixed(1)}s...`);
      await sleep(smartDelay);
    }
  }

  await finalizeCampaign(campaignId, userId, campaign.name, sentCount, failedCount, checkpointDetected, logs);
}

// ─── Manual Mode: dùng danh sách recipients thủ công ─────────────────────────
async function runManualCampaign(
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
    `[${new Date().toISOString()}] ═══ BẮT ĐẦU CHIẾN DỊCH (MANUAL): ${campaign.name} ═══`,
    `[${new Date().toISOString()}] Chế độ: DANH SÁCH THỦ CÔNG`,
    `[${new Date().toISOString()}] Tổng người nhận: ${pendingRecipients.length}`,
    `[${new Date().toISOString()}] Chế độ bảo vệ: ${config.safetyLevel.toUpperCase()}`,
    `───────────────────────────────────────────────────────`,
  ];

  broadcastToUser(userId, "bot_started", { campaignId });
  setRunningCampaign(userId, campaignId, pendingRecipients.length);

  for (let i = 0; i < pendingRecipients.length; i++) {
    const recipient = pendingRecipients[i];
    const state = runningCampaigns.get(campaignId);
    if (!state || state.stop) {
      logs.push(`[${new Date().toISOString()}] ⏹ Chiến dịch bị dừng thủ công`);
      break;
    }

    if (state.paused) {
      logs.push(`[${new Date().toISOString()}] ⏸ Đang tạm dừng: ${state.pauseReason}`);
      let waitedSeconds = 0;
      while (state.paused && waitedSeconds < 1800) {
        await sleep(10000);
        waitedSeconds += 10;
        const currentState = runningCampaigns.get(campaignId);
        if (!currentState || currentState.stop) break;
      }
      if (state.paused) {
        state.stop = true;
        break;
      }
    }

    const rateCheck = checkRateLimit(userId, config);
    if (!rateCheck.allowed) {
      await pauseCampaign(campaignId, rateCheck.reason ?? "Rate limit");
      if (rateCheck.waitMs) await sleep(Math.min(rateCheck.waitMs, 3600000));
      await resumeCampaign(campaignId);
    }

    await updateRecipientStatus(recipient.id, "sending");

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

    for (let attempt = 1; attempt <= campaign.maxRetries; attempt++) {
      const result = await sendMessengerMessage(userId, {
        recipientName: recipient.name,
        facebookUrl: recipient.facebookUrl ?? recipient.facebookUid ?? undefined,
        message,
        sessionData,
        antiCheckpointConfig: config,
        messageIndex: i,
      });

      if (result.checkpointDetected) {
        checkpointDetected = true;
        recordCheckpoint(userId);
        await pauseCampaign(campaignId, "Phát hiện checkpoint Facebook");
        await createNotification({
          userId,
          campaignId,
          title: "🚨 Phát hiện Checkpoint Facebook!",
          content: `Bot dừng sau ${sentCount} tin nhắn. Facebook yêu cầu xác minh.`,
          type: "error",
        });
        await addMessageLog({
          campaignId,
          recipientId: recipient.id,
          userId,
          recipientName: recipient.name,
          messageContent: message,
          status: "failed",
          errorMessage: "Checkpoint detected",
          attemptNumber: attempt,
          sentAt: new Date(),
        });
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
        status: result.success ? "success" : attempt < campaign.maxRetries ? "retry" : "failed",
        errorMessage: result.error,
        attemptNumber: attempt,
        sentAt: new Date(),
      });

      if (result.success) {
        success = true;
        recordMessageSent(userId);
        break;
      } else {
        lastError = result.error ?? "Lỗi không xác định";
        if (attempt < campaign.maxRetries) await sleep(2000 * attempt);
      }
    }

    if (checkpointDetected) break;

    if (success) {
      sentCount++;
      await updateRecipientStatus(recipient.id, "sent", { sentAt: new Date() });
    } else {
      failedCount++;
      await updateRecipientStatus(recipient.id, "failed", {
        errorMessage: lastError,
        retryCount: campaign.maxRetries,
      });
    }

    const total = sentCount + failedCount;
    const successRate = total > 0 ? (sentCount / total) * 100 : 0;
    await updateCampaign(campaignId, userId, { sentCount, failedCount, successRate });
    updateCampaignProgress(userId, i + 1);

    const currentState = runningCampaigns.get(campaignId);
    if (currentState && !currentState.stop && i < pendingRecipients.length - 1) {
      const smartDelay = calculateDelay(config, i, userId);
      await sleep(smartDelay);
    }
  }

  await finalizeCampaign(campaignId, userId, campaign.name, sentCount, failedCount, checkpointDetected, logs);
}

// ─── Finalize: kết thúc campaign, lưu log, gửi thông báo ─────────────────────
async function finalizeCampaign(
  campaignId: number,
  userId: number,
  campaignName: string,
  sentCount: number,
  failedCount: number,
  checkpointDetected: boolean,
  logs: string[]
) {
  const state = runningCampaigns.get(campaignId);
  const wasStopped = state?.stop ?? false;
  runningCampaigns.delete(campaignId);
  clearRunningCampaign(userId);
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

  // Thông báo tổng kết
  let notifType: "success" | "warning" | "error" | "info" = "info";
  let notifTitle = "";
  let notifContent = "";

  if (checkpointDetected) {
    notifType = "error";
    notifTitle = `🚨 Checkpoint phát hiện: ${campaignName}`;
    notifContent = `Bot dừng khẩn cấp sau ${sentCount} tin. Facebook yêu cầu xác minh. Hãy kiểm tra tài khoản.`;
  } else if (wasStopped) {
    notifType = "warning";
    notifTitle = `⏹ Chiến dịch đã dừng: ${campaignName}`;
    notifContent = `Đã gửi: ${sentCount}, Thất bại: ${failedCount}.`;
  } else {
    notifType = failedCount === 0 ? "success" : "info";
    notifTitle = `✅ Chiến dịch hoàn thành: ${campaignName}`;
    notifContent = `Đã gửi ${sentCount}/${sentCount + failedCount} tin. Tỷ lệ thành công: ${
      (sentCount + failedCount) > 0 ? Math.round((sentCount / (sentCount + failedCount)) * 100) : 0
    }%.`;
  }

  await createNotification({ userId, campaignId, title: notifTitle, content: notifContent, type: notifType });

  broadcastToUser(userId, "bot_stopped", {
    campaignId,
    sentCount,
    failedCount,
    reason: checkpointDetected ? "checkpoint" : wasStopped ? "manual" : "completed",
  });

  await closeBrowser();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export để dùng trong routers
export { assessCampaignRisk, SAFETY_PRESETS, getRiskInfo };
