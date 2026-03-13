// ============================================================
// Content Script - Chạy trong context của tab Messenger
// Lắng nghe lệnh từ background và thực hiện gửi tin nhắn
// ============================================================

// Thông báo cho background biết content script đã sẵn sàng
chrome.runtime.sendMessage({ type: 'content_ready', url: window.location.href });

// Lắng nghe lệnh gửi tin nhắn từ background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'navigate_and_send') {
    navigateAndSend(msg.targetUrl, msg.message)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // async
  }

  if (msg.type === 'send_message') {
    sendCurrentConversation(msg.message)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'get_current_url') {
    sendResponse({ url: window.location.href });
  }
});

// ─── Điều hướng đến conversation và gửi tin nhắn ──────────
async function navigateAndSend(targetUrl, message) {
  // Kiểm tra nếu đang ở đúng conversation
  const currentPath = window.location.pathname;
  const targetPath = new URL(targetUrl).pathname;

  if (currentPath !== targetPath) {
    // Điều hướng
    window.location.href = targetUrl;
    // Chờ trang load xong
    await waitForPageLoad();
    await sleep(1500);
  }

  return await sendCurrentConversation(message);
}

// ─── Gửi tin nhắn trong conversation hiện tại ─────────────
async function sendCurrentConversation(message) {
  // Chờ input box xuất hiện
  const inputBox = await waitForElement([
    '[contenteditable="true"][role="textbox"]',
    'div[aria-label="Message"][contenteditable="true"]',
    'div[data-lexical-editor="true"]',
    'div[contenteditable="true"].notranslate',
    'div[contenteditable="true"][spellcheck="true"]',
  ], 5000);

  if (!inputBox) {
    return { success: false, error: 'Không tìm thấy ô nhập tin nhắn Messenger' };
  }

  try {
    // Click focus
    inputBox.click();
    inputBox.focus();
    await sleep(200);

    // Xóa nội dung cũ
    inputBox.innerHTML = '';
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(100);

    // Gõ tin nhắn bằng clipboard API (đáng tin cậy nhất với React)
    await typeMessage(inputBox, message);
    await sleep(300);

    // Nhấn Enter để gửi
    const sent = await pressEnterToSend(inputBox);
    if (!sent) {
      return { success: false, error: 'Không thể gửi tin nhắn (Enter không hoạt động)' };
    }

    await sleep(500);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Gõ tin nhắn vào input box ────────────────────────────
async function typeMessage(inputBox, message) {
  // Phương pháp 1: execCommand insertText (hoạt động tốt với Lexical editor)
  inputBox.focus();
  const inserted = document.execCommand('insertText', false, message);

  if (!inserted || inputBox.textContent.trim() !== message.trim()) {
    // Phương pháp 2: DataTransfer / clipboard
    const dt = new DataTransfer();
    dt.setData('text/plain', message);
    inputBox.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
    await sleep(100);
  }

  // Dispatch input event để React/Lexical nhận diện
  inputBox.dispatchEvent(new InputEvent('input', {
    inputType: 'insertText',
    data: message,
    bubbles: true,
    cancelable: true
  }));
}

// ─── Nhấn Enter để gửi ────────────────────────────────────
async function pressEnterToSend(inputBox) {
  // Thử tìm nút Send trước
  const sendSelectors = [
    'button[aria-label="Send"]',
    '[aria-label="Press Enter to send"]',
    '[data-testid="send-button"]',
    'button[type="submit"]',
  ];

  for (const sel of sendSelectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
  }

  // Nhấn Enter
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  inputBox.dispatchEvent(enterEvent);

  await sleep(100);

  inputBox.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    bubbles: true,
    cancelable: true
  }));

  return true;
}

// ─── Helpers ───────────────────────────────────────────────
function waitForElement(selectors, timeout = 5000) {
  return new Promise((resolve) => {
    const check = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };

    const el = check();
    if (el) { resolve(el); return; }

    const observer = new MutationObserver(() => {
      const found = check();
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(check());
    }, timeout);
  });
}

function waitForPageLoad() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') { resolve(); return; }
    window.addEventListener('load', resolve, { once: true });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
