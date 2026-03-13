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
