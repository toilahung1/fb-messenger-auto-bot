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
  Wand2,
  Cookie,
  Loader2,
  Camera,
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
  const [facebookUrl, setFacebookUrl] = useState("https://messenger.com");
  const [activeTab, setActiveTab] = useState<"auto" | "manual">("auto");
  const [debugResult, setDebugResult] = useState<{ screenshot?: string; url?: string; htmlSnippet?: string; error?: string } | null>(null);

  const debugScreenshotMutation = trpc.botSession.debugScreenshot.useMutation({
    onSuccess: (data) => {
      setDebugResult(data);
      if (data.ok) {
        toast.success("Chụp screenshot thành công!");
      } else {
        toast.error(data.error ?? "Lỗi không xác định");
      }
    },
    onError: (e) => toast.error(e.message),
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
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-blue-300 font-medium flex items-center gap-1">
                    <Info className="h-3.5 w-3.5" /> Cách hoạt động
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hệ thống sẽ mở trình duyệt ảo trên server, điều hướng đến trang Facebook bạn nhập, chờ trang load và tự động trích xuất cookies phiên đăng nhập. Quá trình mất khoảng 15–30 giây.
                  </p>
                  <p className="text-xs text-yellow-400/80 mt-1">
                    ⚠️ Yêu cầu bạn đã đăng nhập Facebook trên trình duyệt của server. Nếu chưa, hãy dùng tab "Dán cookies thủ công".
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fb-url">Link Facebook của bạn</Label>
                  <Input
                    id="fb-url"
                    placeholder="https://www.facebook.com hoặc https://messenger.com"
                    value={facebookUrl}
                    onChange={(e) => setFacebookUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ví dụ: https://www.facebook.com, https://messenger.com, hoặc link profile của bạn
                  </p>
                </div>

                <Button
                  onClick={() => {
                    if (!facebookUrl.trim()) { toast.error("Vui lòng nhập link Facebook"); return; }
                    extractCookiesMutation.mutate({ url: facebookUrl.trim() });
                  }}
                  disabled={extractCookiesMutation.isPending || !facebookUrl.trim()}
                  className="w-full"
                >
                  {extractCookiesMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Đang mở trình duyệt... (15–30 giây)
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Tự động lấy cookies
                    </>
                  )}
                </Button>
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

        {/* Debug Screenshot Card */}
        {session?.isActive && (
          <Card className="border-border/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Kiểm tra kết nối Messenger</CardTitle>
              </div>
              <CardDescription>
                Chụp screenshot Messenger sau khi áp dụng cookies — giúp kiểm tra cookies có hoạt động không.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => debugScreenshotMutation.mutate()}
                disabled={debugScreenshotMutation.isPending}
                variant="outline"
                className="w-full"
              >
                {debugScreenshotMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang mở Messenger... (20–40 giây)</>
                ) : (
                  <><Camera className="h-4 w-4 mr-2" /> Chụp screenshot Messenger</>
                )}
              </Button>

              {debugResult && (
                <div className="space-y-3">
                  {/* URL status */}
                  <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    debugResult.url?.includes('login') || debugResult.url?.includes('checkpoint')
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-green-500/10 border border-green-500/20 text-green-400'
                  }`}>
                    {debugResult.url?.includes('login') || debugResult.url?.includes('checkpoint') ? (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    ) : (
                      <CheckCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-mono text-xs break-all">{debugResult.url ?? 'N/A'}</span>
                  </div>

                  {/* Screenshot */}
                  {debugResult.screenshot && (
                    <div className="rounded-lg overflow-hidden border border-border/50">
                      <img
                        src={`data:image/jpeg;base64,${debugResult.screenshot}`}
                        alt="Messenger screenshot"
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Error */}
                  {debugResult.error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <p className="text-xs text-red-400">{debugResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Notifications */}
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Thông báo</CardTitle>
                {(unreadCount.data ?? 0) > 0 && (
                  <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                    {unreadCount.data} mới
                  </span>
                )}
              </div>
              {(unreadCount.data ?? 0) > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-xs text-muted-foreground"
                >
                  Đánh dấu tất cả đã đọc
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!notifications || notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Chưa có thông báo nào</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      !n.isRead
                        ? "bg-primary/5 border-primary/20 hover:bg-primary/10"
                        : "bg-muted/10 border-border/30 hover:bg-muted/20"
                    }`}
                    onClick={() => !n.isRead && markRead.mutate({ id: n.id })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-medium ${!n.isRead ? "text-foreground" : "text-muted-foreground"}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.content}</p>
                      </div>
                      {!n.isRead && (
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {format(new Date(n.createdAt), "HH:mm dd/MM/yyyy")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete session dialog */}
      <AlertDialog open={showDeleteSession} onOpenChange={setShowDeleteSession}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa session Facebook?</AlertDialogTitle>
            <AlertDialogDescription>
              Bot sẽ không thể gửi tin nhắn cho đến khi bạn thêm session mới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteMutation.mutate(); setShowDeleteSession(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Xóa session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
