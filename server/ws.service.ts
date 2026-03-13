// ============================================================
// WebSocket Service - Socket.IO Server
// Quản lý kết nối 2 chiều giữa:
//   - Chrome Extension (gửi screen frames, nhận lệnh bot)
//   - Website clients (nhận live stream, gửi lệnh điều khiển)
// ============================================================

import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { getDb } from "./db";
import { botSessions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./_core/env";

// Map: extensionToken → socket của extension
const extensionSockets = new Map<string, Socket>();
// Map: extensionToken → set of website viewer sockets
const viewerSockets = new Map<string, Set<Socket>>();
// Map: extensionToken → campaign running state
const runningCampaigns = new Map<string, { campaignId: number; current: number; total: number }>();
// Map: extensionToken → pending cookies request resolve
type CookiesResult = { success: boolean; cookies?: unknown[]; error?: string; cookieCount?: number };
const pendingCookiesRequests = new Map<string, (result: CookiesResult) => void>();

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

  // ─── Namespace: Extension (/ws/extension) ─────────────────
  const extNs = io.of("/ws/extension");
  extNs.on("connection", (socket) => {
    console.log(`[WS] Extension connected: ${socket.id}`);
    let authenticatedToken: string | null = null;

    socket.on("auth", async (data: { token: string }) => {
      const token = data?.token;
      if (!token) { socket.disconnect(); return; }

      // Verify token từ database
      const valid = await verifyExtensionToken(token);
      if (!valid) {
        socket.emit("auth_error", { message: "Token không hợp lệ" });
        socket.disconnect();
        return;
      }

      authenticatedToken = token;
      extensionSockets.set(token, socket);
      socket.emit("auth_ok", { message: "Kết nối thành công" });

      // Thông báo tới viewers
      broadcastToViewers(token, "extension_connected", { connected: true });
      console.log(`[WS] Extension authenticated: ${token.substring(0, 8)}...`);
    });

    // Nhận screen frame từ extension → relay tới viewers
    socket.on("screen_frame", (data: { data: string; width: number; height: number; ts: number }) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "screen_frame", data);
    });

    // Nhận kết quả gửi tin nhắn từ extension
    socket.on("message_sent", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "message_sent", data);
      // Cập nhật progress
      const campaign = runningCampaigns.get(authenticatedToken);
      if (campaign && data.campaignId === campaign.campaignId) {
        campaign.current++;
        broadcastToViewers(authenticatedToken, "bot_progress", {
          campaignId: campaign.campaignId,
          current: campaign.current,
          total: campaign.total,
        });
      }
    });

    socket.on("message_failed", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "message_failed", data);
    });

    socket.on("progress", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "bot_progress", data);
    });

    socket.on("bot_started", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "bot_started", data);
    });

    socket.on("bot_stopped", () => {
      if (!authenticatedToken) return;
      runningCampaigns.delete(authenticatedToken);
      broadcastToViewers(authenticatedToken, "bot_stopped", {});
    });

    socket.on("campaign_completed", (data) => {
      if (!authenticatedToken) return;
      runningCampaigns.delete(authenticatedToken);
      broadcastToViewers(authenticatedToken, "campaign_completed", data);
    });

    socket.on("stream_started", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "stream_started", data);
    });

    socket.on("stream_stopped", () => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "stream_stopped", {});
    });

    socket.on("error_report", (data) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "bot_error", data);
    });

    socket.on("pong", () => {
      // Extension alive
    });

    // Nhận kết quả cookies từ extension
    socket.on("cookies_result", (data: CookiesResult) => {
      if (!authenticatedToken) return;
      const resolve = pendingCookiesRequests.get(authenticatedToken);
      if (resolve) {
        pendingCookiesRequests.delete(authenticatedToken);
        resolve(data);
      }
      // Cũng broadcast tới viewers để cập nhật UI
      broadcastToViewers(authenticatedToken, "cookies_result", data);
    });

    socket.on("disconnect", () => {
      if (authenticatedToken) {
        extensionSockets.delete(authenticatedToken);
        runningCampaigns.delete(authenticatedToken);
        broadcastToViewers(authenticatedToken, "extension_connected", { connected: false });
        console.log(`[WS] Extension disconnected: ${authenticatedToken.substring(0, 8)}...`);
      }
    });
  });

  // ─── Namespace: Stream (/ws/stream) ───────────────────────
  // Dùng cho offscreen document gửi frames trực tiếp
  const streamNs = io.of("/ws/stream");
  streamNs.on("connection", (socket) => {
    let authenticatedToken: string | null = null;

    socket.on("auth", async (data: { token: string; role: string }) => {
      const valid = await verifyExtensionToken(data?.token);
      if (!valid) { socket.disconnect(); return; }
      authenticatedToken = data.token;
      socket.emit("auth_ok");
    });

    socket.on("frame", (data: { data: string; width: number; height: number; ts: number }) => {
      if (!authenticatedToken) return;
      broadcastToViewers(authenticatedToken, "screen_frame", data);
    });

    socket.on("disconnect", () => {
      // stream disconnected
    });
  });

  // ─── Namespace: Viewer (/ws/viewer) ───────────────────────
  const viewerNs = io.of("/ws/viewer");
  viewerNs.on("connection", (socket) => {
    let viewerToken: string | null = null;

    socket.on("auth", async (data: { token: string }) => {
      const valid = await verifyExtensionToken(data?.token);
      if (!valid) { socket.disconnect(); return; }

      viewerToken = data.token;
      if (!viewerSockets.has(viewerToken)) {
        viewerSockets.set(viewerToken, new Set());
      }
      viewerSockets.get(viewerToken)!.add(socket);
      socket.emit("auth_ok");

      // Thông báo trạng thái extension hiện tại
      const extConnected = extensionSockets.has(viewerToken);
      socket.emit("extension_connected", { connected: extConnected });

      // Thông báo campaign đang chạy nếu có
      const campaign = runningCampaigns.get(viewerToken);
      if (campaign) {
        socket.emit("bot_started", { campaignId: campaign.campaignId });
      }
    });

    // Nhận lệnh từ viewer → forward tới extension
    socket.on("command", (data: { action: string; payload?: unknown }) => {
      if (!viewerToken) return;
      const extSocket = extensionSockets.get(viewerToken);
      if (!extSocket) {
        socket.emit("command_error", { message: "Extension chưa kết nối" });
        return;
      }

      switch (data.action) {
        case "start_stream":
          extSocket.emit("start_stream", data.payload);
          break;
        case "stop_stream":
          extSocket.emit("stop_stream");
          break;
        case "start_bot":
          const botPayload = data.payload as { campaignId: number; recipients: unknown[]; total: number };
          runningCampaigns.set(viewerToken, {
            campaignId: botPayload.campaignId,
            current: 0,
            total: botPayload.total,
          });
          extSocket.emit("start_bot", data.payload);
          break;
        case "stop_bot":
          extSocket.emit("stop_bot");
          runningCampaigns.delete(viewerToken);
          break;
        case "ping":
          extSocket.emit("ping");
          break;
      }
    });

    socket.on("disconnect", () => {
      if (viewerToken) {
        viewerSockets.get(viewerToken)?.delete(socket);
      }
    });
  });

  console.log("[WS] Socket.IO server initialized");
  return io;
}

// ─── Helper: broadcast tới tất cả viewers của 1 token ─────
function broadcastToViewers(token: string, event: string, data: unknown) {
  const viewers = viewerSockets.get(token);
  if (!viewers) return;
  viewers.forEach((s) => {
    if (s.connected) s.emit(event, data);
  });
}

// ─── Verify extension token từ database ───────────────────
async function verifyExtensionToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const sessions = await db
      .select()
      .from(botSessions)
      .where(eq(botSessions.extensionToken, token))
      .limit(1);
    return sessions.length > 0;
  } catch (e) {
    console.error("[WS] Token verify error:", e);
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────
export function getExtensionStatus(token: string) {
  return {
    connected: extensionSockets.has(token),
    streaming: false, // tracked by extension events
    botRunning: runningCampaigns.has(token),
    campaign: runningCampaigns.get(token) || null,
  };
}

export function sendCommandToExtension(token: string, command: string, payload?: unknown) {
  const socket = extensionSockets.get(token);
  if (!socket) return false;
  socket.emit(command, payload);
  return true;
}

// Yêu cầu extension lấy cookies, chờ kết quả (timeout 15s)
export function requestCookiesFromExtension(token: string): Promise<CookiesResult> {
  return new Promise((resolve, reject) => {
    const socket = extensionSockets.get(token);
    if (!socket) {
      resolve({ success: false, error: 'Extension chưa kết nối. Vui lòng mở extension và kết nối trước.' });
      return;
    }

    // Đăng ký callback
    pendingCookiesRequests.set(token, resolve);

    // Gửi lệnh get_cookies tới extension
    socket.emit('get_cookies');

    // Timeout sau 15 giây
    setTimeout(() => {
      if (pendingCookiesRequests.has(token)) {
        pendingCookiesRequests.delete(token);
        resolve({ success: false, error: 'Hết thời gian chờ. Extension không phản hồi.' });
      }
    }, 15000);
  });
}
