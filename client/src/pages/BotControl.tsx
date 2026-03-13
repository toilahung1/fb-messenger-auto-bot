import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Monitor, Play, Square, CheckCircle2, XCircle,
  Loader2, MessageSquare, Users, Zap, Eye, AlertCircle
} from "lucide-react";

interface BotProgress {
  campaignId: number;
  current: number;
  total: number;
}

export default function BotControl() {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [isBotRunning, setIsBotRunning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [progress, setProgress] = useState<BotProgress | null>(null);
  const [recentEvents, setRecentEvents] = useState<{ type: string; name: string; ts: number }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  const { data: campaigns } = trpc.campaigns.list.useQuery();
  const { data: session } = trpc.botSession.get.useQuery();

  const startMutation = trpc.campaigns.start.useMutation({
    onSuccess: () => {
      toast.success("Bot đã bắt đầu gửi tin nhắn");
      setIsBotRunning(true);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const stopMutation = trpc.campaigns.stop.useMutation({
    onSuccess: () => {
      toast.success("Đã dừng bot");
      setIsBotRunning(false);
      setProgress(null);
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  // ─── Socket.IO kết nối viewer ──────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const serverOrigin = window.location.origin;
    const viewerSocket = io(`${serverOrigin}/ws/viewer`, {
      transports: ["websocket"],
    });

    socketRef.current = viewerSocket;

    viewerSocket.on("connect", () => {
      setWsConnected(true);
      viewerSocket.emit("auth", { userId: String(user.id) });
    });

    viewerSocket.on("disconnect", () => {
      setWsConnected(false);
    });

    viewerSocket.on("bot_started", () => setIsBotRunning(true));
    viewerSocket.on("bot_stopped", () => { setIsBotRunning(false); setProgress(null); });
    viewerSocket.on("campaign_completed", () => {
      setIsBotRunning(false);
      setProgress(null);
      toast.success("Chiến dịch hoàn thành!");
    });

    viewerSocket.on("bot_progress", (data: BotProgress) => setProgress(data));

    viewerSocket.on("message_sent", () => addEvent("success", "Gửi thành công"));
    viewerSocket.on("message_failed", (data: { error?: string }) => {
      addEvent("failed", `Thất bại: ${data.error?.substring(0, 40) ?? "Lỗi không xác định"}`);
    });

    // Nhận screen frames từ Puppeteer server-side
    viewerSocket.on("screen_frame", (data: { data: string; width: number; height: number }) => {
      setFrameCount(c => c + 1);
      setIsStreaming(true);
      renderFrame(data.data, data.width, data.height);
    });

    viewerSocket.on("stream_stopped", () => setIsStreaming(false));
    viewerSocket.on("bot_error", (data: { message: string }) => toast.error(`Lỗi bot: ${data.message}`));

    return () => { viewerSocket.disconnect(); };
  }, [user?.id]);

  const renderFrame = useCallback((base64: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!imgRef.current) imgRef.current = new Image();
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

  const handleStartBot = () => {
    if (!selectedCampaignId) { toast.error("Vui lòng chọn chiến dịch"); return; }
    if (!session?.isActive) { toast.error("Chưa có session Facebook. Vào Cài đặt để thêm session."); return; }
    startMutation.mutate({ id: parseInt(selectedCampaignId), safetyLevel: "medium" });
  };

  const handleStopBot = () => {
    if (!selectedCampaignId) return;
    stopMutation.mutate({ id: parseInt(selectedCampaignId) });
  };

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;
  const selectedCampaign = campaigns?.find(c => c.id === parseInt(selectedCampaignId));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Monitor className="w-6 h-6 text-indigo-400" />
              Bot Control
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Điều khiển bot và quan sát màn hình Messenger trực tiếp
            </p>
          </div>
          <Badge variant={wsConnected ? "default" : "secondary"} className={wsConnected ? "bg-green-600" : ""}>
            {wsConnected ? "Đã kết nối" : "Đang kết nối..."}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ─── Màn hình stream (2/3) ─────────────────────── */}
          <div className="lg:col-span-2">
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" />
                  Màn hình Messenger (Live)
                  {isStreaming && (
                    <Badge className="bg-red-600 text-white text-xs animate-pulse">● LIVE</Badge>
                  )}
                  {frameCount > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">{frameCount} frames</span>
                  )}
                </CardTitle>
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
                          {isBotRunning
                            ? "Bot đang chạy, stream sẽ xuất hiện khi Puppeteer mở Messenger..."
                            : "Nhấn Bắt đầu để bot mở Messenger và stream màn hình về đây"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ─── Panel điều khiển (1/3) ────────────────────── */}
          <div className="space-y-4">
            {/* Session status */}
            <Card className="border-border">
              <CardContent className="pt-4">
                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                  session?.isActive
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                }`}>
                  {session?.isActive
                    ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> Session Facebook đang hoạt động</>
                    : <><XCircle className="h-4 w-4 shrink-0" /> Chưa có session Facebook</>
                  }
                </div>
                {!session?.isActive && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Vào <strong>Cài đặt</strong> để thêm session Facebook trước khi chạy bot.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Chọn chiến dịch */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Chọn chiến dịch</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={selectedCampaignId}
                  onValueChange={setSelectedCampaignId}
                  disabled={isBotRunning}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Chọn chiến dịch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns?.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedCampaign && (
                  <div className="text-xs text-muted-foreground space-y-1 bg-muted/20 rounded p-2">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Người nhận</span>
                      <span className="font-medium">{selectedCampaign.totalRecipients ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Đã gửi</span>
                      <span className="font-medium text-green-400">{selectedCampaign.sentCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Delay</span>
                      <span className="font-medium">{(selectedCampaign.delayBetweenMessages / 1000).toFixed(1)}s</span>
                    </div>
                  </div>
                )}

                {/* Start / Stop */}
                {!isBotRunning ? (
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleStartBot}
                    disabled={!selectedCampaignId || !session?.isActive || startMutation.isPending}
                  >
                    {startMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Đang khởi động...</>
                    ) : (
                      <><Play className="w-4 h-4 mr-2" />Bắt đầu Bot</>
                    )}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant="destructive"
                    onClick={handleStopBot}
                    disabled={stopMutation.isPending}
                  >
                    {stopMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Đang dừng...</>
                    ) : (
                      <><Square className="w-4 h-4 mr-2" />Dừng Bot</>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Tiến độ */}
            {progress && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Tiến độ gửi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{progress.current} / {progress.total} tin nhắn</span>
                    <span className="font-medium text-foreground">{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </CardContent>
              </Card>
            )}

            {/* Recent events */}
            {recentEvents.length > 0 && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Hoạt động gần đây</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {recentEvents.map((ev, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {ev.type === "success"
                          ? <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                          : <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                        }
                        <span className="text-muted-foreground truncate">{ev.name}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Hướng dẫn */}
            {!isBotRunning && !progress && (
              <Card className="border-border/50 bg-muted/5">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p className="font-medium text-foreground">Cách sử dụng</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>Thêm session Facebook trong <strong>Cài đặt</strong></li>
                        <li>Tạo chiến dịch và thêm người nhận</li>
                        <li>Chọn chiến dịch và nhấn <strong>Bắt đầu Bot</strong></li>
                        <li>Xem bot hoạt động trực tiếp qua màn hình bên trái</li>
                      </ol>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
