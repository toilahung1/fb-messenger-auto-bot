// ============================================================
// Messenger Auto Bot - Background Service Worker
// Quản lý: WebSocket kết nối tới server, tab capture stream,
// relay lệnh 2 chiều giữa website và content script
// ============================================================

let ws = null;
let serverUrl = null;
let extensionToken = null;
let captureTabId = null;
let mediaRecorder = null;
let captureStream = null;
let isStreaming = false;
let isBotRunning = false;
let reconnectTimer = null;
let offscreenDocCreated = false;

// ─── Khởi tạo từ storage ───────────────────────────────────
chrome.storage.local.get(['serverUrl', 'extensionToken'], (data) => {
  serverUrl = data.serverUrl || null;
  extensionToken = data.extensionToken || null;
  if (serverUrl && extensionToken) {
    connectWebSocket();
  }
});

// ─── Lắng nghe thay đổi storage ───────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl) serverUrl = changes.serverUrl.newValue;
  if (changes.extensionToken) extensionToken = changes.extensionToken.newValue;
  if (serverUrl && extensionToken) {
    disconnectWebSocket();
    connectWebSocket();
  }
});

// ─── WebSocket ─────────────────────────────────────────────
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    // Chuyển https → wss, http → ws
    const wsUrl = serverUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws/extension';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Bot] WebSocket connected');
      clearTimeout(reconnectTimer);
      // Xác thực với server
      sendToServer({ type: 'auth', token: extensionToken });
      updatePopupStatus('connected');
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleServerMessage(msg);
      } catch (e) {
        console.error('[Bot] Message parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Bot] WebSocket disconnected, reconnecting in 5s...');
      updatePopupStatus('disconnected');
      reconnectTimer = setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (err) => {
      console.error('[Bot] WebSocket error:', err);
    };
  } catch (e) {
    console.error('[Bot] Connect error:', e);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function sendToServer(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Xử lý lệnh từ server ──────────────────────────────────
async function handleServerMessage(msg) {
  console.log('[Bot] Server message:', msg.type);

  switch (msg.type) {
    case 'auth_ok':
      console.log('[Bot] Auth OK');
      break;

    case 'start_stream': {
      // Tìm tab Messenger đang mở
      const tabs = await chrome.tabs.query({
        url: ['*://www.messenger.com/*', '*://messenger.com/*']
      });
      if (tabs.length === 0) {
        sendToServer({ type: 'error', message: 'Không tìm thấy tab Messenger. Vui lòng mở messenger.com trước.' });
        return;
      }
      captureTabId = tabs[0].id;
      await startTabCapture(captureTabId);
      break;
    }

    case 'stop_stream':
      stopTabCapture();
      break;

    case 'start_bot': {
      const { campaignId, recipients, messageTemplate, delay, maxRetries } = msg;
      isBotRunning = true;
      updatePopupStatus('bot_running');
      sendToServer({ type: 'bot_started', campaignId });
      await runBotCampaign({ campaignId, recipients, messageTemplate, delay, maxRetries });
      break;
    }

    case 'stop_bot':
      isBotRunning = false;
      updatePopupStatus('connected');
      sendToServer({ type: 'bot_stopped' });
      break;

    case 'ping':
      sendToServer({ type: 'pong' });
      break;
  }
}

// ─── Tab Capture & Stream ───────────────────────────────────
async function startTabCapture(tabId) {
  try {
    // Dùng tabCapture API để lấy stream từ tab
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(id);
      });
    });

    // Tạo offscreen document để xử lý MediaStream (service worker không có DOM)
    await ensureOffscreenDocument();

    // Gửi streamId sang offscreen để bắt đầu capture
    chrome.runtime.sendMessage({
      type: 'start_capture',
      streamId,
      serverUrl,
      extensionToken
    });

    isStreaming = true;
    sendToServer({ type: 'stream_started', tabId });
    updatePopupStatus('streaming');
  } catch (e) {
    console.error('[Bot] Tab capture error:', e);
    sendToServer({ type: 'error', message: 'Không thể capture tab: ' + e.message });
  }
}

function stopTabCapture() {
  if (offscreenDocCreated) {
    chrome.runtime.sendMessage({ type: 'stop_capture' });
  }
  isStreaming = false;
  captureTabId = null;
  sendToServer({ type: 'stream_stopped' });
  updatePopupStatus('connected');
}

async function ensureOffscreenDocument() {
  if (offscreenDocCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'capture.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab screen and stream to WebSocket server'
    });
    offscreenDocCreated = true;
  } catch (e) {
    // Đã tồn tại
    offscreenDocCreated = true;
  }
}

// ─── Bot Campaign Runner ────────────────────────────────────
async function runBotCampaign({ campaignId, recipients, messageTemplate, delay, maxRetries }) {
  for (let i = 0; i < recipients.length; i++) {
    if (!isBotRunning) break;

    const recipient = recipients[i];
    let success = false;
    let lastError = '';

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!isBotRunning) break;

      try {
        // Tìm tab Messenger
        const tabs = await chrome.tabs.query({
          url: ['*://www.messenger.com/*', '*://messenger.com/*']
        });
        if (tabs.length === 0) throw new Error('Không tìm thấy tab Messenger');

        const tabId = tabs[0].id;

        // Interpolate message
        const message = interpolateMessage(messageTemplate, recipient);

        // Inject và thực thi script gửi tin nhắn
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: sendMessengerMessage,
          args: [recipient.facebookUrl || recipient.facebookUid, message]
        });

        const result = results[0]?.result;
        if (result?.success) {
          success = true;
          sendToServer({
            type: 'message_sent',
            campaignId,
            recipientId: recipient.id,
            attempt,
            status: 'success'
          });
          break;
        } else {
          lastError = result?.error || 'Unknown error';
          if (attempt < maxRetries) {
            await sleep(2000);
          }
        }
      } catch (e) {
        lastError = e.message;
        if (attempt < maxRetries) {
          await sleep(2000);
        }
      }
    }

    if (!success) {
      sendToServer({
        type: 'message_failed',
        campaignId,
        recipientId: recipient.id,
        error: lastError
      });
    }

    // Tiến độ
    sendToServer({
      type: 'progress',
      campaignId,
      current: i + 1,
      total: recipients.length,
      recipientName: recipient.name
    });

    // Delay giữa các tin nhắn
    if (i < recipients.length - 1 && isBotRunning) {
      await sleep(delay);
    }
  }

  if (isBotRunning) {
    isBotRunning = false;
    sendToServer({ type: 'campaign_completed', campaignId });
    updatePopupStatus('connected');
  }
}

// ─── Hàm inject vào tab Messenger (chạy trong context của tab) ──
function sendMessengerMessage(targetUrl, message) {
  return new Promise((resolve) => {
    try {
      // Nếu đang ở đúng conversation → gửi luôn
      const isCorrectConversation = targetUrl
        ? window.location.href.includes(targetUrl.replace('https://www.messenger.com', '').replace('https://messenger.com', ''))
        : true;

      if (!isCorrectConversation) {
        // Điều hướng đến conversation
        if (targetUrl) {
          window.location.href = targetUrl;
          // Chờ trang load
          setTimeout(() => tryToSendMessage(message, resolve), 3000);
          return;
        }
      }

      tryToSendMessage(message, resolve);
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });

  function tryToSendMessage(msg, resolve) {
    try {
      // Tìm input box của Messenger
      const selectors = [
        '[contenteditable="true"][role="textbox"]',
        'div[aria-label="Message"][contenteditable="true"]',
        'div[data-lexical-editor="true"]',
        'div[contenteditable="true"].notranslate',
      ];

      let inputBox = null;
      for (const sel of selectors) {
        inputBox = document.querySelector(sel);
        if (inputBox) break;
      }

      if (!inputBox) {
        resolve({ success: false, error: 'Không tìm thấy ô nhập tin nhắn' });
        return;
      }

      // Focus vào input
      inputBox.focus();
      inputBox.click();

      // Xóa nội dung cũ và gõ tin nhắn mới
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // Gõ từng ký tự để trigger React state
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'textContent')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputBox, msg);
      } else {
        inputBox.textContent = msg;
      }

      // Dispatch input event để React nhận diện
      inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: msg }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));

      // Chờ React cập nhật rồi nhấn Enter
      setTimeout(() => {
        try {
          // Tìm nút Send hoặc nhấn Enter
          const sendButton = document.querySelector('[aria-label="Press Enter to send"]') ||
            document.querySelector('button[aria-label="Send"]') ||
            document.querySelector('[data-testid="send-button"]');

          if (sendButton) {
            sendButton.click();
          } else {
            // Nhấn Enter
            inputBox.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13,
              bubbles: true, cancelable: true
            }));
            inputBox.dispatchEvent(new KeyboardEvent('keyup', {
              key: 'Enter', code: 'Enter', keyCode: 13,
              bubbles: true, cancelable: true
            }));
          }

          setTimeout(() => resolve({ success: true }), 500);
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      }, 300);
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────
function interpolateMessage(template, recipient) {
  const now = new Date();
  return template
    .replace(/\{\{name\}\}/g, recipient.name || '')
    .replace(/\{\{firstName\}\}/g, (recipient.name || '').split(' ').pop() || '')
    .replace(/\{\{date\}\}/g, now.toLocaleDateString('vi-VN'))
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updatePopupStatus(status) {
  chrome.storage.local.set({ botStatus: status });
  // Broadcast tới popup nếu đang mở
  chrome.runtime.sendMessage({ type: 'status_update', status }).catch(() => {});
}

// ─── Lắng nghe từ popup ────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_status') {
    chrome.storage.local.get(['botStatus', 'serverUrl', 'extensionToken'], (data) => {
      sendResponse({
        status: data.botStatus || 'disconnected',
        serverUrl: data.serverUrl,
        hasToken: !!data.extensionToken,
        wsConnected: ws?.readyState === WebSocket.OPEN,
        isStreaming,
        isBotRunning
      });
    });
    return true;
  }

  if (msg.type === 'connect') {
    connectWebSocket();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'disconnect') {
    disconnectWebSocket();
    updatePopupStatus('disconnected');
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'offscreen_frame') {
    // Frame từ offscreen document → forward tới server
    sendToServer({ type: 'screen_frame', data: msg.data });
  }
});
