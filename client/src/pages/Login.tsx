import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Lock, User } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const utils = trpc.useUtils();
  const loginMutation = trpc.auth.localLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      window.location.href = "/";
    },
    onError: (err) => {
      toast.error(err.message || "Đăng nhập thất bại");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("Vui lòng nhập đầy đủ thông tin");
      return;
    }
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <Bot className="h-8 w-8 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Messenger Bot</h1>
            <p className="text-sm text-muted-foreground mt-1">Đăng nhập để tiếp tục</p>
          </div>
        </div>

        {/* Login Card */}
        <Card className="border-border/50 shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Đăng nhập</CardTitle>
            <CardDescription>Nhập thông tin tài khoản admin</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Tên đăng nhập</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-9"
                    autoComplete="username"
                    disabled={loginMutation.isPending}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Mật khẩu</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                    autoComplete="current-password"
                    disabled={loginMutation.isPending}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Tài khoản được cấu hình qua biến môi trường ADMIN_USERNAME / ADMIN_PASSWORD
        </p>
      </div>
    </div>
  );
}
