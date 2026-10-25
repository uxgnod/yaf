import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, type QrPollStatus, type WechatRules, type WechatState } from "../api";
import { Card, formatDate } from "./Settings";

const RULES: { key: keyof WechatRules; label: string; desc: string }[] = [
  { key: "autoTag", label: "自动加 #微信", desc: "从微信收录的 memo 末尾追加 #微信 标签" },
  { key: "keepAudio", label: "语音保留原音频", desc: "把语音原文件存到 R2（正文使用微信的转写文字）" },
  { key: "replyConfirm", label: "收录后回复确认", desc: "在微信里回复「已记录 · #标签」（24 小时内的会话才能回复）" },
  { key: "mergeWindow", label: "合并连续消息", desc: "2 分钟内连续发的文字消息合并成一条 memo" },
];

const STATUS_TEXT: Record<string, string> = {
  wait: "等待扫码",
  scaned: "已扫码，请在手机上确认",
  need_verifycode: "请输入手机微信上显示的数字",
  verify_code_blocked: "验证码多次错误，请刷新二维码后重试",
  expired: "二维码已过期",
  already_bound: "这个微信已经连接过，无需重复绑定",
  error: "连接失败",
};

export function WechatSection() {
  const [state, setState] = useState<WechatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api.wechat().then(setState, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  if (!state) return <div className="muted small">{error ?? "加载中…"}</div>;
  const connected = state.status === "active" || state.status === "error";

  return (
    <div className="settings-stack">
      {connected ? <Connected state={state} onChange={load} /> : <Binder onConnected={load} />}
      {connected && <RulesCard state={state} onChange={(rules) => setState({ ...state, rules })} />}
      <Card title="说明与风险">
        <ul className="plain-list muted small">
          <li>连接的是微信里的「ClawBot」（微信 → 我 → 设置 → 插件 / ClawBot，灰度开放中）。扫码后，在微信里给 ClawBot 发的文字、图片、语音会存为 memo。</li>
          <li>这是非官方接入（复用 OpenClaw 插件的协议），可能违反服务条款，也可能随时失效。失效时只影响微信收录，不影响其他功能。</li>
          <li>同一个 ClawBot 很可能只能连接一个后端：绑定 yaf 后，原来连接的 OpenClaw 可能会断开。</li>
          <li>只收录扫码的那个微信账号发来的消息。图片会用 AI 生成描述，用于搜索。</li>
          {!state.mediaEnabled && <li>当前没有开通 R2：图片和语音原文件不会保存，只保留描述和转写文字。</li>}
        </ul>
      </Card>
    </div>
  );
}

function Connected({ state, onChange }: { state: WechatState; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card
      title="微信已连接"
      desc={state.status === "error" ? undefined : "在微信里给 ClawBot 发消息，就会存为 memo。"}
      actions={
        <button
          className="btn btn-ghost btn-sm danger-text"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("解绑后，微信里发的消息将不再收录。确定解绑？")) return;
            setBusy(true);
            await api.wechatUnbind();
            onChange();
          }}
        >
          解绑
        </button>
      }
    >
      <div className="index-status">
        <span className={"dot " + (state.status === "active" ? "dot-ok" : "dot-warn")} />
        {state.status === "active" ? "运行中" : "连接异常"}
      </div>
      {state.lastError && <div className="form-error">{state.lastError}</div>}
      <div className="kv">
        <span className="muted">Bot</span>
        <span className="mono small">{state.botId ?? "—"}</span>
        <span className="muted">连接时间</span>
        <span>{formatDate(state.connectedAt ?? null)}</span>
        <span className="muted">最近收到</span>
        <span>{formatDate(state.lastEventAt ?? null, "还没有收到消息")}</span>
      </div>
    </Card>
  );
}

function Binder({ onConnected }: { onConnected: () => void }) {
  const [qr, setQr] = useState<{ img: string; expiresAt: number } | null>(null);
  const [status, setStatus] = useState<QrPollStatus | null>(null);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");
  const polling = useRef(0);

  async function fetchQr() {
    setError(null);
    setStatus(null);
    setCode("");
    const gen = ++polling.current;
    try {
      const r = await api.wechatQrcode();
      setQr({ img: await QRCode.toDataURL(r.qrContent, { margin: 1, width: 240 }), expiresAt: r.expiresAt });
      setStatus("wait");
      poll(gen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 循环查询扫码状态；每次请求服务端最多挂起约 20 秒
  async function poll(gen: number) {
    while (gen === polling.current) {
      try {
        const r = await api.wechatQrStatus();
        if (gen !== polling.current) return;
        setStatus(r.status);
        setRetry(Boolean(r.retry));
        if (r.status === "confirmed") return onConnected();
        if (r.status === "error") return setError(r.error ?? "连接失败");
        if (["expired", "verify_code_blocked", "already_bound", "none"].includes(r.status)) return;
        if (r.status === "need_verifycode") await new Promise((res) => setTimeout(res, 1500));
      } catch {
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  useEffect(() => () => void polling.current++, []);
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [qr]);

  const left = qr ? Math.max(0, Math.round((qr.expiresAt - now) / 1000)) : 0;
  const expired = status === "expired" || (qr && left === 0);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    try {
      await api.wechatVerify(code);
      setStatus("scaned");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card title="连接微信" desc="用手机微信扫描二维码，把 ClawBot 连接到 yaf。">
      <div className="wechat-bind">
        <div className={"qr-box" + (expired ? " expired" : "")}>
          {qr ? <img src={qr.img} alt="微信二维码" /> : <div className="qr-empty muted small">点击下方按钮获取二维码</div>}
          {qr && expired && (
            <button className="btn btn-primary btn-sm qr-refresh" onClick={fetchQr}>刷新二维码</button>
          )}
        </div>
        <div className="wechat-steps">
          <ol className="muted small">
            <li>打开手机微信，扫描左侧二维码</li>
            <li>在手机上确认连接；如果出现数字，在下面输入</li>
            <li>连接成功后，在微信里给 ClawBot 发一条消息试试</li>
          </ol>
          {status && (
            <div className="index-status">
              <span className={"dot " + (status === "scaned" ? "dot-busy" : expired || status === "verify_code_blocked" ? "dot-warn" : "dot-ok")} />
              {expired ? STATUS_TEXT.expired : STATUS_TEXT[status] ?? status}
              {qr && !expired && <span className="muted small">· {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} 后过期</span>}
            </div>
          )}
          {status === "need_verifycode" && (
            <form className="form-row" onSubmit={submitCode}>
              <label className="grow">
                <span>{retry ? "数字不匹配，请重新输入" : "手机上显示的数字"}</span>
                <input className="mono" inputMode="numeric" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <button className="btn btn-primary btn-sm form-row-btn">提交</button>
            </form>
          )}
          {error && <div className="form-error">{error}</div>}
          {!qr && <button className="btn btn-primary" onClick={fetchQr}>获取二维码</button>}
        </div>
      </div>
    </Card>
  );
}

function RulesCard({ state, onChange }: { state: WechatState; onChange: (r: WechatRules) => void }) {
  return (
    <Card title="收录规则">
      <div className="check-list">
        {RULES.map((r) => (
          <label key={r.key} className="check check-desc">
            <input
              type="checkbox"
              checked={state.rules[r.key]}
              onChange={async (e) => onChange((await api.wechatRules({ [r.key]: e.target.checked })).rules)}
            />
            <span>
              <span>{r.label}</span>
              <span className="muted small">{r.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}
