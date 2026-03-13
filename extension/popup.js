// ============================================================
// Popup Script
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

// Load saved settings
chrome.storage.local.get(['serverUrl', 'extensionToken', 'botStatus'], (data) => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.extensionToken) extensionTokenInput.value = data.extensionToken;
  updateUI(data.botStatus || 'disconnected');
});

// Kiểm tra tab Messenger
checkMessengerTab();

// Connect button
connectBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  const token = extensionTokenInput.value.trim();

  if (!url) { alert('Vui lòng nhập URL website'); return; }
  if (!token) { alert('Vui lòng nhập token kết nối'); return; }

  // Lưu vào storage (background sẽ tự kết nối)
  chrome.storage.local.set({ serverUrl: url, extensionToken: token }, () => {
    chrome.runtime.sendMessage({ type: 'connect' });
    updateUI('connected');
  });
});

// Disconnect button
disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'disconnect' });
  updateUI('disconnected');
});

// Open website link
serverUrlInput.addEventListener('input', () => {
  const url = serverUrlInput.value.trim();
  if (url) openWebsiteLink.href = url + '/bot-control';
});

// Lắng nghe cập nhật trạng thái từ background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status_update') {
    updateUI(msg.status);
  }
});

// Polling trạng thái mỗi 2s
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

function updateUI(status) {
  const s = STATUS_MAP[status] || STATUS_MAP.disconnected;
  statusDot.className = 'status-dot ' + s.cls;
  statusLabel.textContent = s.label;
  statusSub.textContent = s.sub;

  const isConnected = status !== 'disconnected';
  connectBtn.style.display = isConnected ? 'none' : 'flex';
  disconnectBtn.style.display = isConnected ? 'flex' : 'none';
}

async function checkMessengerTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://www.messenger.com/*', '*://messenger.com/*']
  });

  if (tabs.length > 0) {
    messengerStatus.className = 'messenger-status found';
    messengerStatusText.textContent = `✓ Tìm thấy tab Messenger (${tabs[0].title?.substring(0, 30) || 'messenger.com'})`;
  } else {
    messengerStatus.className = 'messenger-status not-found';
    messengerStatusText.textContent = '⚠ Chưa mở tab Messenger. Mở messenger.com trước!';
  }
}
