import { useEffect, useState } from "react";
import { api, ApiError, type User } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { Home } from "./components/Home";

type Phase = { kind: "loading" } | { kind: "setup"; tokenRequired: boolean } | { kind: "login" } | { kind: "app"; user: User };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  async function boot() {
    try {
      const status = await api.status();
      if (status.needsSetup) return setPhase({ kind: "setup", tokenRequired: status.setupTokenRequired });
      const { user } = await api.me();
      setPhase({ kind: "app", user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setPhase({ kind: "login" });
      else setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    boot();
  }, []);

  if (error) return <div className="center-screen muted">加载失败：{error}</div>;
  if (phase.kind === "loading") return <div className="center-screen muted">加载中…</div>;
  if (phase.kind === "setup" || phase.kind === "login")
    return (
      <AuthScreen
        mode={phase.kind}
        setupTokenRequired={phase.kind === "setup" && phase.tokenRequired}
        onDone={boot}
      />
    );
  return (
    <Home
      user={phase.user}
      onLogout={async () => {
        await api.logout();
        setPhase({ kind: "login" });
      }}
    />
  );
}
