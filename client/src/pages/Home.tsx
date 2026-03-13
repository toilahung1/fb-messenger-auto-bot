import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardLayout from "@/components/DashboardLayout";
import { Link } from "wouter";
import {
  MessageSquare,
  Users,
  CheckCircle,
  XCircle,
  PlayCircle,
  BarChart3,
  ArrowRight,
  Bot,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  sub,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  sub?: string;
}) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-3 rounded-xl ${color}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardContent() {
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const { data: campaigns } = trpc.campaigns.list.useQuery();
  const { data: recentLogs } = trpc.logs.byUser.useQuery({ limit: 10 });

  const recentCampaigns = campaigns?.slice(0, 5) ?? [];

  // Tạo dữ liệu biểu đồ từ logs
  const chartData = (() => {
    if (!recentLogs) return [];
    const byDay: Record<string, { sent: number; failed: number }> = {};
    for (const log of recentLogs) {
      const day = new Date(log.sentAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
      if (!byDay[day]) byDay[day] = { sent: 0, failed: 0 };
      if (log.status === "success") byDay[day].sent++;
      else if (log.status === "failed") byDay[day].failed++;
    }
    return Object.entries(byDay).map(([date, v]) => ({ date, ...v }));
  })();

  const totalSent = stats?.messages.totalSent ?? 0;
  const totalFailed = stats?.messages.totalFailed ?? 0;
  const successRate =
    totalSent + totalFailed > 0
      ? Math.round((totalSent / (totalSent + totalFailed)) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Tổng quan hệ thống gửi tin nhắn tự động</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Tổng chiến dịch"
          value={isLoading ? "..." : stats?.campaigns.total ?? 0}
          icon={BarChart3}
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          title="Đang chạy"
          value={isLoading ? "..." : stats?.campaigns.running ?? 0}
          icon={PlayCircle}
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          title="Tin nhắn đã gửi"
          value={isLoading ? "..." : totalSent.toLocaleString()}
          icon={MessageSquare}
          color="bg-purple-500/20 text-purple-400"
        />
        <StatCard
          title="Tỷ lệ thành công"
          value={isLoading ? "..." : `${successRate}%`}
          icon={CheckCircle}
          color="bg-emerald-500/20 text-emerald-400"
          sub={`${totalFailed} thất bại`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="lg:col-span-2 border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Hoạt động gửi tin nhắn</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">Chưa có dữ liệu</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#888" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1a1a2e",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                    }}
                  />
                  <Area type="monotone" dataKey="sent" stroke="#6366f1" fill="url(#sentGrad)" name="Thành công" />
                  <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="url(#failedGrad)" name="Thất bại" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Campaigns */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Chiến dịch gần đây</CardTitle>
            <Link href="/campaigns">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Xem tất cả <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentCampaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Bot className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">Chưa có chiến dịch</p>
                <Link href="/campaigns">
                  <Button variant="outline" size="sm" className="mt-3 text-xs">
                    Tạo chiến dịch đầu tiên
                  </Button>
                </Link>
              </div>
            ) : (
              recentCampaigns.map((c) => (
                <Link key={c.id} href={`/campaigns/${c.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.sentCount}/{c.totalRecipients} đã gửi
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Nháp", cls: "bg-gray-500/20 text-gray-400" },
    running: { label: "Đang chạy", cls: "bg-blue-500/20 text-blue-400" },
    paused: { label: "Tạm dừng", cls: "bg-yellow-500/20 text-yellow-400" },
    completed: { label: "Hoàn thành", cls: "bg-green-500/20 text-green-400" },
    failed: { label: "Lỗi", cls: "bg-red-500/20 text-red-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-500/20 text-gray-400" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
  );
}

export default function Home() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-2xl bg-primary/20">
              <Bot className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-3">Facebook Messenger Bot</h1>
          <p className="text-muted-foreground mb-8">
            Hệ thống tự động gửi tin nhắn hàng loạt qua Facebook Messenger. Quản lý chiến dịch, theo dõi thống kê và điều khiển bot chỉ với một cú click.
          </p>
          <Button size="lg" className="w-full" onClick={() => (window.location.href = getLoginUrl())}>
            Đăng nhập để bắt đầu
          </Button>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <DashboardContent />
    </DashboardLayout>
  );
}
