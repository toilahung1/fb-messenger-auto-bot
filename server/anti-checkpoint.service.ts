/**
 * Anti-Checkpoint Engine
 * Hệ thống bảo vệ chống checkpoint Facebook khi gửi tin nhắn hàng loạt.
 *
 * Các lớp bảo vệ:
 * 1. Human-like behavior: random delay, typing simulation, mouse movement
 * 2. Smart Rate Limiter: giới hạn số tin/giờ, nghỉ ngơi tự động
 * 3. Warm-up mode: tăng dần tốc độ gửi
 * 4. Checkpoint detection: phát hiện và xử lý tự động
 * 5. Session health monitoring: kiểm tra session định kỳ
 * 6. Fingerprint protection: random viewport, user-agent rotation
 */

import type { Page } from "puppeteer";

// ─── Cấu hình mức độ bảo vệ ──────────────────────────────────────────────────

export type SafetyLevel = "low" | "medium" | "high" | "extreme";

export interface AntiCheckpointConfig {
  safetyLevel: SafetyLevel;
  // Delay giữa các tin nhắn (ms) - min và max để random
  minDelay: number;
  maxDelay: number;
  // Số tin nhắn tối đa mỗi giờ
  maxMessagesPerHour: number;
  // Số tin nhắn tối đa mỗi ngày
  maxMessagesPerDay: number;
  // Nghỉ ngơi sau N tin nhắn (giây)
  breakAfterMessages: number;
  breakDurationMin: number; // giây
  breakDurationMax: number; // giây
  // Warm-up: số tin nhắn đầu tiên gửi chậm hơn
  warmupMessages: number;
  warmupMultiplier: number; // nhân delay lên bao nhiêu lần trong warm-up
  // Bật/tắt các tính năng
  enableHumanTyping: boolean;
  enableMouseMovement: boolean;
  enableRandomScrolling: boolean;
  enableFingerprintProtection: boolean;
  // Retry khi bị checkpoint
  pauseOnCheckpoint: boolean;
  autoResumeAfterMinutes: number; // 0 = không tự resume
}

export const SAFETY_PRESETS: Record<SafetyLevel, AntiCheckpointConfig> = {
  low: {
    safetyLevel: "low",
    minDelay: 2000,
    maxDelay: 5000,
    maxMessagesPerHour: 60,
    maxMessagesPerDay: 300,
    breakAfterMessages: 30,
    breakDurationMin: 30,
    breakDurationMax: 60,
    warmupMessages: 5,
    warmupMultiplier: 1.5,
    enableHumanTyping: false,
    enableMouseMovement: false,
    enableRandomScrolling: false,
    enableFingerprintProtection: false,
    pauseOnCheckpoint: true,
    autoResumeAfterMinutes: 0,
  },
  medium: {
    safetyLevel: "medium",
    minDelay: 5000,
    maxDelay: 12000,
    maxMessagesPerHour: 30,
    maxMessagesPerDay: 150,
    breakAfterMessages: 15,
    breakDurationMin: 60,
    breakDurationMax: 180,
    warmupMessages: 10,
    warmupMultiplier: 2,
    enableHumanTyping: true,
    enableMouseMovement: false,
    enableRandomScrolling: true,
    enableFingerprintProtection: false,
    pauseOnCheckpoint: true,
    autoResumeAfterMinutes: 0,
  },
  high: {
    safetyLevel: "high",
    minDelay: 10000,
    maxDelay: 25000,
    maxMessagesPerHour: 15,
    maxMessagesPerDay: 80,
    breakAfterMessages: 8,
    breakDurationMin: 120,
    breakDurationMax: 300,
    warmupMessages: 15,
    warmupMultiplier: 3,
    enableHumanTyping: true,
    enableMouseMovement: true,
    enableRandomScrolling: true,
    enableFingerprintProtection: true,
    pauseOnCheckpoint: true,
    autoResumeAfterMinutes: 0,
  },
  extreme: {
    safetyLevel: "extreme",
    minDelay: 20000,
    maxDelay: 60000,
    maxMessagesPerHour: 8,
    maxMessagesPerDay: 40,
    breakAfterMessages: 5,
    breakDurationMin: 300,
    breakDurationMax: 600,
    warmupMessages: 20,
    warmupMultiplier: 4,
    enableHumanTyping: true,
    enableMouseMovement: true,
    enableRandomScrolling: true,
    enableFingerprintProtection: true,
    pauseOnCheckpoint: true,
    autoResumeAfterMinutes: 0,
  },
};

// ─── Rate Limiter per user ────────────────────────────────────────────────────

interface RateLimiterState {
  sentThisHour: number;
  sentToday: number;
  hourWindowStart: number;
  dayWindowStart: number;
  consecutiveSent: number;
  lastSentAt: number;
  checkpointCount: number;
  lastCheckpointAt: number | null;
}

const rateLimiters = new Map<number, RateLimiterState>();

function getRateLimiter(userId: number): RateLimiterState {
  if (!rateLimiters.has(userId)) {
    rateLimiters.set(userId, {
      sentThisHour: 0,
      sentToday: 0,
      hourWindowStart: Date.now(),
      dayWindowStart: Date.now(),
      consecutiveSent: 0,
      lastSentAt: 0,
      checkpointCount: 0,
      lastCheckpointAt: null,
    });
  }
  const state = rateLimiters.get(userId)!;

  // Reset hourly window
  if (Date.now() - state.hourWindowStart > 60 * 60 * 1000) {
    state.sentThisHour = 0;
    state.hourWindowStart = Date.now();
  }
  // Reset daily window
  if (Date.now() - state.dayWindowStart > 24 * 60 * 60 * 1000) {
    state.sentToday = 0;
    state.dayWindowStart = Date.now();
  }

  return state;
}

export function recordMessageSent(userId: number): void {
  const state = getRateLimiter(userId);
  state.sentThisHour++;
  state.sentToday++;
  state.consecutiveSent++;
  state.lastSentAt = Date.now();
}

export function recordCheckpoint(userId: number): void {
  const state = getRateLimiter(userId);
  state.checkpointCount++;
  state.lastCheckpointAt = Date.now();
  state.consecutiveSent = 0; // reset consecutive count
}

export function resetConsecutive(userId: number): void {
  const state = getRateLimiter(userId);
  state.consecutiveSent = 0;
}

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  waitMs?: number;
  riskScore: number; // 0-100
}

export function checkRateLimit(userId: number, config: AntiCheckpointConfig): RateLimitCheck {
  const state = getRateLimiter(userId);
  let riskScore = 0;

  // Kiểm tra hourly limit
  if (state.sentThisHour >= config.maxMessagesPerHour) {
    const waitMs = 60 * 60 * 1000 - (Date.now() - state.hourWindowStart);
    return {
      allowed: false,
      reason: `Đã đạt giới hạn ${config.maxMessagesPerHour} tin/giờ. Chờ ${Math.ceil(waitMs / 60000)} phút.`,
      waitMs,
      riskScore: 90,
    };
  }

  // Kiểm tra daily limit
  if (state.sentToday >= config.maxMessagesPerDay) {
    const waitMs = 24 * 60 * 60 * 1000 - (Date.now() - state.dayWindowStart);
    return {
      allowed: false,
      reason: `Đã đạt giới hạn ${config.maxMessagesPerDay} tin/ngày. Chờ ${Math.ceil(waitMs / 3600000)} giờ.`,
      waitMs,
      riskScore: 95,
    };
  }

  // Kiểm tra break time
  if (state.consecutiveSent > 0 && state.consecutiveSent % config.breakAfterMessages === 0) {
    const breakMs = randomBetween(config.breakDurationMin * 1000, config.breakDurationMax * 1000);
    const timeSinceLastSent = Date.now() - state.lastSentAt;
    if (timeSinceLastSent < breakMs) {
      const waitMs = breakMs - timeSinceLastSent;
      return {
        allowed: false,
        reason: `Nghỉ ngơi sau ${config.breakAfterMessages} tin liên tiếp. Tiếp tục sau ${Math.ceil(waitMs / 1000)}s.`,
        waitMs,
        riskScore: 30,
      };
    }
  }

  // Tính risk score
  const hourlyRatio = state.sentThisHour / config.maxMessagesPerHour;
  const dailyRatio = state.sentToday / config.maxMessagesPerDay;
  riskScore = Math.round(Math.max(hourlyRatio, dailyRatio) * 70);

  // Tăng risk nếu có checkpoint gần đây
  if (state.lastCheckpointAt) {
    const hoursSinceCheckpoint = (Date.now() - state.lastCheckpointAt) / (1000 * 60 * 60);
    if (hoursSinceCheckpoint < 24) {
      riskScore = Math.min(100, riskScore + 30);
    }
  }

  // Tăng risk nếu checkpoint nhiều lần
  if (state.checkpointCount > 0) {
    riskScore = Math.min(100, riskScore + state.checkpointCount * 10);
  }

  return { allowed: true, riskScore };
}

export function getRiskInfo(userId: number, config: AntiCheckpointConfig) {
  const state = getRateLimiter(userId);
  const check = checkRateLimit(userId, config);
  return {
    sentThisHour: state.sentThisHour,
    sentToday: state.sentToday,
    maxPerHour: config.maxMessagesPerHour,
    maxPerDay: config.maxMessagesPerDay,
    consecutiveSent: state.consecutiveSent,
    checkpointCount: state.checkpointCount,
    lastCheckpointAt: state.lastCheckpointAt,
    riskScore: check.riskScore,
    riskLevel: check.riskScore < 30 ? "safe" : check.riskScore < 60 ? "caution" : check.riskScore < 80 ? "warning" : "danger",
  };
}

// ─── Smart Delay Calculator ───────────────────────────────────────────────────

export function calculateDelay(
  config: AntiCheckpointConfig,
  messageIndex: number,
  userId: number
): number {
  let baseMin = config.minDelay;
  let baseMax = config.maxDelay;

  // Warm-up: tin đầu tiên gửi chậm hơn
  if (messageIndex < config.warmupMessages) {
    const warmupFactor = config.warmupMultiplier * (1 - messageIndex / config.warmupMessages);
    baseMin = Math.round(baseMin * (1 + warmupFactor));
    baseMax = Math.round(baseMax * (1 + warmupFactor));
  }

  // Thêm jitter ngẫu nhiên ±20% để tránh pattern đều đặn
  const jitter = 0.2;
  const jitterMin = Math.round(baseMin * (1 - jitter));
  const jitterMax = Math.round(baseMax * (1 + jitter));

  // Thỉnh thoảng (10%) thêm delay dài hơn để giả lập đọc/suy nghĩ
  if (Math.random() < 0.1) {
    return randomBetween(jitterMax, jitterMax * 2);
  }

  return randomBetween(jitterMin, jitterMax);
}

// ─── Human-like Behavior Simulation ──────────────────────────────────────────

export async function simulateHumanTyping(page: Page, text: string): Promise<void> {
  for (const char of text) {
    // Random delay giữa các ký tự (30-150ms) giả lập tốc độ gõ người thật
    const charDelay = randomBetween(30, 150);

    // Thỉnh thoảng (5%) gõ nhầm và xóa đi
    if (Math.random() < 0.05 && text.length > 3) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomBetween(-2, 2));
      await page.keyboard.type(wrongChar, { delay: charDelay });
      await sleep(randomBetween(100, 300));
      await page.keyboard.press("Backspace");
      await sleep(randomBetween(50, 150));
    }

    await page.keyboard.type(char, { delay: charDelay });

    // Thỉnh thoảng (3%) dừng lại lâu hơn giả lập suy nghĩ
    if (Math.random() < 0.03) {
      await sleep(randomBetween(500, 1500));
    }
  }
}

export async function simulateMouseMovement(page: Page): Promise<void> {
  try {
    const viewport = page.viewport() || { width: 1280, height: 800 };
    const moves = randomBetween(3, 8);

    for (let i = 0; i < moves; i++) {
      const x = randomBetween(100, viewport.width - 100);
      const y = randomBetween(100, viewport.height - 100);
      await page.mouse.move(x, y, { steps: randomBetween(5, 15) });
      await sleep(randomBetween(50, 200));
    }
  } catch {
    // Ignore mouse movement errors
  }
}

export async function simulateRandomScrolling(page: Page): Promise<void> {
  try {
    const scrollAmount = randomBetween(-200, 200);
    await page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: "smooth" });
    }, scrollAmount);
    await sleep(randomBetween(300, 800));
    // Scroll back
    await page.evaluate((amount) => {
      window.scrollBy({ top: -amount, behavior: "smooth" });
    }, scrollAmount);
  } catch {
    // Ignore scroll errors
  }
}

// ─── Checkpoint Detection ─────────────────────────────────────────────────────

export interface CheckpointDetectionResult {
  detected: boolean;
  type: "none" | "checkpoint" | "captcha" | "login" | "suspended" | "rate_limited" | "warning";
  message: string;
  severity: "low" | "medium" | "high" | "critical";
}

export async function detectCheckpoint(page: Page): Promise<CheckpointDetectionResult> {
  try {
    const url = page.url();

    // Kiểm tra URL patterns
    if (url.includes("checkpoint") || url.includes("security_check")) {
      return {
        detected: true,
        type: "checkpoint",
        message: "Facebook yêu cầu xác minh bảo mật (checkpoint)",
        severity: "critical",
      };
    }

    if (url.includes("login") || url.includes("login.php")) {
      return {
        detected: true,
        type: "login",
        message: "Session đã hết hạn, Facebook yêu cầu đăng nhập lại",
        severity: "critical",
      };
    }

    if (url.includes("disabled") || url.includes("suspended")) {
      return {
        detected: true,
        type: "suspended",
        message: "Tài khoản Facebook có thể đã bị tạm khóa",
        severity: "critical",
      };
    }

    // Kiểm tra DOM cho các dấu hiệu checkpoint/cảnh báo
    const pageContent = await page.evaluate(() => {
      const body = document.body?.innerText?.toLowerCase() || "";
      const title = document.title?.toLowerCase() || "";

      // Các từ khóa checkpoint
      const checkpointKeywords = [
        "security check", "verify your identity", "confirm your identity",
        "unusual activity", "suspicious activity", "account temporarily locked",
        "xác minh danh tính", "kiểm tra bảo mật", "hoạt động bất thường",
        "tài khoản bị tạm khóa", "xác nhận danh tính",
      ];

      // Các từ khóa captcha
      const captchaKeywords = [
        "captcha", "i'm not a robot", "tôi không phải robot",
        "prove you're human", "xác minh bạn là người",
      ];

      // Các từ khóa rate limit
      const rateLimitKeywords = [
        "you're sending messages too fast", "slow down", "try again later",
        "gửi tin nhắn quá nhanh", "thử lại sau", "you've reached the limit",
        "đã đạt giới hạn",
      ];

      // Cảnh báo nhẹ
      const warningKeywords = [
        "this looks like spam", "trông có vẻ là spam",
        "are you sure you want to send", "message may be spam",
      ];

      for (const kw of checkpointKeywords) {
        if (body.includes(kw) || title.includes(kw)) return "checkpoint";
      }
      for (const kw of captchaKeywords) {
        if (body.includes(kw)) return "captcha";
      }
      for (const kw of rateLimitKeywords) {
        if (body.includes(kw)) return "rate_limited";
      }
      for (const kw of warningKeywords) {
        if (body.includes(kw)) return "warning";
      }

      return "none";
    });

    if (pageContent === "checkpoint") {
      return { detected: true, type: "checkpoint", message: "Phát hiện trang checkpoint bảo mật", severity: "critical" };
    }
    if (pageContent === "captcha") {
      return { detected: true, type: "captcha", message: "Phát hiện CAPTCHA - Facebook nghi ngờ bot", severity: "high" };
    }
    if (pageContent === "rate_limited") {
      return { detected: true, type: "rate_limited", message: "Facebook giới hạn tốc độ gửi tin nhắn", severity: "medium" };
    }
    if (pageContent === "warning") {
      return { detected: true, type: "warning", message: "Facebook cảnh báo nội dung có thể là spam", severity: "low" };
    }

    return { detected: false, type: "none", message: "Không phát hiện checkpoint", severity: "low" };
  } catch {
    return { detected: false, type: "none", message: "Không thể kiểm tra checkpoint", severity: "low" };
  }
}

// ─── Fingerprint Protection ───────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1536, height: 864 },
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

export async function applyFingerprintProtection(page: Page): Promise<void> {
  // Ẩn dấu hiệu automation
  await page.evaluateOnNewDocument(() => {
    // Xóa webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Giả lập plugins
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
      ],
    });

    // Giả lập languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["vi-VN", "vi", "en-US", "en"],
    });

    // Xóa automation chrome flag
    // @ts-ignore
    delete window.chrome?.runtime?.onConnect;

    // Giả lập hardware concurrency
    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => [4, 6, 8, 12][Math.floor(Math.random() * 4)],
    });

    // Giả lập device memory
    Object.defineProperty(navigator, "deviceMemory", {
      get: () => [4, 8, 16][Math.floor(Math.random() * 3)],
    });
  });
}

// ─── Session Health Monitor ───────────────────────────────────────────────────

export interface SessionHealthResult {
  healthy: boolean;
  status: "active" | "expired" | "checkpoint" | "unknown";
  message: string;
}

export async function checkSessionHealth(page: Page): Promise<SessionHealthResult> {
  try {
    await page.goto("https://www.messenger.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await sleep(2000);

    const url = page.url();
    const checkpoint = await detectCheckpoint(page);

    if (checkpoint.detected && checkpoint.type !== "none") {
      return {
        healthy: false,
        status: checkpoint.type === "login" ? "expired" : "checkpoint",
        message: checkpoint.message,
      };
    }

    if (url.includes("messenger.com") && !url.includes("login")) {
      return { healthy: true, status: "active", message: "Session đang hoạt động bình thường" };
    }

    return { healthy: false, status: "expired", message: "Session đã hết hạn" };
  } catch (e) {
    return { healthy: false, status: "unknown", message: `Không thể kiểm tra: ${e}` };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tính Risk Score tổng hợp trước khi chạy campaign
export interface CampaignRiskAssessment {
  riskScore: number;
  riskLevel: "safe" | "caution" | "warning" | "danger";
  warnings: string[];
  recommendations: string[];
  estimatedDuration: string; // thời gian ước tính để hoàn thành
  suggestedConfig: AntiCheckpointConfig;
}

export function assessCampaignRisk(
  totalRecipients: number,
  config: AntiCheckpointConfig,
  userId: number
): CampaignRiskAssessment {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;

  const state = getRateLimiter(userId);

  // Kiểm tra số lượng người nhận
  if (totalRecipients > config.maxMessagesPerDay) {
    riskScore += 30;
    warnings.push(`${totalRecipients} tin nhắn vượt giới hạn ngày (${config.maxMessagesPerDay}). Campaign sẽ chạy nhiều ngày.`);
    recommendations.push("Chia campaign thành nhiều đợt nhỏ hơn");
  }

  if (totalRecipients > config.maxMessagesPerHour * 2) {
    riskScore += 15;
    warnings.push(`Số lượng lớn (${totalRecipients} tin) có thể kích hoạt cơ chế phát hiện spam`);
  }

  // Kiểm tra delay có đủ an toàn không
  if (config.minDelay < 3000) {
    riskScore += 25;
    warnings.push("Delay tối thiểu dưới 3 giây - rủi ro bị phát hiện rất cao");
    recommendations.push("Tăng delay tối thiểu lên ít nhất 5 giây");
  }

  // Kiểm tra lịch sử checkpoint
  if (state.checkpointCount > 0) {
    riskScore += state.checkpointCount * 15;
    warnings.push(`Tài khoản đã bị checkpoint ${state.checkpointCount} lần trước đó`);
    recommendations.push("Nên nghỉ ít nhất 24 giờ trước khi chạy campaign tiếp theo");
  }

  // Kiểm tra tốc độ gửi gần đây
  if (state.sentThisHour > config.maxMessagesPerHour * 0.7) {
    riskScore += 20;
    warnings.push(`Đã gửi ${state.sentThisHour} tin trong giờ qua - gần đạt giới hạn`);
  }

  // Tính thời gian ước tính
  const avgDelay = (config.minDelay + config.maxDelay) / 2;
  const breakTime = Math.floor(totalRecipients / config.breakAfterMessages) *
    ((config.breakDurationMin + config.breakDurationMax) / 2 * 1000);
  const totalMs = totalRecipients * avgDelay + breakTime;
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const estimatedDuration = hours > 0 ? `~${hours}h ${minutes}m` : `~${minutes}m`;

  // Đề xuất config phù hợp
  let suggestedLevel: SafetyLevel = config.safetyLevel;
  if (riskScore > 70) suggestedLevel = "extreme";
  else if (riskScore > 50) suggestedLevel = "high";
  else if (riskScore > 25) suggestedLevel = "medium";

  const riskLevel =
    riskScore < 25 ? "safe" :
    riskScore < 50 ? "caution" :
    riskScore < 75 ? "warning" : "danger";

  if (riskLevel === "safe") {
    recommendations.push("Campaign an toàn để chạy với cấu hình hiện tại");
  }

  return {
    riskScore: Math.min(100, riskScore),
    riskLevel,
    warnings,
    recommendations,
    estimatedDuration,
    suggestedConfig: SAFETY_PRESETS[suggestedLevel],
  };
}
