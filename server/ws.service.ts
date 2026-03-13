// ============================================================
// WebSocket Service - Socket.IO Server
// Quản lý kết nối giữa Puppeteer server-side và website clients
// Không còn dùng Chrome Extension
// ============================================================

import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";

// Map: userId → set of viewer sockets
const viewerSockets = new Map<string, Set<Socket>>();

// Map: userId → campaign running state
const runningCampaigns = new Map<string, { campaignId: number; current: number; total: number }>();

let io: SocketIOServer | null = null;

export function initWebSocketServer(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5MB cho frames
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // ─── Namespace: Viewer (/ws/viewer) ───────────────────────
  // Website clients kết nối để nhận live stream và gửi lệnh
  const viewerNs = io.of("/ws/viewer");
  viewerNs.on("connection", (socket) => {
    let userId: string | null = null;

    socket.on("auth", (data: { userId: string }) => {
      if (!data?.userId) { socket.disconnect(); return; }
      userId = String(data.userId);
      if (!viewerSockets.has(userId)) {
        viewerSockets.set(userId, new Set());
      }
      viewerSockets.get(userId)!.add(socket);
      socket.emit("auth_ok");

      // Thông báo campaign đang chạy nếu có
      const campaign = runningCampaigns.get(userId);
      if (campaign) {
        socket.emit("bot_started", { campaignId: campaign.campaignId });
      }
    });

    socket.on("disconnect", () => {
      if (userId) {
        viewerSockets.get(userId)?.delete(socket);
      }
    });
  });

  console.log("[WS] Socket.IO server initialized (Puppeteer-only mode)");
  return io;
}

// ─── Public API: broadcast từ Puppeteer service tới viewers ─
export function broadcastToUser(userId: string | number, event: string, data: unknown) {
  const key = String(userId);
  const viewers = viewerSockets.get(key);
  if (!viewers) return;
  viewers.forEach((s) => {
    if (s.connected) s.emit(event, data);
  });
}

export function setRunningCampaign(userId: string | number, campaignId: number, total: number) {
  const key = String(userId);
  runningCampaigns.set(key, { campaignId, current: 0, total });
}

export function updateCampaignProgress(userId: string | number, current: number) {
  const key = String(userId);
  const campaign = runningCampaigns.get(key);
  if (campaign) {
    campaign.current = current;
    broadcastToUser(key, "bot_progress", {
      campaignId: campaign.campaignId,
      current: campaign.current,
      total: campaign.total,
    });
  }
}

export function clearRunningCampaign(userId: string | number) {
  runningCampaigns.delete(String(userId));
}

export function getRunningCampaign(userId: string | number) {
  return runningCampaigns.get(String(userId)) || null;
}

export function getIo() {
  return io;
}
