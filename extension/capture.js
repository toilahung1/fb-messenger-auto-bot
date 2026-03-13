// ============================================================
// Offscreen Document - Tab Capture & Stream
// Nhận MediaStream từ tabCapture, encode thành JPEG frames
// và gửi về server qua WebSocket
// ============================================================

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let ws = null;
let captureStream = null;
let frameTimer = null;
let serverUrl = null;
let extensionToken = null;

// FPS cho stream (15fps = 1 frame mỗi 67ms)
const STREAM_FPS = 15;
const FRAME_QUALITY = 0.6; // JPEG quality 0-1

// Lắng nghe lệnh từ background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start_capture') {
    serverUrl = msg.serverUrl;
    extensionToken = msg.extensionToken;
    startCapture(msg.streamId);
  }
  if (msg.type === 'stop_capture') {
    stopCapture();
  }
});

async function startCapture(streamId) {
  try {
    // Lấy MediaStream từ streamId (do tabCapture cung cấp)
    captureStream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          maxWidth: 1280,
          maxHeight: 720,
          maxFrameRate: STREAM_FPS
        }
      },
      audio: false
    });

    video.srcObject = captureStream;
    await video.play();

    // Kết nối WebSocket để gửi frames
    connectStreamWS();
  } catch (e) {
    console.error('[Capture] Error:', e);
    chrome.runtime.sendMessage({ type: 'capture_error', error: e.message });
  }
}

function connectStreamWS() {
  const wsUrl = serverUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws/stream';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Capture] Stream WS connected');
    // Xác thực
    ws.send(JSON.stringify({ type: 'auth', token: extensionToken, role: 'streamer' }));
    // Bắt đầu gửi frames
    startFrameLoop();
  };

  ws.onclose = () => {
    console.log('[Capture] Stream WS closed');
    stopFrameLoop();
    // Thử kết nối lại sau 3s
    setTimeout(connectStreamWS, 3000);
  };

  ws.onerror = (e) => {
    console.error('[Capture] Stream WS error:', e);
  };
}

function startFrameLoop() {
  stopFrameLoop();
  frameTimer = setInterval(captureAndSendFrame, 1000 / STREAM_FPS);
}

function stopFrameLoop() {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
}

function captureAndSendFrame() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!video.videoWidth || !video.videoHeight) return;

  try {
    // Resize canvas nếu cần
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Vẽ frame hiện tại lên canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Encode thành JPEG base64
    const dataUrl = canvas.toDataURL('image/jpeg', FRAME_QUALITY);
    const base64 = dataUrl.split(',')[1];

    // Gửi frame qua WebSocket
    ws.send(JSON.stringify({
      type: 'frame',
      data: base64,
      width: canvas.width,
      height: canvas.height,
      ts: Date.now()
    }));
  } catch (e) {
    // Bỏ qua lỗi frame đơn lẻ
  }
}

function stopCapture() {
  stopFrameLoop();
  if (captureStream) {
    captureStream.getTracks().forEach(t => t.stop());
    captureStream = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  video.srcObject = null;
}
