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

// Trạng thái các chiến dịch đang chạy (in-memory)
const runningCampaigns = new Map<number, { stop: boolean; userId: number }>();

export function isCampaignRunning(campaignId: number): boolean {
  return runningCampaigns.has(campaignId);
}

export async function stopCampaign(campaignId: number, userId: number): Promise<void> {
  const state = runningCampaigns.get(campaignId);
  if (state) {
    state.stop = true;
  }
}

export async function startCampaign(campaignId: number, userId: number): Promise<void> {
  if (runningCampaigns.has(campaignId)) {
    throw new Error("Chiến dịch đang chạy");
  }

  const campaign = await getCampaignById(campaignId, userId);
  if (!campaign) throw new Error("Không tìm thấy chiến dịch");

  const session = await getBotSession(userId);
  if (!session?.sessionData || !session.isActive) {
    throw new Error("Chưa có phiên đăng nhập Facebook. Vui lòng cấu hình session trước.");
  }

  // Đánh dấu đang chạy
  runningCampaigns.set(campaignId, { stop: false, userId });

  // Cập nhật trạng thái campaign
  await updateCampaign(campaignId, userId, {
    status: "running",
    startedAt: new Date(),
    sentCount: 0,
    failedCount: 0,
  });

  // Chạy bất đồng bộ
  runCampaignAsync(campaignId, userId, session.sessionData, campaign).catch(async (err) => {
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
  campaign: { name: string; messageTemplate: string; delayBetweenMessages: number; maxRetries: number }
) {
  const recipients = await getRecipientsByCampaign(campaignId);
  const pendingRecipients = recipients.filter((r) => r.status === "pending" || r.status === "failed");

  let sentCount = 0;
  let failedCount = 0;
  const logs: string[] = [`[${new Date().toISOString()}] Bắt đầu chiến dịch: ${campaign.name}`];
  logs.push(`Tổng người nhận cần gửi: ${pendingRecipients.length}`);

  for (const recipient of pendingRecipients) {
    const state = runningCampaigns.get(campaignId);
    if (!state || state.stop) {
      logs.push(`[${new Date().toISOString()}] Chiến dịch bị dừng thủ công`);
      break;
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

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await sendMessengerMessage(userId, {
        recipientName: recipient.name,
        facebookUrl: recipient.facebookUrl ?? recipient.facebookUid ?? undefined,
        message,
        sessionData,
      });

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
        logs.push(`[${new Date().toISOString()}] ✓ Gửi thành công: ${recipient.name} (lần ${attempt})`);
        break;
      } else {
        lastError = result.error ?? "Lỗi không xác định";
        logs.push(`[${new Date().toISOString()}] ✗ Thất bại: ${recipient.name} (lần ${attempt}): ${lastError}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * attempt)); // Exponential backoff
        }
      }
    }

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
    await updateCampaign(campaignId, userId, {
      sentCount,
      failedCount,
      successRate,
    });

    // Delay giữa các tin nhắn
    const state2 = runningCampaigns.get(campaignId);
    if (state2 && !state2.stop && pendingRecipients.indexOf(recipient) < pendingRecipients.length - 1) {
      await new Promise((r) => setTimeout(r, campaign.delayBetweenMessages));
    }
  }

  // Kết thúc chiến dịch
  const state = runningCampaigns.get(campaignId);
  const wasStopped = state?.stop ?? false;
  runningCampaigns.delete(campaignId);

  logs.push(`[${new Date().toISOString()}] Kết thúc chiến dịch`);
  logs.push(`Đã gửi: ${sentCount} | Thất bại: ${failedCount}`);

  const finalStatus = wasStopped ? "paused" : "completed";
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

  // Gửi thông báo
  const notifType = wasStopped ? "warning" : failedCount === 0 ? "success" : "info";
  const notifTitle = wasStopped
    ? `Chiến dịch đã dừng: ${campaign.name}`
    : `Chiến dịch hoàn thành: ${campaign.name}`;
  const notifContent = wasStopped
    ? `Chiến dịch đã bị dừng thủ công. Đã gửi: ${sentCount}, Thất bại: ${failedCount}.`
    : `Đã gửi thành công ${sentCount}/${sentCount + failedCount} tin nhắn. Tỷ lệ thành công: ${
        (sentCount + failedCount) > 0 ? Math.round((sentCount / (sentCount + failedCount)) * 100) : 0
      }%.`;

  await createNotification({ userId, campaignId, title: notifTitle, content: notifContent, type: notifType });

  // Đóng browser sau khi xong
  await closeBrowser();
}
