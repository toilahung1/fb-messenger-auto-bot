import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Plus, Trash2, Eye, Users, MessageSquare, Play, Pause, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Nháp", cls: "bg-gray-500/20 text-gray-400" },
    running: { label: "Đang chạy", cls: "bg-blue-500/20 text-blue-400 animate-pulse" },
    paused: { label: "Tạm dừng", cls: "bg-yellow-500/20 text-yellow-400" },
    completed: { label: "Hoàn thành", cls: "bg-green-500/20 text-green-400" },
    failed: { label: "Lỗi", cls: "bg-red-500/20 text-red-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-500/20 text-gray-400" };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.cls}`}>{s.label}</span>
  );
}

export default function Campaigns() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: campaigns, isLoading } = trpc.campaigns.list.useQuery();
  const createMutation = trpc.campaigns.create.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
      setShowCreate(false);
      toast.success("Đã tạo chiến dịch");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.campaigns.delete.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
      toast.success("Đã xóa chiến dịch");
    },
    onError: (e) => toast.error(e.message),
  });
  const startMutation = trpc.campaigns.start.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
      toast.success("Chiến dịch đã bắt đầu");
    },
    onError: (e) => toast.error(e.message),
  });
  const stopMutation = trpc.campaigns.stop.useMutation({
    onSuccess: () => {
      utils.campaigns.list.invalidate();
      toast.success("Chiến dịch đã dừng");
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    messageTemplate: "Xin chào {{name}}, ...",
    delayBetweenMessages: 3000,
    maxRetries: 3,
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.messageTemplate.trim()) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }
    createMutation.mutate(form);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Chiến dịch</h1>
            <p className="text-muted-foreground mt-1">Quản lý các chiến dịch gửi tin nhắn</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> Tạo chiến dịch
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border/50 animate-pulse">
                <CardContent className="p-6 h-48" />
              </Card>
            ))}
          </div>
        ) : campaigns?.length === 0 ? (
          <Card className="border-border/50 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-lg">Chưa có chiến dịch nào</h3>
              <p className="text-muted-foreground text-sm mt-2 mb-6">
                Tạo chiến dịch đầu tiên để bắt đầu gửi tin nhắn tự động
              </p>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-2" /> Tạo chiến dịch
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {campaigns?.map((c) => (
              <Card key={c.id} className="border-border/50 hover:border-border transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{c.name}</h3>
                      {c.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <StatusBadge status={c.status} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/campaigns/${c.id}`)}>
                            <Eye className="h-4 w-4 mr-2" /> Chi tiết
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/campaigns/${c.id}/recipients`)}>
                            <Users className="h-4 w-4 mr-2" /> Người nhận
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteId(c.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Xóa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{c.sentCount} / {c.totalRecipients} đã gửi</span>
                      <span>{c.successRate != null ? Math.round(c.successRate) : 0}% thành công</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: c.totalRecipients > 0
                            ? `${(c.sentCount / c.totalRecipients) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => navigate(`/campaigns/${c.id}`)}
                    >
                      <Eye className="h-3 w-3 mr-1" /> Chi tiết
                    </Button>
                    {c.status === "running" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1 text-xs"
                        onClick={() => stopMutation.mutate({ id: c.id })}
                        disabled={stopMutation.isPending}
                      >
                        <Pause className="h-3 w-3 mr-1" /> Dừng
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => startMutation.mutate({ id: c.id })}
                        disabled={
                          startMutation.isPending ||
                          c.status === "completed" ||
                          c.totalRecipients === 0
                        }
                      >
                        <Play className="h-3 w-3 mr-1" /> Bắt đầu
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tạo chiến dịch mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Tên chiến dịch *</Label>
              <Input
                placeholder="VD: Chiến dịch tháng 3"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mô tả</Label>
              <Input
                placeholder="Mô tả ngắn về chiến dịch"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nội dung tin nhắn *</Label>
              <Textarea
                placeholder="Nội dung tin nhắn. Dùng {{name}}, {{firstName}}, {{date}}, {{time}} làm biến động."
                rows={4}
                value={form.messageTemplate}
                onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Biến động: <code className="bg-muted px-1 rounded">{"{{name}}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{{firstName}}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{{date}}"}</code>{" "}
                <code className="bg-muted px-1 rounded">{"{{time}}"}</code>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Độ trễ (ms)</Label>
                <Input
                  type="number"
                  min={1000}
                  max={60000}
                  value={form.delayBetweenMessages}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, delayBetweenMessages: Number(e.target.value) }))
                  }
                />
                <p className="text-xs text-muted-foreground">Tối thiểu 1000ms</p>
              </div>
              <div className="space-y-1.5">
                <Label>Số lần retry</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={form.maxRetries}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxRetries: Number(e.target.value) }))
                  }
                />
                <p className="text-xs text-muted-foreground">Tối đa 5 lần</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Hủy
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Đang tạo..." : "Tạo chiến dịch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa chiến dịch?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này không thể hoàn tác. Toàn bộ dữ liệu người nhận và lịch sử gửi tin nhắn sẽ bị xóa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteMutation.mutate({ id: deleteId });
                setDeleteId(null);
              }}
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
