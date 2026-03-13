import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Monitor, Wifi, WifiOff, Play, Square, RefreshCw,
  Copy, CheckCircle2, XCircle, AlertCircle, Loader2,
  MessageSquare, Users, Zap, Eye
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────
interface BotProgress {
  campaignId: number;
  current: number;
  total: number;
  recipientName?: string;
}

interface MessageEvent {
  recipientId: number;
  status: "success" | "failed";
  error?: string;
}

// ─── Component ────────────────────────────────────────────
export default function BotControl() {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [extConnected, setExtConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [progress, setProgress] = useState<BotProgress | null>(null);
  const [recentEvents, setRecentEvents] = useState<{ type: string; name: string; ts: number }[]>([]);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  // ─── tRPC queries ──────────────────────────────────────
  const { data: campaigns } = trpc.campaigns.list.useQuery();
  const { data: session, refetch: refetchSession } = trpc.botSession.get.useQuery();
  const { data: extStatus, refetch: refetchExtStatus } = trpc.botSession.extensionStatus.useQuery(
    undefined,
    { refetchInterval: 3000 }
  );

  const getTokenMutation = trpc.botSession.getExtensionToken.useMutation({
    onSuccess: () => refetchSession(),
  });
  const startBotMutation = trpc.botSession.startBotCampaign.useMutation({
    onSuccess: (data) => {
      toast.success(`Bot bắt đầu gửi ${data.total} tin nhắn`);
      setIsBotRunning(true);
    },
    onError: (e) => toast.error(e.message),
  });
  const sendCommandMutation = trpc.botSession.sendCommand.useMutation({
    onError: (e) => toast.error(e.message),
  });

  // ─── Socket.IO kết nối viewer ──────────────────────────
  useEffect(() => {
    if (!session?.extensionToken) return;

    const serverOrigin = window.location.origin;
    const socket = io(serverOrigin, {
      path: "/socket.io",
      transports: ["websocket"],
    });

    // Kết nối tới namespace viewer
    const viewerSocket = io(`${serverOrigin}/ws/viewer`, {
      transports: ["websocket"],
    });

    socketRef.current = viewerSocket;

    viewerSocket.on("connect", () => {
      setWsConnected(true);
      viewerSocket.emit("auth", { token: session.extensionToken });
    });

    viewerSocket.on("disconnect", () => {
      setWsConnected(false);
    });

    viewerSocket.on("auth_ok", () => {
      console.log("[BotControl] Viewer authenticated");
    });

    viewerSocket.on("extension_connected", (data: { connected: boolean }) => {
      setExtConnected(data.connected);
    });

    viewerSocket.on("stream_started", () => {
      setIsStreaming(true);
      toast.success("Bắt đầu stream màn hình");
    });

    viewerSocket.on("stream_stopped", () => {
      setIsStreaming(false);
    });

    viewerSocket.on("bot_started", () => {
      setIsBotRunning(true);
    });

    viewerSocket.on("bot_stopped", () => {
      setIsBotRunning(false);
      setProgress(null);
    });

    viewerSocket.on("campaign_completed", () => {
      setIsBotRunning(false);
      toast.success("Chiến dịch hoàn thành!");
      setProgress(null);
    });

    viewerSocket.on("bot_progress", (data: BotProgress) => {
      setProgress(data);
    });

    viewerSocket.on("message_sent", (data: MessageEvent & { recipientId: number }) => {
      addEvent("success", `Gửi thành công`);
    });

    viewerSocket.on("message_failed", (data: MessageEvent & { error: string }) => {
      addEvent("failed", `Thất bại: ${data.error?.substring(0, 40)}`);
    });

    // Nhận screen frames và vẽ lên canvas
    viewerSocket.on("screen_frame", (data: { data: string; width: number; height: number }) => {
      setFrameCount(c => c + 1);
      renderFrame(data.data, data.width, data.height);
    });

    viewerSocket.on("bot_error", (data: { message: string }) => {
      toast.error(`Lỗi bot: ${data.message}`);
    });

    return () => {
      viewerSocket.disconnect();
      socket.disconnect();
    };
  }, [session?.extensionToken]);

  // ─── Render frame lên canvas ───────────────────────────
  const renderFrame = useCallback((base64: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!imgRef.current) {
      imgRef.current = new Image();
    }
    const img = imgRef.current;
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }, []);

  const addEvent = (type: string, name: string) => {
    setRecentEvents(prev => [{ type, name, ts: Date.now() }, ...prev.slice(0, 19)]);
  };

  // ─── Handlers ─────────────────────────────────────────
  const handleGetToken = () => getTokenMutation.mutate();

  const handleCopyToken = () => {
    if (session?.extensionToken) {
      navigator.clipboard.writeText(session.extensionToken);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }
  };

  const handleStartStream = () => {
    sendCommandMutation.mutate({ action: "start_stream" });
  };

  const handleStopStream = () => {
    sendCommandMutation.mutate({ action: "stop_stream" });
    setIsStreaming(false);
  };

  const handleStartBot = () => {
    if (!selectedCampaignId) {
      toast.error("Vui lòng chọn chiến dịch");
      return;
    }
    startBotMutation.mutate({ campaignId: parseInt(selectedCampaignId) });
  };

  const handleStopBot = () => {
    sendCommandMutation.mutate({ action: "stop_bot" });
    setIsBotRunning(false);
  };

  const progressPercent = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  const selectedCampaign = campaigns?.find(c => c.id === parseInt(selectedCampaignId));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Monitor className="w-6 h-6 text-indigo-400" />
            Bot Control
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Điều khiển bot và quan sát màn hình Messenger trực tiếp
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={extConnected ? "default" : "secondary"} className={extConnected ? "bg-green-600" : ""}>
            {extConnected ? <><Wifi className="w-3 h-3 mr-1" />Extension đã kết nối</> : <><WifiOff className="w-3 h-3 mr-1" />Extension chưa kết nối</>}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Màn hình stream (2/3) ─────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" />
                  Màn hình Messenger
                  {isStreaming && (
                    <Badge className="bg-red-600 text-white text-xs animate-pulse">
                      ● LIVE
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex gap-2">
                  {!isStreaming ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStartStream}
                      disabled={!extConnected || sendCommandMutation.isPending}
                      className="text-xs"
                    >
                      <Monitor className="w-3 h-3 mr-1" />
                      Bắt đầu stream
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStopStream}
                      className="text-xs text-red-400 border-red-400/30"
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Dừng stream
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "16/9" }}>
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain"
                  style={{ display: isStreaming ? "block" : "none" }}
                />
                {!isStreaming && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-3">
                    <Monitor className="w-16 h-16 opacity-20" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Chưa có stream</p>
                      <p className="text-xs opacity-60 mt-1">
                        {extConnected
                          ? "Nhấn \"Bắt đầu stream\" để xem màn hình Messenger"
                          : "Cài extension và kết nối trước"}
                      </p>
                    </div>
                  </div>
                )}
                {isStreaming && frameCount > 0 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                    {frameCount} frames
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ─── Bot Progress ─────────────────────────────── */}
          {(isBotRunning || progress) && (
            <Card className="bg-card border-border border-indigo-500/30">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    <span className="text-sm font-medium">Bot đang gửi tin nhắn...</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {progress ? `${progress.current}/${progress.total}` : "0/0"}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2 mb-2" />
                {progress?.recipientName && (
                  <p className="text-xs text-muted-foreground">
                    Đang gửi tới: <span className="text-foreground">{progress.recipientName}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ─── Recent Events ────────────────────────────── */}
          {recentEvents.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                  Hoạt động gần đây
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {recentEvents.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1">
                      {e.type === "success"
                        ? <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                        : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                      <span className={e.type === "success" ? "text-green-300" : "text-red-300"}>
                        {e.name}
                      </span>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(e.ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ─── Panel điều khiển (1/3) ───────────────────── */}
        <div className="space-y-4">
          {/* Extension Token */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                Kết nối Extension
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!session?.extensionToken ? (
                <Button
                  onClick={handleGetToken}
                  disabled={getTokenMutation.isPending}
                  className="w-full bg-indigo-600 hover:bg-indigo-700"
                  size="sm"
                >
                  {getTokenMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  Tạo Token kết nối
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2 border border-border">
                    <code className="text-xs text-indigo-300 flex-1 truncate font-mono">
                      {session.extensionToken}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCopyToken}
                      className="h-6 w-6 p-0 shrink-0"
                    >
                      {tokenCopied
                        ? <CheckCircle2 className="w-3 h-3 text-green-400" />
                        : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGetToken}
                    className="w-full text-xs"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Tạo token mới
                  </Button>
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 rounded p-2">
                <p className="font-medium text-foreground">Hướng dẫn:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Cài extension vào Chrome</li>
                  <li>Mở popup extension</li>
                  <li>Nhập URL website này</li>
                  <li>Dán token vào ô Token</li>
                  <li>Nhấn "Kết nối"</li>
                </ol>
              </div>
            </CardContent>
          </Card>

          {/* Chọn chiến dịch & điều khiển bot */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Điều khiển Bot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Chọn chiến dịch</label>
                <Select
                  value={selectedCampaignId}
                  onValueChange={setSelectedCampaignId}
                  disabled={isBotRunning}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Chọn chiến dịch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        <div className="flex items-center gap-2">
                          <span>{c.name}</span>
                          <Badge variant="secondary" className="text-xs">
                            {c.totalRecipients} người
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCampaign && (
                <div className="bg-muted/20 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tổng người nhận</span>
                    <span className="font-medium">{selectedCampaign.totalRecipients}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Delay giữa tin</span>
                    <span className="font-medium">{selectedCampaign.delayBetweenMessages / 1000}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Thử lại tối đa</span>
                    <span className="font-medium">{selectedCampaign.maxRetries} lần</span>
                  </div>
                </div>
              )}

              {!isBotRunning ? (
                <Button
                  onClick={handleStartBot}
                  disabled={!extConnected || !selectedCampaignId || startBotMutation.isPending}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  {startBotMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Bắt đầu gửi tin nhắn
                </Button>
              ) : (
                <Button
                  onClick={handleStopBot}
                  variant="destructive"
                  className="w-full"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Dừng Bot
                </Button>
              )}

              {!extConnected && (
                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 rounded p-2">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>Extension chưa kết nối. Cài extension và kết nối trước khi chạy bot.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Thống kê nhanh */}
          {progress && (
            <Card className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-400">{progress.current}</p>
                    <p className="text-xs text-muted-foreground">Đã gửi</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{progress.total - progress.current}</p>
                    <p className="text-xs text-muted-foreground">Còn lại</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
