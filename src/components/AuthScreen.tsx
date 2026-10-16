import { useState, type FormEvent } from "react";
import { api } from "../api";

interface Props {
  mode: "setup" | "login";
  setupTokenRequired: boolean;
  onDone: () => void;
}

export function AuthScreen({ mode, setupTokenRequired, onDone }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSetup = mode === "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSetup && password !== confirm) return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      if (isSetup) await api.setup({ email, password, name, setupToken: setupToken || undefined });
      else await api.login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-logo" />
          <span>yaf</span>
        </div>
        <h1>{isSetup ? "创建管理员账号" : "登录"}</h1>
        <p className="muted small">
          {isSetup ? "这是首次启动，还没有任何用户。创建的第一个账号将成为管理员（admin）。" : "使用邮箱和密码登录。"}
        </p>

        {isSetup && (
          <label>
            <span>昵称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" />
          </label>
        )}
        <label>
          <span>邮箱</span>
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            required
            minLength={isSetup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? "new-password" : "current-password"}
            placeholder={isSetup ? "至少 8 位" : undefined}
          />
        </label>
        {isSetup && (
          <label>
            <span>确认密码</span>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        {setupTokenRequired && (
          <label>
            <span>初始化口令（SETUP_TOKEN）</span>
            <input required value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
          </label>
        )}

        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "请稍候…" : isSetup ? "创建并进入" : "登录"}
        </button>
      </form>
    </div>
  );
}
