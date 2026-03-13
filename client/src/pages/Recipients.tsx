import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Plus,
  Trash2,
  Upload,
  ArrowLeft,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Search,
} from "lucide-react";

function RecipientStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Chờ", cls: "bg-gray-500/20 text-gray-400" },
    sending: { label: "Đang gửi", cls: "bg-blue-500/20 text-blue-400 animate-pulse" },
    sent: { label: "Đã gửi", cls: "bg-green-500/20 text-green-400" },
    failed: { label: "Thất bại", cls: "bg-red-500/20 text-red-400" },
    skipped: { label: "Bỏ qua", cls: "bg-yellow-500/20 text-yellow-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-500/20 text-gray-400" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

export default function Recipients() {
  const params = useParams<{ id: string }>();
  const campaignId = Number(params.id);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: recipients, isLoading } = trpc.recipients.list.useQuery({ campaignId });
  const { data: campaign } = trpc.campaigns.get.useQuery({ id: campaignId });

  const addMutation = trpc.recipients.add.useMutation({
    onSuccess: () => {
      utils.recipients.list.invalidate({ campaignId });
      utils.campaigns.get.invalidate({ id: campaignId });
      setShowAdd(false);
      setAddForm({ name: "", facebookUrl: "", facebookUid: "", phone: "" });
      toast.success("Đã thêm người nhận");
    },
    onError: (e) => toast.error(e.message),
  });
  const importMutation = trpc.recipients.importCsv.useMutation({
    onSuccess: (data) => {
      utils.recipients.list.invalidate({ campaignId });
      utils.campaigns.get.invalidate({ id: campaignId });
      toast.success(`Đã import ${data.imported} người nhận`);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.recipients.delete.useMutation({
    onSuccess: () => {
      utils.recipients.list.invalidate({ campaignId });
      utils.campaigns.get.invalidate({ id: campaignId });
      toast.success("Đã xóa người nhận");
    },
    onError: (e) => toast.error(e.message),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [addForm, setAddForm] = useState({ name: "", facebookUrl: "", facebookUid: "", phone: "" });

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast.error("Chỉ hỗ trợ file CSV");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = btoa(ev.target?.result as string);
      importMutation.mutate({ campaignId, csvContent: base64, fileName: file.name });
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const filtered = (recipients ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.facebookUrl ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: recipients?.length ?? 0,
    sent: recipients?.filter((r) => r.status === "sent").length ?? 0,
    failed: recipients?.filter((r) => r.status === "failed").length ?? 0,
    pending: recipients?.filter((r) => r.status === "pending").length ?? 0,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/campaigns/${campaignId}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Người nhận</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                {campaign?.name ?? "Chiến dịch"} · {stats.total} người nhận
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileImport}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
            >
              <Upload className="h-4 w-4 mr-2" />
              {importMutation.isPending ? "Đang import..." : "Import CSV"}
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-2" /> Thêm thủ công
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Tổng", value: stats.total, icon: Users, color: "text-blue-400" },
            { label: "Đã gửi", value: stats.sent, icon: CheckCircle, color: "text-green-400" },
            { label: "Thất bại", value: stats.failed, icon: XCircle, color: "text-red-400" },
            { label: "Chờ gửi", value: stats.pending, icon: Clock, color: "text-gray-400" },
          ].map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="p-3 flex items-center gap-2">
                <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CSV Template */}
        <Card className="border-border/50 border-dashed bg-muted/10">
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-1">Định dạng file CSV</p>
            <p className="text-xs text-muted-foreground mb-2">
              File CSV cần có các cột sau (tên cột linh hoạt):
            </p>
            <code className="text-xs bg-muted px-3 py-2 rounded-lg block">
              name,facebook_url,phone<br />
              Nguyễn Văn A,https://www.messenger.com/t/nguyen.van.a,0901234567<br />
              Trần Thị B,https://www.messenger.com/t/tran.thi.b,
            </code>
          </CardContent>
        </Card>

        {/* Search + Table */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm kiếm theo tên, URL..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Users className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">
                  {search ? "Không tìm thấy kết quả" : "Chưa có người nhận"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">#</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tên</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Facebook URL</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">SĐT</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Trạng thái</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Lỗi</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, idx) => (
                      <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                          {r.facebookUrl ?? r.facebookUid ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.phone ?? "—"}</td>
                        <td className="px-4 py-3">
                          <RecipientStatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-red-400 max-w-[150px] truncate">
                          {r.errorMessage ?? ""}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteId(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm người nhận</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Tên *</Label>
              <Input
                placeholder="Nguyễn Văn A"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Facebook URL / Messenger Link</Label>
              <Input
                placeholder="https://www.messenger.com/t/username"
                value={addForm.facebookUrl}
                onChange={(e) => setAddForm((f) => ({ ...f, facebookUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Facebook UID</Label>
              <Input
                placeholder="100012345678"
                value={addForm.facebookUid}
                onChange={(e) => setAddForm((f) => ({ ...f, facebookUid: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Số điện thoại</Label>
              <Input
                placeholder="0901234567"
                value={addForm.phone}
                onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Hủy</Button>
            <Button
              onClick={() => {
                if (!addForm.name.trim()) { toast.error("Vui lòng nhập tên"); return; }
                addMutation.mutate({
                  campaignId,
                  name: addForm.name,
                  facebookUrl: addForm.facebookUrl || undefined,
                  facebookUid: addForm.facebookUid || undefined,
                  phone: addForm.phone || undefined,
                });
              }}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? "Đang thêm..." : "Thêm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa người nhận?</AlertDialogTitle>
            <AlertDialogDescription>Lịch sử gửi tin nhắn của người nhận này cũng sẽ bị xóa.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteMutation.mutate({ id: deleteId, campaignId });
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
