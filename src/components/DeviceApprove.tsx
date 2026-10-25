import { useEffect, useState, type FormEvent } from "react";
import { api, type Scope } from "../api";
import { navigate } from "../router";
import { SCOPE_LABEL } from "./Settings";

/** CLI 设备码登录的确认页：/device?code=ABCD-EFGH */
export function DeviceApprove() {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code")?.toUpperCase() ?? "");
  const [info, setInfo] = useState<{ clientName: string; scopes: Scope[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(c: string) {
    setError(null);
    setInfo(null);
    try {
      setInfo(await api.getDevice(c));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (code) lookup(code);
    // 只在首次进入时按 URL 里的代码查询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      await api.approveDevice(code, approve);
      setDone(approve ? "approved" : "denied");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    lookup(code.trim().toUpperCase());
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-logo" />
          <span>yaf</span>
        </div>
        <h1>授权设备登录</h1>
        {done ? (
          <>
            <p className="muted small">
              {done === "approved" ? "已授权。回到终端即可继续使用，可以关闭此页面。" : "已拒绝这次登录请求。"}
            </p>
            <button className="btn btn-ghost btn-block" onClick={() => navigate("/")}>返回笔记</button>
          </>
        ) : info ? (
          <>
            <p className="muted small">
              <b>{info.clientName}</b> 请求访问你的 yaf。请确认终端里显示的代码是 <span className="mono">{code}</span>。
            </p>
            <div className="token-scopes">
              {info.scopes.map((s) => (
                <span key={s} className="scope-chip">{SCOPE_LABEL[s] ?? s}</span>
              ))}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="dialog-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={() => decide(false)}>拒绝</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>授权</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="form-grid">
            <p className="muted small">输入终端里显示的 8 位代码。</p>
            <label>
              <span>设备代码</span>
              <input className="mono" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-block">继续</button>
          </form>
        )}
      </div>
    </div>
  );
}
