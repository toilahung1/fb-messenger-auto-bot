import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, RefreshCw, Search, Clock } from "lucide-react";
import { format } from "date-fns";

function LogStatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />;
  if (status === "retry") return <RefreshCw className="h-4 w-4 text-yellow-400 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
}

export default function Logs() {
  const [search, setSearch] = useState("");
  const { data: logs, isLoading } = trpc.logs.byUser.useQuery({ limit: 200 });

  const filtered = (logs ?? []).filter(
    (l) =>
      (l.recipientName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (l.messageContent ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: logs?.length ?? 0,
    success: logs?.filter((l) => l.status === "success").length ?? 0,
    failed: logs?.filter((l) => l.status === "failed").length ?? 0,
    retry: logs?.filter((l) => l.status === "retry").length ?? 0,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Lịch sử gửi tin nhắn</h1>
          <p className="text-muted-foreground mt-1">Toàn bộ lịch sử gửi tin nhắn của bạn</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Tổng", value: stats.total, cls: "text-blue-400" },
            { label: "Thành công", value: stats.success, cls: "text-green-400" },
            { label: "Thất bại", value: stats.failed, cls: "text-red-400" },
            { label: "Retry", value: stats.retry, cls: "text-yellow-400" },
          ].map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm kiếm theo tên, nội dung..."
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
                <Clock className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">{search ? "Không tìm thấy kết quả" : "Chưa có lịch sử gửi"}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Trạng thái</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Người nhận</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Nội dung</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Lỗi</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Lần thử</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((log) => (
                      <tr key={log.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <LogStatusIcon status={log.status} />
                        </td>
                        <td className="px-4 py-3 font-medium">{log.recipientName ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                          {log.messageContent ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-red-400 max-w-[150px] truncate">
                          {log.errorMessage ?? ""}
                        </td>
                        <td className="px-4 py-3 text-center text-muted-foreground">{log.attemptNumber}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.sentAt), "HH:mm dd/MM/yyyy")}
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
    </DashboardLayout>
  );
}
