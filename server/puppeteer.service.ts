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
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
      "--lang=vi-VN,vi",
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

// Type cho Puppeteer cookie param
interface PuppeteerCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

// Chuyển đổi cookie từ format Cookie-Editor sang format Puppeteer
function normalizeCookies(rawCookies: Record<string, unknown>[]): PuppeteerCookie[] {
  const result: PuppeteerCookie[] = [];

  for (const c of rawCookies) {
    const name = String(c.name ?? '');
    const value = String(c.value ?? '');
    if (!name) continue;

    // Lấy domain gốc
    let domain = String(c.domain ?? '.facebook.com');
    // Đảm bảo domain bắt đầu bằng dấu chấm cho cookie cross-subdomain
    if (!domain.startsWith('.') && !domain.startsWith('http')) {
      domain = '.' + domain;
    }

    // sameSite mapping
    const ss = String(c.sameSite ?? '').toLowerCase();
    let sameSite: 'Strict' | 'Lax' | 'None' = 'None';
    if (ss === 'strict') sameSite = 'Strict';
    else if (ss === 'lax') sameSite = 'Lax';

    // Tạo cookie cho facebook.com
    const base: PuppeteerCookie = {
      name,
      value,
      domain,
      path: String(c.path ?? '/'),
      secure: Boolean(c.secure ?? false),
      httpOnly: Boolean(c.httpOnly ?? false),
      sameSite,
    };

    // Thêm expiry nếu có
    if (c.expirationDate) {
      base.expires = Number(c.expirationDate);
    }

    result.push(base);

    // Nếu cookie là của facebook.com, tạo thêm bản sao cho messenger.com
    if (domain.includes('facebook.com')) {
      result.push({
        ...base,
        domain: domain.replace('facebook.com', 'messenger.com'),
      });
    }
  }

  return result;
}

async function applyCookiesToPage(page: Page, sessionData: string) {
  try {
    const rawCookies = JSON.parse(sessionData) as Record<string, unknown>[];
    if (!Array.isArray(rawCookies) || rawCookies.length === 0) return;

    const normalized = normalizeCookies(rawCookies);
    if (normalized.length > 0) {
      await page.setCookie(...normalized);
      console.log(`[Puppeteer] Applied ${normalized.length} cookies (${rawCookies.length} raw → ${normalized.length} normalized for fb+messenger)`);
    }
  } catch (e) {
    console.warn('[Puppeteer] applyCookiesToPage error:', e);
  }
}

async function setPageDefaults(page: Page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Fake plugins
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["vi-VN", "vi", "en-US", "en"] });
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
      console.log("[Puppeteer] Applying cookies and opening Messenger inbox...");
      // Bước 1: Navigate đến messenger.com để thiết lập domain context
      await streamPage.goto("https://www.messenger.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Bước 2: Set cookies sau khi đã có domain context
      await applyCookiesToPage(streamPage, sessionData);
      // Bước 3: Reload để áp dụng cookies
      await streamPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(4000);
      const url = streamPage.url();
      console.log("[Puppeteer] Stream page URL after cookie apply:", url);
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
export async function scanMessengerInbox(
  userId: number,
  sessionData: string,
  maxContacts: number = 0
): Promise<{ contacts: InboxContact[]; error?: string }> {
  const useStreamPage = streamPage && !streamPage.isClosed();
  let ownedPage: Page | null = null;
  let activePage: Page;

  try {
    const browser = await getBrowser(userId, sessionData);
    if (useStreamPage) {
      activePage = streamPage!;
      const currentUrl = activePage.url();
      if (!currentUrl.includes("messenger.com")) {
        await activePage.goto("https://www.messenger.com/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await sleep(4000);
      }
    } else {
      ownedPage = await browser.newPage();
      await setPageDefaults(ownedPage);
      // Bước 1: Navigate đến messenger.com trước
      await ownedPage.goto("https://www.messenger.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Bước 2: Set cookies sau khi có domain context
      await applyCookiesToPage(ownedPage, sessionData);
      // Bước 3: Reload để áp dụng cookies
      await ownedPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(4000);
      activePage = ownedPage;
    }

    const url = activePage.url();
    console.log("[Puppeteer] Current URL:", url);
    if (url.includes("login") || url.includes("checkpoint")) {
      return { contacts: [], error: "Cookies hết hạn. Hãy cập nhật cookies trong Cài đặt." };
    }

    // Chờ trang load xong - đợi lâu hơn để React render
    await sleep(6000);

    // Debug: log tất cả links tìm được lần đầu
    const debugLinks = await activePage.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      return allLinks.slice(0, 30).map(l => ({ href: l.href, text: l.textContent?.substring(0, 40) }));
    });
    console.log('[Puppeteer] Debug links found:', JSON.stringify(debugLinks.slice(0, 10)));

    const contacts: InboxContact[] = [];
    let prevCount = 0;
    let noNewCount = 0;
    const maxScrollAttempts = 60;
    let scrollAttempts = 0;

    console.log("[Puppeteer] Starting inbox scan...");

    while (scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Lấy danh sách conversation links
      const found = await activePage.evaluate(() => {
        const results: { name: string; url: string }[] = [];
        const seen = new Set<string>();
        const origin = window.location.origin; // https://www.messenger.com

        // Strategy 1: Tìm tất cả <a> tags - kể cả href tương đối
        const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const link of allLinks) {
          const href = link.href || '';
          // Chấp nhận cả URL đầy đủ và tương đối
          const fullHref = href.startsWith('http') ? href : (origin + href);
          
          // Lọc chỉ lấy conversation links - nhiều pattern hơn
          const isConvLink = 
            fullHref.match(/messenger\.com\/t\/[^/?#]+/) ||
            fullHref.match(/messenger\.com\/e2ee\/t\/[^/?#]+/) ||
            fullHref.match(/messenger\.com\/groupconversations\/[^/?#]+/) ||
            fullHref.match(/messenger\.com\/\d{5,}/) ||
            href.match(/^\/t\/[^/?#]+/) ||
            href.match(/^\/e2ee\/t\/[^/?#]+/) ||
            href.match(/^\/\d{5,}/);
          
          if (!isConvLink) continue;
          if (fullHref.includes('/settings') || fullHref.includes('/marketplace') || fullHref.includes('/help')) continue;

          const normalizedUrl = fullHref.startsWith('http') ? fullHref : (origin + fullHref);
          if (seen.has(normalizedUrl)) continue;
          seen.add(normalizedUrl);

          // Lấy tên: thử nhiều cách
          let name = link.getAttribute('aria-label') || '';

          if (!name) {
            const spans = Array.from(link.querySelectorAll('span[dir="auto"]'));
            for (const span of spans) {
              const t = (span as HTMLElement).textContent?.trim() ?? '';
              if (t && t.length > 0 && t.length < 80 && !t.includes('·')) {
                name = t; break;
              }
            }
          }

          if (!name) {
            const t = link.textContent?.trim() ?? '';
            if (t && t.length > 0 && t.length < 80) name = t.split('\n')[0].trim();
          }

          if (!name) name = link.getAttribute('title') || '';

          results.push({ name: (name || 'Người dùng').substring(0, 60), url: normalizedUrl });
        }

        return results;
      });

      // Thêm contacts mới
      for (const item of found) {
        if (!contacts.find(c => c.conversationUrl === item.url)) {
          contacts.push({
            name: item.name || "Người dùng",
            conversationUrl: item.url,
          });
        }
      }

      console.log(`[Puppeteer] Inbox scan: ${contacts.length} contacts (scroll ${scrollAttempts})`);

      if (maxContacts > 0 && contacts.length >= maxContacts) break;
      if (contacts.length === prevCount) {
        noNewCount++;
        if (noNewCount >= 4) break;
      } else {
        noNewCount = 0;
      }
      prevCount = contacts.length;

      // Scroll sidebar
      await activePage.evaluate(() => {
        // Thử nhiều selector cho sidebar
        const sidebarSelectors = [
          '[role="navigation"]',
          '[aria-label*="Chats"]',
          '[aria-label*="Conversations"]',
          '[aria-label*="Tin nhắn"]',
          '[aria-label*="chat"]',
          'div[style*="overflow-y: auto"]',
          'div[style*="overflow-y:auto"]',
          'div[style*="overflow: auto"]',
          'div[style*="overflow:auto"]',
        ];

        let scrolled = false;
        for (const sel of sidebarSelectors) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            if (el.scrollHeight > el.clientHeight + 50) {
              el.scrollTop += 800;
              scrolled = true;
              break;
            }
          }
          if (scrolled) break;
        }

        if (!scrolled) {
          // Fallback: tìm container có nhiều link nhất và scroll
          const divs = Array.from(document.querySelectorAll("div"));
          let bestDiv: Element | null = null;
          let maxLinks = 0;
          for (const div of divs) {
            if (div.scrollHeight <= div.clientHeight + 50) continue;
            const linkCount = div.querySelectorAll('a[href*="messenger.com"]').length;
            if (linkCount > maxLinks) {
              maxLinks = linkCount;
              bestDiv = div;
            }
          }
          if (bestDiv) {
            bestDiv.scrollTop += 800;
          } else {
            window.scrollBy(0, 800);
          }
        }
      });

      await sleep(1500);
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

    // Chờ trang load
    await sleep(3000 + Math.random() * 1000);

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

    // ─── Tìm ô nhập tin nhắn với nhiều strategy ───────────────────────────────
    let msgBox = null;

    // Strategy 1: Chờ và tìm div contenteditable
    const msgSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'div[aria-label*="message" i]',
      'div[aria-label*="tin nhắn" i]',
      'div[aria-label*="Aa"]',
      'div[aria-placeholder*="Aa"]',
      'div[aria-placeholder*="message" i]',
    ];

    for (const sel of msgSelectors) {
      try {
        await activePage.waitForSelector(sel, { timeout: 5000 });
        const el = await activePage.$(sel);
        if (el) {
          // Kiểm tra element có visible không
          const isVisible = await activePage.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, el);
          if (isVisible) {
            msgBox = el;
            console.log(`[Puppeteer] Found message box with selector: ${sel}`);
            break;
          }
        }
      } catch {
        // tiếp tục thử selector tiếp theo
      }
    }

    // Strategy 2: Nếu không tìm thấy, thử evaluate để tìm
    if (!msgBox) {
      console.log("[Puppeteer] Trying evaluate strategy to find message box...");
      const found = await activePage.evaluate(() => {
        // Tìm tất cả contenteditable elements
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        for (const el of editables) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 20) {
            // Đây có thể là ô nhập tin nhắn
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (found) {
        await sleep(500);
        msgBox = await activePage.$('[contenteditable="true"]');
      }
    }

    if (!msgBox) {
      // Debug: lấy HTML để xem cấu trúc
      const bodyHtml = await activePage.evaluate(() => {
        return document.body.innerHTML.substring(0, 2000);
      });
      console.log("[Puppeteer] Page HTML snippet:", bodyHtml.substring(0, 500));
      return {
        success: false,
        error: "Không tìm thấy ô nhập tin nhắn. Trang có thể chưa load xong.",
      };
    }

    // Click vào ô nhập
    await msgBox.click();
    await sleep(500 + Math.random() * 300);

    // Gõ tin nhắn - dùng clipboard để tránh vấn đề với ký tự đặc biệt
    await activePage.evaluate((text) => {
      // Tìm ô nhập và focus
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      for (const el of editables) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) {
          (el as HTMLElement).focus();
          break;
        }
      }
    }, message);

    await sleep(200);

    // Gõ từng ký tự
    if (antiCheckpointConfig?.enableHumanTyping) {
      await simulateHumanTyping(activePage, message);
    } else {
      // Dùng clipboard API để paste text (nhanh hơn và đáng tin cậy hơn)
      await activePage.evaluate((text) => {
        const el = document.activeElement;
        if (el && el.getAttribute("contenteditable") === "true") {
          // Thử execCommand insertText
          document.execCommand("insertText", false, text);
        }
      }, message);

      // Kiểm tra nếu execCommand không hoạt động, gõ từng ký tự
      const currentText = await activePage.evaluate(() => {
        const el = document.activeElement;
        return el ? el.textContent || "" : "";
      });

      if (!currentText.includes(message.substring(0, 5))) {
        // Fallback: gõ từng ký tự
        for (const char of message) {
          await activePage.keyboard.type(char);
          await sleep(20 + Math.random() * 40);
        }
      }
    }

    await sleep(600 + Math.random() * 400);

    // Kiểm tra text đã được nhập chưa
    const enteredText = await activePage.evaluate(() => {
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      for (const el of editables) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) {
          return el.textContent || "";
        }
      }
      return "";
    });
    console.log(`[Puppeteer] Text in box: "${enteredText.substring(0, 50)}"`);

    // Gửi tin nhắn bằng Enter
    await activePage.keyboard.press("Enter");
    await sleep(2000 + Math.random() * 1000);

    // Kiểm tra checkpoint sau khi gửi
    const postCheck = await detectCheckpoint(activePage);
    if (postCheck.detected) {
      return { success: false, error: postCheck.message, checkpointDetected: true };
    }

    // Xác nhận tin nhắn đã gửi (text box trống = đã gửi)
    const textAfterSend = await activePage.evaluate(() => {
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      for (const el of editables) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20) {
          return el.textContent || "";
        }
      }
      return "";
    });

    if (textAfterSend.trim().length > 0 && textAfterSend.includes(message.substring(0, 10))) {
      // Text vẫn còn trong box - thử gửi lại bằng click nút gửi
      console.log("[Puppeteer] Text still in box, trying send button...");
      const sendButtonSelectors = [
        'div[aria-label*="Send" i]',
        'div[aria-label*="Gửi" i]',
        'button[aria-label*="Send" i]',
        'button[aria-label*="Gửi" i]',
      ];
      for (const sel of sendButtonSelectors) {
        const btn = await activePage.$(sel);
        if (btn) {
          await btn.click();
          await sleep(1500);
          break;
        }
      }
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Puppeteer] openConversationAndSend error:", msg);
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

// ─── Debug Screenshot: chụp màn hình Messenger sau khi apply cookies ─────────
export async function debugScreenshot(
  userId: number,
  sessionData: string
): Promise<{ ok: boolean; screenshot?: string; url?: string; htmlSnippet?: string; error?: string }> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,900",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Bước 1: Navigate đến messenger.com
    await page.goto("https://www.messenger.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Bước 2: Apply cookies (normalize từ format Cookie-Editor)
    try {
      const rawCookies = JSON.parse(sessionData) as Record<string, unknown>[];
      if (Array.isArray(rawCookies) && rawCookies.length > 0) {
        const normalized = normalizeCookies(rawCookies);
        await page.setCookie(...normalized);
        console.log(`[Debug] Applied ${normalized.length} normalized cookies (from ${rawCookies.length} raw)`);
      }
    } catch (e) {
      console.warn("[Debug] Cookie parse error:", e);
    }

    // Bước 3: Reload để áp dụng cookies
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);

    const url = page.url();
    console.log("[Debug] URL after cookies:", url);

    // Chụp screenshot
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 80 });
    const screenshot = Buffer.from(screenshotBuffer).toString("base64");

    // Lấy thông tin DOM để debug
    const domInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 20)
        .map((l) => ({
          href: (l as HTMLAnchorElement).href,
          text: l.textContent?.substring(0, 30),
          aria: l.getAttribute("aria-label"),
        }));

      const editables = Array.from(document.querySelectorAll('[contenteditable]')).map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-label"),
        placeholder: el.getAttribute("aria-placeholder"),
        rect: JSON.stringify(el.getBoundingClientRect()),
      }));

      const title = document.title;
      const bodyText = document.body?.textContent?.substring(0, 500) ?? "";

      return { links, editables, title, bodyText };
    });

    return {
      ok: true,
      screenshot,
      url,
      htmlSnippet: JSON.stringify(domInfo, null, 2),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Debug] debugScreenshot error:", msg);
    return { ok: false, error: msg };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}
