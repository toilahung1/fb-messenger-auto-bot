import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
      toast.success("Session Facebook đã được lưu và xác minh thành công");
    },
    onError: (e) => toast.error(e.message),
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

            {/* How to get cookies */}
            <div className="bg-muted/20 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-medium">Cách lấy cookies Facebook</p>
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

            {/* Input */}
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
              {saveMutation.isPending ? "Đang xác minh session..." : "Lưu & Xác minh Session"}
            </Button>
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
