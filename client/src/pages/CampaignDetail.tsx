import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Play,
  Pause,
  RefreshCw,
  Users,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  ArrowLeft,
  Download,
  Edit2,
  Save,
  X,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Nháp", cls: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    running: { label: "Đang chạy", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    paused: { label: "Tạm dừng", cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    completed: { label: "Hoàn thành", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    failed: { label: "Lỗi", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
  return (
    <span className={`text-sm px-3 py-1 rounded-full font-medium border ${s.cls}`}>{s.label}</span>
  );
}

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const campaignId = Number(params.id);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: campaign, isLoading } = trpc.campaigns.get.useQuery({ id: campaignId });
  const { data: logs } = trpc.logs.byCampaign.useQuery({ campaignId, limit: 50 });

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", description: "", messageTemplate: "", delayBetweenMessages: 3000, maxRetries: 3 });
  const [safetyLevel, setSafetyLevel] = useState<"low" | "medium" | "high" | "extreme">("medium");

  const { data: riskAssessment } = trpc.campaigns.assess.useQuery(
    { id: campaignId, safetyLevel },
    { enabled: !!campaignId }
  );

  const SAFETY_LABELS: Record<string, { label: string; color: string }> = {
    low: { label: "Thấp", color: "text-red-400" },
    medium: { label: "Trung bình", color: "text-yellow-400" },
    high: { label: "Cao", color: "text-green-400" },
    extreme: { label: "Cực cao", color: "text-blue-400" },
  };

  const updateMutation = trpc.campaigns.update.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id: campaignId });
      setEditing(false);
      toast.success("Đã cập nhật chiến dịch");
    },
    onError: (e) => toast.error(e.message),
  });
  const startMutation = trpc.campaigns.start.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id: campaignId });
      toast.success("Chiến dịch đã bắt đầu");
    },
    onError: (e) => toast.error(e.message),
  });
  const stopMutation = trpc.campaigns.stop.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id: campaignId });
      toast.success("Chiến dịch đã dừng");
    },
  });
  const resetMutation = trpc.campaigns.resetRecipients.useMutation({
    onSuccess: () => {
      utils.campaigns.get.invalidate({ id: campaignId });
      toast.success("Đã reset trạng thái người nhận");
    },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = () => {
    if (!campaign) return;
    setEditForm({
      name: campaign.name,
      description: campaign.description ?? "",
      messageTemplate: campaign.messageTemplate,
      delayBetweenMessages: campaign.delayBetweenMessages,
      maxRetries: campaign.maxRetries,
    });
    setEditing(true);
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!campaign) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">Không tìm thấy chiến dịch</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/campaigns")}>
            Quay lại
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const successRate = campaign.successRate != null ? Math.round(campaign.successRate) : 0;
  const progress = campaign.totalRecipients > 0
    ? Math.round(((campaign.sentCount + campaign.failedCount) / campaign.totalRecipients) * 100)
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{campaign.name}</h1>
                <StatusBadge status={campaign.status} />
                {campaign.isRunning && (
                  <span className="flex items-center gap-1 text-xs text-blue-400">
                    <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              {campaign.description && (
                <p className="text-muted-foreground text-sm mt-1">{campaign.description}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEdit} disabled={campaign.isRunning}>
                <Edit2 className="h-4 w-4 mr-1" /> Chỉnh sửa
              </Button>
            )}
            {campaign.status === "running" || campaign.isRunning ? (
              <Button variant="destructive" size="sm" onClick={() => stopMutation.mutate({ id: campaignId })}>
                <Pause className="h-4 w-4 mr-1" /> Dừng
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                {/* Safety Level Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1 text-xs">
                      <ShieldCheck className={`h-3.5 w-3.5 ${SAFETY_LABELS[safetyLevel]?.color}`} />
                      <span className={SAFETY_LABELS[safetyLevel]?.color}>{SAFETY_LABELS[safetyLevel]?.label}</span>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {Object.entries(SAFETY_LABELS).map(([level, meta]) => (
                      <DropdownMenuItem key={level} onClick={() => setSafetyLevel(level as typeof safetyLevel)}>
                        <ShieldCheck className={`h-4 w-4 mr-2 ${meta.color}`} />
                        <span className={meta.color}>{meta.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  onClick={() => startMutation.mutate({ id: campaignId, safetyLevel })}
                  disabled={startMutation.isPending || campaign.totalRecipients === 0}
                >
                  <Play className="h-4 w-4 mr-1" /> Bắt đầu
                </Button>
              </div>
            )}
            {/* Risk Assessment Badge */}
            {riskAssessment && !campaign.isRunning && (
              <div className={`text-xs px-2 py-1 rounded-full border ${
                riskAssessment.riskLevel === "safe" ? "bg-green-500/10 border-green-500/20 text-green-400" :
                riskAssessment.riskLevel === "caution" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                riskAssessment.riskLevel === "warning" ? "bg-orange-500/10 border-orange-500/20 text-orange-400" :
                "bg-red-500/10 border-red-500/20 text-red-400"
              }`}>
                Risk: {riskAssessment.riskScore}% • {riskAssessment.estimatedDuration}
              </div>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Tổng người nhận", value: campaign.totalRecipients, icon: Users, color: "text-blue-400" },
            { label: "Đã gửi thành công", value: campaign.sentCount, icon: CheckCircle, color: "text-green-400" },
            { label: "Thất bại", value: campaign.failedCount, icon: XCircle, color: "text-red-400" },
            { label: "Tỷ lệ thành công", value: `${successRate}%`, icon: MessageSquare, color: "text-purple-400" },
          ].map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <s.icon className={`h-5 w-5 ${s.color}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-xl font-bold">{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Progress */}
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Tiến độ</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>
                {campaign.startedAt && `Bắt đầu: ${format(new Date(campaign.startedAt), "dd/MM HH:mm")}`}
              </span>
              <span>
                {campaign.completedAt && `Hoàn thành: ${format(new Date(campaign.completedAt), "dd/MM HH:mm")}`}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Edit / Config */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cấu hình chiến dịch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Tên chiến dịch</Label>
                    <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nội dung tin nhắn</Label>
                    <Textarea
                      rows={5}
                      value={editForm.messageTemplate}
                      onChange={(e) => setEditForm((f) => ({ ...f, messageTemplate: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Biến: <code className="bg-muted px-1 rounded">{"{{name}}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{{firstName}}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{{date}}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{{time}}"}</code>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Độ trễ (ms)</Label>
                      <Input type="number" min={1000} max={60000} value={editForm.delayBetweenMessages}
                        onChange={(e) => setEditForm((f) => ({ ...f, delayBetweenMessages: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Số lần retry</Label>
                      <Input type="number" min={1} max={5} value={editForm.maxRetries}
                        onChange={(e) => setEditForm((f) => ({ ...f, maxRetries: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateMutation.mutate({ id: campaignId, ...editForm })} disabled={updateMutation.isPending}>
                      <Save className="h-4 w-4 mr-1" /> Lưu
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                      <X className="h-4 w-4 mr-1" /> Hủy
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Nội dung tin nhắn</p>
                    <div className="bg-muted/30 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs">
                      {campaign.messageTemplate}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground text-xs">Độ trễ</p>
                      <p className="font-medium">{campaign.delayBetweenMessages}ms</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Số lần retry</p>
                      <p className="font-medium">{campaign.maxRetries} lần</p>
                    </div>
                  </div>
                  {campaign.csvFileUrl && (
                    <a href={campaign.csvFileUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm" className="w-full">
                        <Download className="h-4 w-4 mr-2" /> Tải file CSV đã import
                      </Button>
                    </a>
                  )}
                  {campaign.logFileUrl && (
                    <a href={campaign.logFileUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm" className="w-full">
                        <Download className="h-4 w-4 mr-2" /> Tải logs chiến dịch
                      </Button>
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Logs */}
          <Card className="border-border/50">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Lịch sử gửi gần đây</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetMutation.mutate({ id: campaignId })}
                disabled={resetMutation.isPending || campaign.isRunning}
                className="text-xs"
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Reset
              </Button>
            </CardHeader>
            <CardContent>
              {!logs || logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Clock className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Chưa có lịch sử</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20">
                      {log.status === "success" ? (
                        <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                      ) : log.status === "retry" ? (
                        <RefreshCw className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{log.recipientName}</p>
                        {log.errorMessage && (
                          <p className="text-xs text-red-400 truncate">{log.errorMessage}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(log.sentAt), "HH:mm dd/MM")} · Lần {log.attemptNumber}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(`/campaigns/${campaignId}/recipients`)}>
            <Users className="h-4 w-4 mr-2" /> Quản lý người nhận ({campaign.totalRecipients})
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
