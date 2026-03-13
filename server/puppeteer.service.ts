import puppeteer, { Browser, Page } from "puppeteer";

interface SendMessageOptions {
  recipientName: string;
  facebookUrl?: string;
  message: string;
  sessionData?: string; // JSON cookies
}

interface SendResult {
  success: boolean;
  error?: string;
}

// Singleton browser instance per process
let browserInstance: Browser | null = null;
let browserUserId: number | null = null;

async function getBrowser(userId: number, sessionData?: string): Promise<Browser> {
  // Nếu đã có browser cho user này, tái sử dụng
  if (browserInstance && browserUserId === userId) {
    try {
      const pages = await browserInstance.pages();
      if (pages.length > 0) return browserInstance;
    } catch {
      browserInstance = null;
    }
  }

  // Đóng browser cũ nếu có
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
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
    ],
  });

  browserInstance = browser;
  browserUserId = userId;

  // Khôi phục session cookies nếu có
  if (sessionData) {
    try {
      const cookies = JSON.parse(sessionData);
      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());
      await page.goto("https://www.messenger.com", { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.setCookie(...cookies);
    } catch (e) {
      console.warn("[Puppeteer] Failed to restore session:", e);
    }
  }

  return browser;
}

export async function closeBrowser() {
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    browserUserId = null;
  }
}

// Thay thế biến động trong nội dung tin nhắn
export function interpolateMessage(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

// Kiểm tra session Facebook có còn hợp lệ không
export async function verifyFacebookSession(sessionData: string): Promise<boolean> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    const cookies = JSON.parse(sessionData);
    await page.goto("https://www.messenger.com", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.setCookie(...cookies);
    await page.reload({ waitUntil: "networkidle2", timeout: 20000 });
    const url = page.url();
    return !url.includes("login") && !url.includes("checkpoint");
  } catch {
    return false;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// Gửi tin nhắn đến một người nhận
export async function sendMessengerMessage(
  userId: number,
  options: SendMessageOptions
): Promise<SendResult> {
  let page: Page | null = null;
  try {
    const browser = await getBrowser(userId, options.sessionData);
    page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Khôi phục cookies
    if (options.sessionData) {
      try {
        const cookies = JSON.parse(options.sessionData);
        await page.setCookie(...cookies);
      } catch {}
    }

    // Điều hướng đến trang Messenger
    let targetUrl = "https://www.messenger.com/";
    if (options.facebookUrl) {
      // Nếu có URL trực tiếp (ví dụ: https://www.messenger.com/t/username)
      targetUrl = options.facebookUrl.startsWith("http")
        ? options.facebookUrl
        : `https://www.messenger.com/t/${options.facebookUrl}`;
    }

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Kiểm tra đã đăng nhập chưa
    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("checkpoint")) {
      return { success: false, error: "Phiên đăng nhập Facebook đã hết hạn. Vui lòng cập nhật session." };
    }

    // Nếu không có URL cụ thể, tìm kiếm người nhận
    if (!options.facebookUrl) {
      // Tìm ô tìm kiếm
      const searchSelectors = [
        'input[placeholder*="Search"]',
        'input[placeholder*="Tìm kiếm"]',
        '[aria-label*="Search"]',
        'input[type="search"]',
      ];

      let searchInput = null;
      for (const sel of searchSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          searchInput = await page.$(sel);
          if (searchInput) break;
        } catch {}
      }

      if (!searchInput) {
        return { success: false, error: "Không tìm thấy ô tìm kiếm trên Messenger" };
      }

      await searchInput.click();
      await page.keyboard.type(options.recipientName, { delay: 80 });
      await new Promise((r) => setTimeout(r, 2000));

      // Chọn kết quả đầu tiên
      const resultSelectors = [
        '[data-testid="search-result-item"]',
        'a[role="link"][tabindex="0"]',
        'li[role="option"]',
        'div[role="option"]',
      ];

      let clicked = false;
      for (const sel of resultSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            clicked = true;
            break;
          }
        } catch {}
      }

      if (!clicked) {
        return { success: false, error: `Không tìm thấy người nhận: ${options.recipientName}` };
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    // Tìm ô nhập tin nhắn
    const msgSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="message"]',
      'div[aria-label*="tin nhắn"]',
      'div[data-lexical-editor="true"]',
    ];

    let msgBox = null;
    for (const sel of msgSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        msgBox = await page.$(sel);
        if (msgBox) break;
      } catch {}
    }

    if (!msgBox) {
      return { success: false, error: "Không tìm thấy ô nhập tin nhắn" };
    }

    await msgBox.click();
    await new Promise((r) => setTimeout(r, 500));

    // Gõ tin nhắn từng ký tự để tránh bị phát hiện
    await page.keyboard.type(options.message, { delay: 50 });
    await new Promise((r) => setTimeout(r, 500));

    // Gửi tin nhắn bằng Enter
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 1500));

    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

// ─── Tự động lấy cookies từ URL Facebook ──────────────────────────────────────
// Người dùng nhập URL Facebook (profile, messenger, v.v.)
// Hệ thống mở headless browser, điều hướng đến URL đó,
// chờ trang load và trích xuất toàn bộ cookies phiên đăng nhập.
// Yêu cầu: người dùng đã đăng nhập Facebook trên trình duyệt đó trước đó
// (hoặc cung cấp cookies thủ công lần đầu để bootstrap).
//
// Cách hoạt động thực tế:
// - Nếu server chạy trên máy người dùng: mở browser với profile thật → lấy cookies
// - Nếu server chạy trên cloud: mở headless browser → người dùng cần login thủ công lần đầu
//   sau đó cookies được lưu và tái sử dụng

export interface ExtractCookiesResult {
  success: boolean;
  cookies?: string; // JSON string của mảng cookies
  cookieCount?: number;
  error?: string;
  requiresLogin?: boolean; // true nếu Facebook yêu cầu đăng nhập
  loginUrl?: string;       // URL để người dùng đăng nhập
}

// Biến lưu trữ browser đang chờ login (dùng cho flow login thủ công)
const pendingLoginBrowsers = new Map<number, { browser: Browser; page: Page; createdAt: number }>();

// Dọn dẹp các browser pending quá 10 phút
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
    // Chuẩn hóa URL
    let url = targetUrl.trim();
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }
    // Nếu không phải facebook/messenger domain, mặc định về messenger
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

    // Giả lập trình duyệt thật để tránh bị chặn
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Ẩn dấu hiệu automation
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Điều hướng đến URL mục tiêu
    console.log(`[Puppeteer] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Chờ thêm để trang load đầy đủ
    await new Promise((r) => setTimeout(r, 3000));

    const currentUrl = page.url();
    console.log(`[Puppeteer] Current URL after navigation: ${currentUrl}`);

    // Kiểm tra xem có bị redirect về trang login không
    const isLoginPage =
      currentUrl.includes("/login") ||
      currentUrl.includes("login.php") ||
      currentUrl.includes("checkpoint") ||
      currentUrl.includes("accounts/login");

    if (isLoginPage) {
      // Lưu browser để người dùng có thể login thủ công (nếu cần)
      pendingLoginBrowsers.set(userId, { browser, page, createdAt: Date.now() });
      browser = null; // Không đóng browser này

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

    // Lấy tất cả cookies từ domain facebook.com và messenger.com
    const allCookies = await page.cookies(
      "https://www.facebook.com",
      "https://www.messenger.com",
      "https://facebook.com",
      "https://messenger.com"
    );

    // Lọc các cookies quan trọng cho phiên đăng nhập
    const sessionCookieNames = [
      "c_user", "xs", "fr", "datr", "sb", "wd", "locale",
      "presence", "dpr", "m_pixel_ratio", "usida", "x-referer",
      "act", "spin", "noscript", "flow", "oo", "pl",
    ];

    // Ưu tiên cookies quan trọng, nhưng giữ tất cả để đảm bảo session hoạt động
    const importantCookies = allCookies.filter((c) =>
      sessionCookieNames.includes(c.name) || c.domain?.includes("facebook.com") || c.domain?.includes("messenger.com")
    );

    if (importantCookies.length === 0) {
      return {
        success: false,
        error: "Không tìm thấy cookies phiên đăng nhập. Trang có thể chưa load đầy đủ hoặc bạn chưa đăng nhập.",
      };
    }

    // Kiểm tra có cookie c_user (xác nhận đã đăng nhập) không
    const hasUserCookie = importantCookies.some((c) => c.name === "c_user");
    if (!hasUserCookie) {
      return {
        success: false,
        requiresLogin: true,
        error:
          "Không tìm thấy cookie xác thực người dùng (c_user). " +
          "Vui lòng đăng nhập Facebook trên trình duyệt, xuất cookies và dán thủ công.",
      };
    }

    const cookiesJson = JSON.stringify(importantCookies, null, 2);
    console.log(`[Puppeteer] Extracted ${importantCookies.length} cookies successfully`);

    return {
      success: true,
      cookies: cookiesJson,
      cookieCount: importantCookies.length,
    };
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

// Lấy cookies từ browser đang chờ login (sau khi người dùng đã login thủ công)
export async function getCookiesFromPendingBrowser(userId: number): Promise<ExtractCookiesResult> {
  const entry = pendingLoginBrowsers.get(userId);
  if (!entry) {
    return { success: false, error: "Không có phiên browser nào đang chờ" };
  }

  try {
    const { browser, page } = entry;
    const currentUrl = page.url();

    // Kiểm tra đã login chưa
    if (currentUrl.includes("/login") || currentUrl.includes("checkpoint")) {
      return {
        success: false,
        requiresLogin: true,
        error: "Chưa đăng nhập. Vui lòng hoàn tất đăng nhập trên trình duyệt.",
      };
    }

    const allCookies = await page.cookies(
      "https://www.facebook.com",
      "https://www.messenger.com"
    );

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
