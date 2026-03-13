import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Clock, Plus, Trash2, Edit2, Calendar, RefreshCw,
  Play, Pause, AlarmClock, CheckCircle2, AlertCircle
} from "lucide-react";

const REPEAT_LABELS: Record<string, string> = {
  once: "Một lần",
  daily: "Hàng ngày",
  weekdays: "Ngày làm việc (T2-T6)",
  weekends: "Cuối tuần (T7-CN)",
};

const SAFETY_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: "Thấp", color: "text-yellow-400" },
  medium: { label: "Trung bình", color: "text-blue-400" },
  high: { label: "Cao", color: "text-green-400" },
  extreme: { label: "Cực cao", color: "text-purple-400" },
};

function formatNextRun(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "Chưa xác định";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "Đã qua";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} phút nữa`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} giờ nữa`;
  return d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function padZero(n: number) { return String(n).padStart(2, "0"); }

export default function Scheduler() {
  const { user, loading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const { data: schedules = [], isLoading } = trpc.schedules.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: campaigns = [] } = trpc.campaigns.list.useQuery(undefined, { enabled: isAuthenticated });

  const createMut = trpc.schedules.create.useMutation({
    onSuccess: () => { utils.schedules.list.invalidate(); toast.success("Đã tạo lịch hẹn!"); setShowCreate(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.schedules.update.useMutation({
    onSuccess: () => { utils.schedules.list.invalidate(); toast.success("Đã cập nhật lịch!"); setEditSchedule(null); },
    onError: (e) => toast.error(e.message),
  });
  const toggleMut = trpc.schedules.toggle.useMutation({
    onSuccess: () => utils.schedules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.schedules.delete.useMutation({
    onSuccess: () => { utils.schedules.list.invalidate(); toast.success("Đã xóa lịch!"); },
    onError: (e) => toast.error(e.message),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [editSchedule, setEditSchedule] = useState<number | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [hour, setHour] = useState("8");
  const [minute, setMinute] = useState("0");
  const [repeatType, setRepeatType] = useState<"once" | "daily" | "weekdays" | "weekends">("daily");
  const [runDate, setRunDate] = useState("");
  const [safetyLevel, setSafetyLevel] = useState<"low" | "medium" | "high" | "extreme">("medium");

  function resetForm() {
    setName(""); setCampaignId(""); setHour("8"); setMinute("0");
    setRepeatType("daily"); setRunDate(""); setSafetyLevel("medium");
  }

  function openEdit(s: typeof schedules[0]) {
    setEditSchedule(s.id);
    setName(s.name);
    setCampaignId(String(s.campaignId));
    setHour(String(s.hour));
    setMinute(String(s.minute));
    setRepeatType(s.repeatType as "once" | "daily" | "weekdays" | "weekends");
    setRunDate(s.runDate ? new Date(s.runDate).toISOString().split("T")[0] : "");
    setSafetyLevel(s.safetyLevel as "low" | "medium" | "high" | "extreme");
    setShowCreate(true);
  }

  function handleSubmit() {
    if (!name.trim()) return toast.error("Vui lòng nhập tên lịch");
    if (!campaignId) return toast.error("Vui lòng chọn chiến dịch");
    if (repeatType === "once" && !runDate) return toast.error("Vui lòng chọn ngày chạy");

    const payload = {
      name: name.trim(),
      campaignId: Number(campaignId),
      hour: Number(hour),
      minute: Number(minute),
      repeatType,
      runDate: repeatType === "once" ? runDate : undefined,
      safetyLevel,
    };

    if (editSchedule) {
      updateMut.mutate({ id: editSchedule, ...payload });
    } else {
      createMut.mutate(payload);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );

  if (!isAuthenticated) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-muted-foreground">Vui lòng đăng nhập để sử dụng tính năng này</p>
      <Button onClick={() => window.location.href = getLoginUrl()}>Đăng nhập</Button>
    </div>
  );

  const activeCount = schedules.filter(s => s.isActive).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlarmClock className="w-6 h-6 text-blue-400" />
            Lên lịch tự động
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Đặt lịch để chiến dịch tự động khởi động vào thời điểm bạn chọn
          </p>
        </div>
        <Button onClick={() => { resetForm(); setEditSchedule(null); setShowCreate(true); }} className="gap-2">
          <Plus className="w-4 h-4" />
          Tạo lịch mới
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Calendar className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{schedules.length}</p>
                <p className="text-xs text-muted-foreground">Tổng lịch hẹn</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Đang hoạt động</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <RefreshCw className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {schedules.reduce((sum, s) => sum + (s.runCount ?? 0), 0)}
                </p>
                <p className="text-xs text-muted-foreground">Lần đã chạy</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Schedule List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <AlarmClock className="w-12 h-12 text-muted-foreground/40" />
            <p className="text-muted-foreground text-center">
              Chưa có lịch hẹn nào.<br />
              Tạo lịch để bot tự động gửi tin nhắn vào giờ bạn muốn.
            </p>
            <Button variant="outline" onClick={() => { resetForm(); setEditSchedule(null); setShowCreate(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Tạo lịch đầu tiên
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => {
            const campaign = campaigns.find(c => c.id === s.campaignId);
            const safety = SAFETY_LABELS[s.safetyLevel] ?? SAFETY_LABELS.medium;
            return (
              <Card key={s.id} className={`transition-all ${s.isActive ? "border-blue-500/30" : "opacity-60"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Toggle */}
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(v) => toggleMut.mutate({ id: s.id, isActive: v })}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">{s.name}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {REPEAT_LABELS[s.repeatType] ?? s.repeatType}
                        </Badge>
                        <Badge variant="outline" className={`text-xs shrink-0 ${safety.color}`}>
                          Bảo vệ: {safety.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {padZero(s.hour)}:{padZero(s.minute)}
                          {s.repeatType === "once" && s.runDate && (
                            <span className="ml-1">ngày {new Date(s.runDate).toLocaleDateString("vi-VN")}</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1">
                          <Play className="w-3 h-3" />
                          Chiến dịch: {campaign?.name ?? `#${s.campaignId}`}
                        </span>
                        {s.nextRunAt && s.isActive && (
                          <span className="flex items-center gap-1 text-blue-400">
                            <AlarmClock className="w-3 h-3" />
                            {formatNextRun(s.nextRunAt)}
                          </span>
                        )}
                        {s.runCount != null && s.runCount > 0 && (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Đã chạy {s.runCount} lần
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => {
                          if (confirm(`Xóa lịch "${s.name}"?`)) deleteMut.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Hướng dẫn */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-400">
            <AlertCircle className="w-4 h-4" />
            Lưu ý khi sử dụng lịch tự động
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Scheduler kiểm tra lịch mỗi <strong>60 giây</strong> — thời gian thực tế có thể lệch tối đa 1 phút.</p>
          <p>• Chiến dịch phải có <strong>người nhận</strong> và <strong>nội dung tin nhắn</strong> trước khi lên lịch.</p>
          <p>• Đảm bảo <strong>session Facebook</strong> còn hiệu lực trong trang Cài đặt để bot hoạt động.</p>
          <p>• Lịch loại <strong>"Một lần"</strong> sẽ tự động tắt sau khi chạy xong.</p>
        </CardContent>
      </Card>

      {/* Dialog tạo/sửa lịch */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditSchedule(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSchedule ? "Chỉnh sửa lịch" : "Tạo lịch hẹn mới"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Tên lịch hẹn</Label>
              <Input
                placeholder="Ví dụ: Gửi tin buổi sáng"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Chiến dịch</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chiến dịch..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Giờ (0-23)</Label>
                <Input
                  type="number" min={0} max={23}
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phút (0-59)</Label>
                <Input
                  type="number" min={0} max={59}
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Lặp lại</Label>
              <Select value={repeatType} onValueChange={(v) => setRepeatType(v as typeof repeatType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REPEAT_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {repeatType === "once" && (
              <div className="space-y-1.5">
                <Label>Ngày chạy</Label>
                <Input
                  type="date"
                  value={runDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setRunDate(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Mức độ bảo vệ chống checkpoint</Label>
              <Select value={safetyLevel} onValueChange={(v) => setSafetyLevel(v as typeof safetyLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SAFETY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      <span className={v.color}>{v.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditSchedule(null); }}>
              Hủy
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending ? "Đang lưu..." : editSchedule ? "Cập nhật" : "Tạo lịch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
