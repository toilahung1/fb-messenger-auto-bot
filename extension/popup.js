// ============================================================
// Popup Script - Auto-save thông tin, không bao giờ mất dữ liệu
// ============================================================

const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const statusSub = document.getElementById('statusSub');
const messengerStatus = document.getElementById('messengerStatus');
const messengerStatusText = document.getElementById('messengerStatusText');
const serverUrlInput = document.getElementById('serverUrl');
const extensionTokenInput = document.getElementById('extensionToken');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const openWebsiteLink = document.getElementById('openWebsite');

const STATUS_MAP = {
  connected: { label: 'Đã kết nối với website', sub: 'Sẵn sàng nhận lệnh', cls: 'connected' },
  streaming: { label: 'Đang stream màn hình', sub: 'Tab Messenger đang được quay', cls: 'streaming' },
  bot_running: { label: 'Bot đang chạy', sub: 'Đang gửi tin nhắn...', cls: 'bot_running' },
  disconnected: { label: 'Chưa kết nối', sub: 'Nhập URL server để bắt đầu', cls: 'disconnected' },
};

// ─── Load saved settings ngay khi popup mở ────────────────
chrome.storage.local.get(['serverUrl', 'extensionToken', 'botStatus'], (data) => {
  if (data.serverUrl) {
    serverUrlInput.value = data.serverUrl;
    if (openWebsiteLink) openWebsiteLink.href = data.serverUrl + '/bot-control';
  }
  if (data.extensionToken) {
    extensionTokenInput.value = data.extensionToken;
  }
  // Lấy trạng thái thực tế từ background
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    if (response) {
      const status = response.isBotRunning ? 'bot_running'
        : response.isStreaming ? 'streaming'
        : response.wsConnected ? 'connected'
        : 'disconnected';
      updateUI(status);
    } else {
      updateUI(data.botStatus || 'disconnected');
    }
  });
});

// ─── Auto-save khi gõ (không cần nhấn nút) ───────────────
serverUrlInput.addEventListener('input', () => {
  const url = serverUrlInput.value.trim();
  // Lưu ngay vào storage
  chrome.storage.local.set({ serverUrl: url });
  if (url && openWebsiteLink) openWebsiteLink.href = url + '/bot-control';
});

extensionTokenInput.addEventListener('input', () => {
  const token = extensionTokenInput.value.trim();
  // Lưu ngay vào storage
  chrome.storage.local.set({ extensionToken: token });
});

// ─── Kiểm tra tab Messenger ────────────────────────────────
checkMessengerTab();

// ─── Connect button ────────────────────────────────────────
connectBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  const token = extensionTokenInput.value.trim();

  if (!url) {
    showInputError(serverUrlInput, 'Vui lòng nhập URL website');
    return;
  }
  if (!token) {
    showInputError(extensionTokenInput, 'Vui lòng nhập token kết nối');
    return;
  }

  // Đã lưu rồi (auto-save), chỉ cần trigger kết nối
  chrome.storage.local.set({ serverUrl: url, extensionToken: token }, () => {
    chrome.runtime.sendMessage({ type: 'connect' });
    updateUI('connected');
  });
});

// ─── Disconnect button ─────────────────────────────────────
disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' });
  updateUI('disconnected');
});

// ─── Lắng nghe cập nhật trạng thái từ background ──────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status_update') {
    updateUI(msg.status);
    // Lưu trạng thái để hiển thị đúng lần mở tiếp theo
    chrome.storage.local.set({ botStatus: msg.status });
  }
});

// ─── Polling trạng thái mỗi 2s ────────────────────────────
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
    if (response) {
      const status = response.isBotRunning ? 'bot_running'
        : response.isStreaming ? 'streaming'
        : response.wsConnected ? 'connected'
        : 'disconnected';
      updateUI(status);
    }
  });
}, 2000);

// ─── Helpers ───────────────────────────────────────────────
function updateUI(status) {
  const s = STATUS_MAP[status] || STATUS_MAP.disconnected;
  statusDot.className = 'status-dot ' + s.cls;
  statusLabel.textContent = s.label;
  statusSub.textContent = s.sub;

  const isConnected = status !== 'disconnected';
  connectBtn.style.display = isConnected ? 'none' : 'flex';
  disconnectBtn.style.display = isConnected ? 'flex' : 'none';
}

function showInputError(input, message) {
  input.style.borderColor = '#ef4444';
  input.placeholder = message;
  input.focus();
  setTimeout(() => {
    input.style.borderColor = '';
    input.placeholder = input.id === 'serverUrl'
      ? 'https://your-website.manus.space'
      : 'Token từ trang Bot Control';
  }, 3000);
}

async function checkMessengerTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://www.messenger.com/*',
        '*://messenger.com/*',
        '*://www.facebook.com/*',
        '*://facebook.com/*',
      ]
    });

    if (tabs.length > 0) {
      messengerStatus.className = 'messenger-status found';
      messengerStatusText.textContent = `✓ Tìm thấy tab Facebook/Messenger`;
    } else {
      messengerStatus.className = 'messenger-status not-found';
      messengerStatusText.textContent = '⚠ Chưa mở tab Facebook. Mở facebook.com trước!';
    }
  } catch (e) {
    // Ignore permission errors
  }
}
