import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Shield,
  CheckCircle,
  XCircle,
  Trash2,
  Save,
  Info,
  ExternalLink,
  Download,
  Puzzle,
  Wand2,
  Cookie,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

export default function Settings() {
  const utils = trpc.useUtils();
  const { data: session, isLoading } = trpc.botSession.get.useQuery();
  const { data: notifications } = trpc.notifications.list.useQuery();
  const unreadCount = trpc.notifications.unreadCount.useQuery();

  const saveMutation = trpc.botSession.save.useMutation({
    onSuccess: () => {
      utils.botSession.get.invalidate();
      setSessionInput("");
      toast.success("Session Facebook đã được lưu thành công");
    },
    onError: (e) => toast.error(e.message),
  });

  const extractCookiesMutation = trpc.botSession.extractCookies.useMutation({
    onSuccess: (data) => {
      utils.botSession.get.invalidate();
      setFacebookUrl("");
      toast.success(data.message || `Đã lấy thành công ${data.cookieCount} cookies!`);
    },
    onError: (e) => {
      toast.error(e.message, { duration: 6000 });
    },
  });

  const deleteMutation = trpc.botSession.delete.useMutation({
    onSuccess: () => {
      utils.botSession.get.invalidate();
      toast.success("Đã xóa session Facebook");
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const [sessionInput, setSessionInput] = useState("");
  const [showDeleteSession, setShowDeleteSession] = useState(false);
  const [facebookUrl, setFacebookUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"auto" | "manual">("auto");

  const requestCookiesMutation = trpc.botSession.requestCookiesFromExtension.useMutation({
    onSuccess: (data) => {
      utils.botSession.get.invalidate();
      toast.success(data.message || `Đã lấy thành công ${data.cookieCount} cookies từ extension!`);
    },
    onError: (e) => {
      toast.error(e.message, { duration: 6000 });
    },
  });

  const { data: extStatus } = trpc.botSession.extensionStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold">Cài đặt</h1>
          <p className="text-muted-foreground mt-1">Cấu hình session Facebook và quản lý thông báo</p>
        </div>

        {/* Facebook Session */}
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Phiên đăng nhập Facebook</CardTitle>
            </div>
            <CardDescription>
              Bot cần cookies phiên đăng nhập Facebook để gửi tin nhắn. Session sẽ được mã hóa và lưu trữ an toàn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Status */}
            {!isLoading && (
              <div className={`flex items-center gap-3 p-3 rounded-lg ${session?.isActive ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                {session?.isActive ? (
                  <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                )}
                <div>
                  <p className={`text-sm font-medium ${session?.isActive ? "text-green-400" : "text-red-400"}`}>
                    {session?.isActive ? "Session đang hoạt động" : "Chưa có session"}
                  </p>
                  {session?.lastVerified && (
                    <p className="text-xs text-muted-foreground">
                      Xác minh lần cuối: {format(new Date(session.lastVerified), "HH:mm dd/MM/yyyy")}
                    </p>
                  )}
                </div>
                {session?.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-red-400 hover:text-red-300"
                    onClick={() => setShowDeleteSession(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            {/* Tab switcher */}
            <div className="flex rounded-lg border border-border/50 overflow-hidden">
              <button
                onClick={() => setActiveTab("auto")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "auto"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                }`}
              >
                <Wand2 className="h-4 w-4" />
                Tự động lấy cookies
              </button>
              <button
                onClick={() => setActiveTab("manual")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "manual"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                }`}
              >
                <Cookie className="h-4 w-4" />
                Dán cookies thủ công
              </button>
            </div>

            {/* Auto extract tab */}
            {activeTab === "auto" && (
              <div className="space-y-4">

                {/* Phương thức 1: Lấy cookies qua Extension (khuyến nghị) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground">1</div>
                    <p className="text-sm font-semibold">Lấy cookies qua Extension <span className="text-xs text-green-400 font-normal">(Khuyến nghị)</span></p>
                  </div>

                  {/* Trạng thái extension */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                    extStatus?.connected
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
                  }`}>
                    <div className={`h-2 w-2 rounded-full ${
                      extStatus?.connected ? "bg-green-400 animate-pulse" : "bg-yellow-400"
                    }`} />
                    {extStatus?.connected
                      ? "Extension đang kết nối — sẵn sàng lấy cookies"
                      : "Extension chưa kết nối — xem hướng dẫn bên dưới"}
                  </div>

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-blue-300 font-medium">Cách thực hiện:</p>
                    <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
                      <li>Cài Chrome Extension (xem hướng dẫn bên dưới)</li>
                      <li>Mở tab <strong>facebook.com</strong> hoặc <strong>messenger.com</strong> và đăng nhập</li>
                      <li>Nhấn nút "Ự động lấy cookies qua Extension" bên dưới</li>
                    </ol>
                  </div>

                  <Button
                    onClick={() => requestCookiesMutation.mutate()}
                    disabled={requestCookiesMutation.isPending || !extStatus?.connected}
                    className="w-full"
                  >
                    {requestCookiesMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Đang lấy cookies từ extension...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4 mr-2" />
                        {extStatus?.connected ? "Ự động lấy cookies qua Extension" : "Cần kết nối Extension trước"}
                      </>
                    )}
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/30" /></div>
                  <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">hoặc</span></div>
                </div>

                {/* Phương thức 2: Puppeteer headless (fallback) */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">2</div>
                    <p className="text-sm font-semibold text-muted-foreground">Lấy bằng trình duyệt ẩn <span className="text-xs font-normal">(chỉ khi server chạy local)</span></p>
                  </div>

                  <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-400/80">
                      Phương thức này mở trình duyệt ẩn riêng biệt — <strong>không chia sẻ cookies với Chrome của bạn</strong>. Chỉ dùng khi server chạy trên máy tính của bạn và đã có profile Chrome đăng nhập sẵn.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="fb-url">Link Facebook</Label>
                    <Input
                      id="fb-url"
                      placeholder="https://www.facebook.com hoặc https://messenger.com"
                      value={facebookUrl}
                      onChange={(e) => setFacebookUrl(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!facebookUrl.trim()) { toast.error("Vui lòng nhập link Facebook"); return; }
                      extractCookiesMutation.mutate({ url: facebookUrl.trim() });
                    }}
                    disabled={extractCookiesMutation.isPending || !facebookUrl.trim()}
                    className="w-full"
                  >
                    {extractCookiesMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang mở trình duyệt... (15-30 giây)</>
                    ) : (
                      <><Wand2 className="h-4 w-4 mr-2" />Lấy bằng trình duyệt ẩn</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Manual tab */}
            {activeTab === "manual" && (
              <div className="space-y-4">
                <div className="bg-muted/20 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm font-medium">Cách lấy cookies thủ công</p>
                  </div>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Mở trình duyệt và đăng nhập vào <strong>facebook.com</strong></li>
                    <li>Cài extension <strong>EditThisCookie</strong> hoặc <strong>Cookie-Editor</strong></li>
                    <li>Truy cập <strong>messenger.com</strong>, mở extension và chọn "Export"</li>
                    <li>Sao chép toàn bộ JSON cookies và dán vào ô bên dưới</li>
                  </ol>
                  <a
                    href="https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Tải EditThisCookie
                  </a>
                </div>

                <div className="space-y-1.5">
                  <Label>Dán JSON cookies tại đây</Label>
                  <Textarea
                    placeholder='[{"name":"c_user","value":"...","domain":".facebook.com",...}]'
                    rows={6}
                    value={sessionInput}
                    onChange={(e) => setSessionInput(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>

                <Button
                  onClick={() => {
                    if (!sessionInput.trim()) { toast.error("Vui lòng dán cookies"); return; }
                    try { JSON.parse(sessionInput); } catch {
                      toast.error("JSON không hợp lệ"); return;
                    }
                    saveMutation.mutate({ sessionData: sessionInput });
                  }}
                  disabled={saveMutation.isPending || !sessionInput.trim()}
                  className="w-full"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? "Đang lưu session..." : "Lưu Session"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extension Download */}
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Puzzle className="h-5 w-5 text-indigo-400" />
              <CardTitle className="text-base">Chrome Extension</CardTitle>
            </div>
            <CardDescription>
              Cài extension vào Chrome để kết nối với website, stream màn hình Messenger và chạy bot tự động.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/20 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Hướng dẫn cài đặt</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Tải file extension (.zip) bên dưới</li>
                <li>Giải nén file .zip ra thư mục</li>
                <li>Mở Chrome → <strong>chrome://extensions</strong></li>
                <li>Bật <strong>Developer mode</strong> (góc trên phải)</li>
                <li>Nhấn <strong>Load unpacked</strong> và chọn thư mục vừa giải nén</li>
                <li>Nhấp vào icon extension → nhập URL website và token từ trang <strong>Bot Control</strong></li>
              </ol>
            </div>
            <a
              href="https://d2xsxph8kpxj0f.cloudfront.net/310519663376072037/ErgEZvLYXuUNAUACDjuUVe/messenger-bot-extension_987ec86e.zip"
              download
              className="flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              <Download className="h-4 w-4" />
              Tải Extension (.zip)
            </a>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Thông báo
                {(unreadCount.data ?? 0) > 0 && (
                  <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                    {unreadCount.data} mới
                  </span>
                )}
              </CardTitle>
              {(notifications?.length ?? 0) > 0 && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => markAllRead.mutate()}>
                  Đánh dấu tất cả đã đọc
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!notifications || notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Không có thông báo</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                      n.isRead
                        ? "bg-muted/10 border-border/30"
                        : "bg-muted/30 border-border/60"
                    }`}
                    onClick={() => !n.isRead && markRead.mutate({ id: n.id })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${!n.isRead ? "" : "text-muted-foreground"}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.content}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {format(new Date(n.createdAt), "HH:mm dd/MM/yyyy")}
                        </p>
                      </div>
                      <div className={`shrink-0 h-2 w-2 rounded-full mt-1.5 ${
                        n.type === "success" ? "bg-green-400" :
                        n.type === "error" ? "bg-red-400" :
                        n.type === "warning" ? "bg-yellow-400" : "bg-blue-400"
                      } ${n.isRead ? "opacity-30" : ""}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Session Confirm */}
      <AlertDialog open={showDeleteSession} onOpenChange={setShowDeleteSession}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa session Facebook?</AlertDialogTitle>
            <AlertDialogDescription>
              Bot sẽ không thể gửi tin nhắn cho đến khi bạn cung cấp session mới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { deleteMutation.mutate(); setShowDeleteSession(false); }}
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
