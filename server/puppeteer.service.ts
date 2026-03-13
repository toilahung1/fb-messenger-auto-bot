import puppeteer, { Browser, Page } from "puppeteer";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface InboxContact {
  name: string;
  conversationUrl: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
  checkpointDetected?: boolean;
}

export interface ExtractCookiesResult {
  success: boolean;
  cookies?: string;
  cookieCount?: number;
  error?: string;
  requiresLogin?: boolean;
  loginUrl?: string;
}

// ─── Singleton Browser ────────────────────────────────────────────────────────
let browserInstance: Browser | null = null;
let browserUserId: number | null = null;
// Page dùng cho stream màn hình (giữ mở suốt phiên)
let streamPage: Page | null = null;
// Interval chụp screenshot
let streamInterval: NodeJS.Timeout | null = null;

async function getBrowser(userId: number, sessionData?: string): Promise<Browser> {
  if (browserInstance && browserUserId === userId) {
    try {
      const pages = await browserInstance.pages();
      if (pages.length > 0) return browserInstance;
    } catch {
      browserInstance = null;
    }
  }
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    streamPage = null;
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--window-size=1280,800",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  browserInstance = browser;
  browserUserId = userId;
  if (sessionData) {
    try {
      const cookies = JSON.parse(sessionData);
      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());
      await page.setCookie(...cookies);
    } catch (e) {
      console.warn("[Puppeteer] Failed to restore session:", e);
    }
  }
  return browser;
}

export async function closeBrowser() {
  stopScreenStream();
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    browserUserId = null;
    streamPage = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function interpolateMessage(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function applyCookiesToPage(page: Page, sessionData: string) {
  try {
    const cookies = JSON.parse(sessionData);
    await page.setCookie(...cookies);
  } catch {}
}

async function setPageDefaults(page: Page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

// ─── Screen Stream ────────────────────────────────────────────────────────────
export async function startScreenStream(
  userId: number,
  sessionData: string,
  onFrame: (base64: string) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    const browser = await getBrowser(userId, sessionData);
    if (!streamPage || streamPage.isClosed()) {
      streamPage = await browser.newPage();
      await setPageDefaults(streamPage);
      await applyCookiesToPage(streamPage, sessionData);
      console.log("[Puppeteer] Opening Messenger inbox...");
      await streamPage.goto("https://www.messenger.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(3000);
      const url = streamPage.url();
      console.log("[Puppeteer] Stream page URL:", url);
      if (url.includes("login") || url.includes("checkpoint") || url.includes("recover")) {
        return {
          ok: false,
          error: "Cookies đã hết hạn hoặc không hợp lệ. Hãy cập nhật cookies trong Cài đặt.",
        };
      }
    }
    if (streamInterval) clearInterval(streamInterval);
    streamInterval = setInterval(async () => {
      if (!streamPage || streamPage.isClosed()) {
        stopScreenStream();
        return;
      }
      try {
        const screenshot = await streamPage.screenshot({ type: "jpeg", quality: 60 });
        onFrame(Buffer.from(screenshot).toString("base64"));
      } catch {
        // ignore frame errors
      }
    }, 250); // 4fps
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Lỗi khi mở Messenger: ${msg}` };
  }
}

export function stopScreenStream() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
}

export function isStreaming() { return streamInterval !== null; }

// ─── Scan Inbox: lấy danh sách hội thoại từ Messenger inbox ──────────────────
// Bot tự động scroll inbox từ trên xuống và lấy danh sách conversation
export async function scanMessengerInbox(
  userId: number,
  sessionData: string,
  maxContacts: number = 0 // 0 = không giới hạn
): Promise<{ contacts: InboxContact[]; error?: string }> {
  // Ưu tiên dùng streamPage để người dùng xem được quá trình
  const useStreamPage = streamPage && !streamPage.isClosed();
  let ownedPage: Page | null = null;
  let activePage: Page;

  try {
    const browser = await getBrowser(userId, sessionData);
    if (useStreamPage) {
      activePage = streamPage!;
      // Đảm bảo đang ở trang inbox
      const currentUrl = activePage.url();
      if (!currentUrl.includes("messenger.com")) {
        await activePage.goto("https://www.messenger.com/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await sleep(3000);
      }
    } else {
      ownedPage = await browser.newPage();
      await setPageDefaults(ownedPage);
      await applyCookiesToPage(ownedPage, sessionData);
      await ownedPage.goto("https://www.messenger.com/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
      await sleep(3000);
      activePage = ownedPage;
    }

    const url = activePage.url();
    if (url.includes("login") || url.includes("checkpoint")) {
      return { contacts: [], error: "Cookies hết hạn. Hãy cập nhật cookies trong Cài đặt." };
    }

    const contacts: InboxContact[] = [];
    let prevCount = 0;
    let noNewCount = 0;
    const maxScrollAttempts = 50; // tối đa 50 lần scroll
    let scrollAttempts = 0;

    console.log("[Puppeteer] Scanning inbox...");

    while (scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Lấy danh sách conversation links hiện tại
      const found = await activePage.evaluate(() => {
        const results: { name: string; url: string }[] = [];
        // Tìm tất cả link hội thoại - Messenger dùng /t/ hoặc /e2ee/t/
        const linkNodes = document.querySelectorAll('a[href*="/t/"], a[href*="/e2ee/t/"]');
        const links = Array.from(linkNodes);
        links.forEach((link) => {
          const href = (link as HTMLAnchorElement).href;
          if (!href.includes("messenger.com")) return;

          // Lấy tên người dùng từ nhiều nguồn
          let name = "";
          // Thử aria-label trên link
          name = link.getAttribute("aria-label") || "";
          if (!name) {
            // Thử span có dir="auto" (tên người dùng)
            const spanNodes = link.querySelectorAll('span[dir="auto"]');
            const spans = Array.from(spanNodes);
            for (const span of spans) {
              const text = span.textContent?.trim();
              if (text && text.length > 0 && text.length < 100) {
                name = text;
                break;
              }
            }
          }
          if (!name) {
            // Thử text content chung
            const text = link.textContent?.trim();
            if (text && text.length > 0 && text.length < 100) {
              name = text.split("\n")[0].trim();
            }
          }

          if (href && name) {
            results.push({ name, url: href });
          }
        });

        // Deduplicate by URL
        const seen = new Set<string>();
        return results.filter(r => {
          if (seen.has(r.url)) return false;
          seen.add(r.url);
          return true;
        });
      });

      // Thêm contacts mới chưa có trong danh sách
      for (const item of found) {
        if (!contacts.find(c => c.conversationUrl === item.url)) {
          contacts.push({
            name: item.name || "Người dùng",
            conversationUrl: item.url,
          });
        }
      }

      console.log(`[Puppeteer] Inbox scan: ${contacts.length} contacts found (scroll ${scrollAttempts})`);

      // Kiểm tra điều kiện dừng
      if (maxContacts > 0 && contacts.length >= maxContacts) break;
      if (contacts.length === prevCount) {
        noNewCount++;
        if (noNewCount >= 3) break; // Không có thêm sau 3 lần scroll
      } else {
        noNewCount = 0;
      }
      prevCount = contacts.length;

      // Scroll xuống trong sidebar conversation list
      await activePage.evaluate(() => {
        // Tìm container chứa danh sách hội thoại
        const selectors = [
          '[aria-label="Chats"]',
          '[aria-label="Conversations"]',
          '[aria-label="Tin nhắn"]',
          'div[role="navigation"]',
          'div[style*="overflow"]',
        ];
        let scrolled = false;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight) {
            el.scrollTop += 600;
            scrolled = true;
            break;
          }
        }
        if (!scrolled) {
          // Fallback: scroll window
          window.scrollBy(0, 600);
        }
      });
      await sleep(1200);
    }

    const result = maxContacts > 0 ? contacts.slice(0, maxContacts) : contacts;
    console.log(`[Puppeteer] Inbox scan complete: ${result.length} contacts`);
    return { contacts: result };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Puppeteer] scanMessengerInbox error:", msg);
    return { contacts: [], error: msg };
  } finally {
    if (ownedPage) try { await ownedPage.close(); } catch {}
  }
}

// ─── Open Conversation & Send Message ────────────────────────────────────────
// Mở một hội thoại và gửi tin nhắn - dùng streamPage để hiển thị live
export async function openConversationAndSend(
  userId: number,
  conversationUrl: string,
  message: string,
  sessionData: string,
  antiCheckpointConfig?: import('./anti-checkpoint.service').AntiCheckpointConfig
): Promise<SendResult> {
  const useStreamPage = streamPage && !streamPage.isClosed();
  let ownedPage: Page | null = null;
  let activePage: Page;

  try {
    const browser = await getBrowser(userId, sessionData);
    if (useStreamPage) {
      activePage = streamPage!;
    } else {
      ownedPage = await browser.newPage();
      await setPageDefaults(ownedPage);
      await applyCookiesToPage(ownedPage, sessionData);
      activePage = ownedPage;
    }

    const { detectCheckpoint, simulateMouseMovement, simulateHumanTyping } =
      await import('./anti-checkpoint.service');

    // Điều hướng đến conversation
    console.log(`[Puppeteer] Opening: ${conversationUrl}`);
    await activePage.goto(conversationUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(2000 + Math.random() * 1000);

    // Kiểm tra checkpoint
    const checkResult = await detectCheckpoint(activePage);
    if (checkResult.detected) {
      return { success: false, error: checkResult.message, checkpointDetected: true };
    }

    const currentUrl = activePage.url();
    if (currentUrl.includes("login") || currentUrl.includes("checkpoint")) {
      return { success: false, error: "Cookies hết hạn. Hãy cập nhật cookies trong Cài đặt." };
    }

    // Giả lập mouse movement
    if (antiCheckpointConfig?.enableMouseMovement) {
      await simulateMouseMovement(activePage);
    }

    // Tìm ô nhập tin nhắn
    const msgSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="message"]',
      'div[aria-label*="tin nhắn"]',
      'div[data-lexical-editor="true"]',
      '[contenteditable="true"]',
    ];

    let msgBox = null;
    for (const sel of msgSelectors) {
      try {
        await activePage.waitForSelector(sel, { timeout: 8000 });
        msgBox = await activePage.$(sel);
        if (msgBox) break;
      } catch {}
    }

    if (!msgBox) {
      return {
        success: false,
        error: "Không tìm thấy ô nhập tin nhắn. Conversation có thể không hợp lệ.",
      };
    }

    // Click vào ô nhập
    await msgBox.click();
    await sleep(300 + Math.random() * 200);

    // Gõ tin nhắn
    if (antiCheckpointConfig?.enableHumanTyping) {
      await simulateHumanTyping(activePage, message);
    } else {
      for (const char of message) {
        await activePage.keyboard.type(char);
        await sleep(30 + Math.random() * 70);
      }
    }

    await sleep(500 + Math.random() * 300);

    // Gửi
    await activePage.keyboard.press("Enter");
    await sleep(1500 + Math.random() * 1000);

    // Kiểm tra checkpoint sau khi gửi
    const postCheck = await detectCheckpoint(activePage);
    if (postCheck.detected) {
      return { success: false, error: postCheck.message, checkpointDetected: true };
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  } finally {
    if (ownedPage) try { await ownedPage.close(); } catch {}
  }
}

// ─── Legacy sendMessengerMessage (backward compat) ────────────────────────────
export async function sendMessengerMessage(
  userId: number,
  options: {
    recipientName: string;
    facebookUrl?: string;
    message: string;
    sessionData?: string;
    antiCheckpointConfig?: import('./anti-checkpoint.service').AntiCheckpointConfig;
    messageIndex?: number;
  }
): Promise<SendResult> {
  if (!options.facebookUrl) {
    return { success: false, error: "Không có URL hội thoại" };
  }
  return openConversationAndSend(
    userId,
    options.facebookUrl,
    options.message,
    options.sessionData ?? "[]",
    options.antiCheckpointConfig
  );
}

// ─── Verify Session ───────────────────────────────────────────────────────────
export async function verifyFacebookSession(sessionData: string): Promise<boolean> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.goto("https://www.messenger.com", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.setCookie(...JSON.parse(sessionData));
    await page.reload({ waitUntil: "networkidle2", timeout: 20000 });
    const url = page.url();
    return !url.includes("login") && !url.includes("checkpoint");
  } catch {
    return false;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ─── Extract Cookies ──────────────────────────────────────────────────────────
const pendingLoginBrowsers = new Map<number, { browser: Browser; page: Page; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  Array.from(pendingLoginBrowsers.entries()).forEach(([userId, entry]) => {
    if (now - entry.createdAt > 10 * 60 * 1000) {
      try { entry.browser.close(); } catch {}
      pendingLoginBrowsers.delete(userId);
    }
  });
}, 60 * 1000);

export async function extractFacebookCookies(
  userId: number,
  targetUrl: string
): Promise<ExtractCookiesResult> {
  let browser: Browser | null = null;
  try {
    let url = targetUrl.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    if (!url.includes("facebook.com") && !url.includes("messenger.com")) {
      url = "https://www.messenger.com";
    }
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    console.log(`[Puppeteer] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    const currentUrl = page.url();
    console.log(`[Puppeteer] Current URL after navigation: ${currentUrl}`);
    const isLoginPage =
      currentUrl.includes("/login") ||
      currentUrl.includes("login.php") ||
      currentUrl.includes("checkpoint") ||
      currentUrl.includes("accounts/login");
    if (isLoginPage) {
      pendingLoginBrowsers.set(userId, { browser, page, createdAt: Date.now() });
      browser = null;
      return {
        success: false,
        requiresLogin: true,
        loginUrl: currentUrl,
        error:
          "Facebook yêu cầu đăng nhập. Bạn cần cung cấp cookies phiên đăng nhập hợp lệ trước. " +
          "Hãy đăng nhập Facebook trên trình duyệt của bạn, xuất cookies bằng extension Cookie-Editor, " +
          "rồi dán vào ô bên dưới.",
      };
    }
    const allCookies = await page.cookies(
      "https://www.facebook.com",
      "https://www.messenger.com",
      "https://facebook.com",
      "https://messenger.com"
    );
    const importantCookies = allCookies.filter(
      (c) => c.domain?.includes("facebook.com") || c.domain?.includes("messenger.com")
    );
    if (importantCookies.length === 0) {
      return { success: false, error: "Không tìm thấy cookies phiên đăng nhập." };
    }
    const hasUserCookie = importantCookies.some((c) => c.name === "c_user");
    if (!hasUserCookie) {
      return {
        success: false,
        requiresLogin: true,
        error: "Không tìm thấy cookie xác thực người dùng (c_user). Vui lòng đăng nhập Facebook trên trình duyệt, xuất cookies và dán thủ công.",
      };
    }
    const cookiesJson = JSON.stringify(importantCookies, null, 2);
    console.log(`[Puppeteer] Extracted ${importantCookies.length} cookies successfully`);
    return { success: true, cookies: cookiesJson, cookieCount: importantCookies.length };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Puppeteer] extractFacebookCookies error:", msg);
    return { success: false, error: `Lỗi khi lấy cookies: ${msg}` };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

export async function getCookiesFromPendingBrowser(userId: number): Promise<ExtractCookiesResult> {
  const entry = pendingLoginBrowsers.get(userId);
  if (!entry) {
    return { success: false, error: "Không có phiên browser nào đang chờ" };
  }
  try {
    const { browser, page } = entry;
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("checkpoint")) {
      return {
        success: false,
        requiresLogin: true,
        error: "Chưa đăng nhập. Vui lòng hoàn tất đăng nhập trên trình duyệt.",
      };
    }
    const allCookies = await page.cookies("https://www.facebook.com", "https://www.messenger.com");
    const hasUserCookie = allCookies.some((c) => c.name === "c_user");
    if (!hasUserCookie) {
      return { success: false, requiresLogin: true, error: "Chưa đăng nhập thành công" };
    }
    const cookiesJson = JSON.stringify(allCookies, null, 2);
    pendingLoginBrowsers.delete(userId);
    try { await browser.close(); } catch {}
    return { success: true, cookies: cookiesJson, cookieCount: allCookies.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
