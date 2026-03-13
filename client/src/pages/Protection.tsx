import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff,
  Zap, Clock, AlertTriangle, CheckCircle, XCircle,
  Activity, TrendingUp, Info, ChevronRight,
} from "lucide-react";

type SafetyLevel = "low" | "medium" | "high" | "extreme";

const LEVEL_META: Record<SafetyLevel, {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  badgeClass: string;
}> = {
  low: {
    label: "Thấp (Nhanh)",
    icon: <Zap className="h-5 w-5" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    badgeClass: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  medium: {
    label: "Trung bình",
    icon: <Shield className="h-5 w-5" />,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    badgeClass: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  high: {
    label: "Cao (An toàn)",
    icon: <ShieldCheck className="h-5 w-5" />,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    badgeClass: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  extreme: {
    label: "Cực cao (Tối đa)",
    icon: <ShieldAlert className="h-5 w-5" />,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
};

function RiskGauge({ score, level }: { score: number; level: string }) {
  const color =
    level === "safe" ? "#22c55e" :
    level === "caution" ? "#eab308" :
    level === "warning" ? "#f97316" : "#ef4444";

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/20" />
          <circle
            cx="60" cy="60" r="54" fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color }}>
          {level === "safe" ? "An toàn" : level === "caution" ? "Cẩn thận" : level === "warning" ? "Cảnh báo" : "Nguy hiểm"}
        </p>
        <p className="text-xs text-muted-foreground">Risk Score</p>
      </div>
    </div>
  );
}

function FeatureTag({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
      enabled
        ? "bg-green-500/10 border-green-500/20 text-green-400"
        : "bg-muted/20 border-border/30 text-muted-foreground"
    }`}>
      {enabled ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </div>
  );
}

export default function Protection() {
  const [selectedLevel, setSelectedLevel] = useState<SafetyLevel>("medium");

  const { data: presets } = trpc.campaigns.safetyPresets.useQuery();
  const { data: riskInfo } = trpc.campaigns.riskInfo.useQuery(
    { safetyLevel: selectedLevel },
    { refetchInterval: 10000 }
  );

  const selectedPreset = presets?.find((p: { level: string }) => p.level === selectedLevel);
  const meta = LEVEL_META[selectedLevel];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Bảo vệ Chống Checkpoint</h1>
          <p className="text-muted-foreground mt-1">
            Cấu hình chế độ bảo vệ để giảm thiểu rủi ro bị Facebook checkpoint khi gửi tin nhắn hàng loạt
          </p>
        </div>

        {/* Cảnh báo quan trọng */}
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-yellow-400">Lưu ý quan trọng</p>
            <p className="text-xs text-muted-foreground">
              Gửi tin nhắn hàng loạt vi phạm Điều khoản dịch vụ của Facebook. Hệ thống này chỉ dành cho mục đích học tập và nghiên cứu.
              Chế độ bảo vệ giúp giảm thiểu rủi ro nhưng <strong>không đảm bảo 100%</strong> tránh được checkpoint.
              Tài khoản có lịch sử checkpoint sẽ có rủi ro cao hơn.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Level selector */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-base font-semibold">Chọn mức độ bảo vệ</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["low", "medium", "high", "extreme"] as SafetyLevel[]).map((level) => {
                const m = LEVEL_META[level];
                const preset = presets?.find((p: { level: string }) => p.level === level) as typeof selectedPreset;
                const isSelected = selectedLevel === level;
                return (
                  <button
                    key={level}
                    onClick={() => setSelectedLevel(level)}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? `${m.borderColor} ${m.bgColor}`
                        : "border-border/30 hover:border-border/60 bg-card/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`flex items-center gap-2 ${isSelected ? m.color : "text-muted-foreground"}`}>
                        {m.icon}
                        <span className="font-semibold text-sm">{m.label}</span>
                      </div>
                      {isSelected && <ChevronRight className={`h-4 w-4 ${m.color}`} />}
                    </div>
                    <p className="text-xs text-muted-foreground">{preset?.description}</p>
                    {preset && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className="text-xs bg-muted/20 px-2 py-0.5 rounded text-muted-foreground">
                          {preset.minDelay / 1000}-{preset.maxDelay / 1000}s delay
                        </span>
                        <span className="text-xs bg-muted/20 px-2 py-0.5 rounded text-muted-foreground">
                          {preset.maxMessagesPerHour} tin/giờ
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Chi tiết preset đang chọn */}
            {selectedPreset && (
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className={meta.color}>{meta.icon}</div>
                    <CardTitle className="text-base">Chi tiết: {meta.label}</CardTitle>
                    <Badge className={`ml-auto text-xs ${meta.badgeClass}`}>{selectedLevel}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Thông số */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Delay tối thiểu", value: `${selectedPreset.minDelay / 1000}s` },
                      { label: "Delay tối đa", value: `${selectedPreset.maxDelay / 1000}s` },
                      { label: "Tối đa/giờ", value: `${selectedPreset.maxMessagesPerHour} tin` },
                      { label: "Tối đa/ngày", value: `${selectedPreset.maxMessagesPerDay} tin` },
                      { label: "Nghỉ sau", value: `${selectedPreset.breakAfterMessages} tin` },
                      { label: "Thời gian nghỉ", value: `${selectedPreset.breakDurationMin}-${selectedPreset.breakDurationMax}s` },
                      { label: "Warm-up", value: `${selectedPreset.warmupMessages} tin đầu` },
                      { label: "Warm-up multiplier", value: `×${selectedPreset.warmupMultiplier}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-muted/10 rounded-lg p-2.5">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-sm font-semibold mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Tính năng bật/tắt */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Tính năng bảo vệ</p>
                    <div className="flex flex-wrap gap-2">
                      <FeatureTag enabled={selectedPreset.enableHumanTyping} label="Human Typing" />
                      <FeatureTag enabled={selectedPreset.enableMouseMovement} label="Mouse Movement" />
                      <FeatureTag enabled={selectedPreset.enableRandomScrolling} label="Random Scroll" />
                      <FeatureTag enabled={selectedPreset.enableFingerprintProtection} label="Fingerprint Protection" />
                      <FeatureTag enabled={true} label="Checkpoint Detection" />
                      <FeatureTag enabled={true} label="Rate Limiter" />
                      <FeatureTag enabled={true} label="Smart Delay" />
                      <FeatureTag enabled={true} label="Warm-up Mode" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Risk Monitor */}
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Trạng thái hiện tại</h2>

            <Card className="border-border/50">
              <CardContent className="pt-6 flex flex-col items-center gap-4">
                {riskInfo ? (
                  <>
                    <RiskGauge score={riskInfo.riskScore} level={riskInfo.riskLevel} />
                    <div className="w-full space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Đã gửi giờ này</span>
                        <span className="font-medium">{riskInfo.sentThisHour} / {riskInfo.maxPerHour}</span>
                      </div>
                      <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(100, (riskInfo.sentThisHour / riskInfo.maxPerHour) * 100)}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-xs mt-2">
                        <span className="text-muted-foreground">Đã gửi hôm nay</span>
                        <span className="font-medium">{riskInfo.sentToday} / {riskInfo.maxPerDay}</span>
                      </div>
                      <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(100, (riskInfo.sentToday / riskInfo.maxPerDay) * 100)}%` }}
                        />
                      </div>

                      {riskInfo.checkpointCount > 0 && (
                        <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                          <div className="flex items-center gap-2">
                            <ShieldOff className="h-4 w-4 text-red-400" />
                            <p className="text-xs font-medium text-red-400">
                              {riskInfo.checkpointCount} checkpoint trong lịch sử
                            </p>
                          </div>
                          {riskInfo.lastCheckpointAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Gần nhất: {new Date(riskInfo.lastCheckpointAt).toLocaleString("vi-VN")}
                            </p>
                          )}
                        </div>
                      )}

                      {riskInfo.consecutiveSent > 0 && (
                        <div className="flex items-center justify-between text-xs mt-1">
                          <span className="text-muted-foreground">Gửi liên tiếp</span>
                          <span className="font-medium">{riskInfo.consecutiveSent} tin</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-muted-foreground text-sm">Đang tải...</div>
                )}
              </CardContent>
            </Card>

            {/* Hướng dẫn chọn mức */}
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  Nên chọn mức nào?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="flex gap-2">
                  <Zap className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p><strong className="text-red-400">Thấp:</strong> Tài khoản cũ, ít bạn bè, gửi &lt;50 tin/ngày</p>
                </div>
                <div className="flex gap-2">
                  <Shield className="h-3.5 w-3.5 text-yellow-400 shrink-0 mt-0.5" />
                  <p><strong className="text-yellow-400">Trung bình:</strong> Tài khoản bình thường, gửi 50-150 tin/ngày</p>
                </div>
                <div className="flex gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
                  <p><strong className="text-green-400">Cao:</strong> Tài khoản mới, gửi nhiều, đã từng bị checkpoint</p>
                </div>
                <div className="flex gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <p><strong className="text-blue-400">Cực cao:</strong> Tài khoản quan trọng, không muốn rủi ro</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Cơ chế hoạt động */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Cơ chế bảo vệ hoạt động như thế nào?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  icon: <Clock className="h-5 w-5 text-blue-400" />,
                  title: "Smart Delay",
                  desc: "Delay ngẫu nhiên giữa các tin, thêm jitter ±20% để tránh pattern đều đặn. Warm-up mode gửi chậm dần ở đầu.",
                },
                {
                  icon: <Activity className="h-5 w-5 text-green-400" />,
                  title: "Human Behavior",
                  desc: "Giả lập tốc độ gõ người thật (30-150ms/ký tự), thỉnh thoảng gõ nhầm rồi xóa, di chuyển chuột ngẫu nhiên.",
                },
                {
                  icon: <ShieldCheck className="h-5 w-5 text-yellow-400" />,
                  title: "Checkpoint Detection",
                  desc: "Kiểm tra URL và nội dung trang sau mỗi tin nhắn. Phát hiện checkpoint, CAPTCHA, rate limit và dừng ngay lập tức.",
                },
                {
                  icon: <TrendingUp className="h-5 w-5 text-purple-400" />,
                  title: "Rate Limiter",
                  desc: "Giới hạn số tin/giờ và /ngày. Tự động nghỉ ngơi sau N tin liên tiếp. Tính Risk Score để cảnh báo trước.",
                },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="bg-muted/10 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    {icon}
                    <p className="text-sm font-semibold">{title}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
