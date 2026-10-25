import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Insight, type InsightItem, type InsightPlan, type Memo } from "../api";
import { renderMarkdown } from "../markdown";
import { navigate } from "../router";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function describeSchedule(p: InsightPlan) {
  if (p.cadence === "daily") return `每天 ${p.time}`;
  if (p.cadence === "weekly") return `每${WEEKDAYS[p.weekday ?? 0]} ${p.time}`;
  if (p.cadence === "monthly") return `每月 ${p.monthday} 号 ${p.time}`;
  return `cron ${p.cron}`;
}

function md(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  path: string;
  onMenu: () => void;
  onUnreadChange: (n: number) => void;
}

/** 洞察页：/insights 或 /insights/:id */
export function InsightsPage({ path, onMenu, onUnreadChange }: Props) {
  const selectedId = path.split("/")[2] || null;
  const [plans, setPlans] = useState<InsightPlan[] | null>(null);
  const [list, setList] = useState<Insight[] | null>(null);
  const [detail, setDetail] = useState<Insight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoView, setMemoView] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const r = await api.listInsights();
    setList(r.insights);
    onUnreadChange(r.unread);
    return r.insights;
  }, [onUnreadChange]);

  useEffect(() => {
    api.listPlans().then((r) => setPlans(r.plans));
    loadList().then((items) => {
      // 没有选中时默认打开最新一份
      if (!selectedId && items[0]) navigate(`/insights/${items[0].id}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const { insight } = await api.getInsight(id);
      setDetail(insight);
      if (insight.status === "ready" && !insight.readAt) loadList();
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadList]);

  useEffect(() => {
    setError(null);
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // 有「生成中」的报告时轮询
  const generating = list?.some((i) => i.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(async () => {
      const items = await loadList();
      const cur = items.find((i) => i.id === selectedId);
      if (cur && cur.status !== "generating" && detail?.status === "generating") loadDetail(cur.id);
    }, 4000);
    return () => clearInterval(t);
  }, [generating, loadList, loadDetail, selectedId, detail?.status]);

  const activePlan = plans?.find((p) => p.enabled) ?? plans?.[0] ?? null;

  async function runNow() {
    if (!activePlan) return navigate("/settings/insights");
    setBusy(true);
    setError(null);
    try {
      const r = await api.runPlan(activePlan.id);
      await loadList();
      navigate(`/insights/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <button className="icon-btn menu-toggle" onClick={onMenu} aria-label="菜单">☰</button>
        <div className="title">洞察</div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/settings/insights")}>管理计划</button>
        <button className="btn btn-primary btn-sm" disabled={busy || plans === null} onClick={runNow}>
          {busy ? "启动中…" : "立即生成"}
        </button>
      </div>

      {plans && (
        <div className="plan-summary muted small">
          {activePlan ? (
            <>
              <span className={"dot " + (activePlan.enabled ? "dot-ok" : "dot-warn")} />
              <b>{activePlan.name}</b> · {describeSchedule(activePlan)} · 分析最近 {activePlan.windowDays} 天
              {activePlan.scopeTags.length > 0 && <> · {activePlan.scopeTags.map((t) => "#" + t).join(" ")}</>}
              {activePlan.enabled && activePlan.nextRunAt && <> · 下次 {dateTime(activePlan.nextRunAt)}</>}
              {plans.length > 1 && <> · 共 {plans.length} 个计划</>}
            </>
          ) : (
            <>还没有洞察计划。<a onClick={() => navigate("/settings/insights")}>创建一个</a>，按你设定的频率自动回顾笔记。</>
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      {list && list.length === 0 ? (
        <div className="placeholder-card">
          <div className="placeholder-icon">✦</div>
          <h3>还没有洞察报告</h3>
          <p className="muted">
            洞察会回顾一段时间内的 memo，找出反复出现的主题、和过去的新连接、想做未做的事，以及值得追问的问题。
            {activePlan ? "点「立即生成」试试。" : "先创建一个计划。"}
          </p>
        </div>
      ) : (
        <div className="insights-layout">
          <div className="insight-list">
            {list?.map((i) => (
              <div
                key={i.id}
                className={"insight-row" + (i.id === selectedId ? " active" : "")}
                onClick={() => navigate(`/insights/${i.id}`)}
              >
                <div className="insight-row-title">
                  {i.status === "ready" && !i.readAt && <span className="unread-dot" />}
                  <span>{i.title ?? i.planName ?? "洞察"}</span>
                </div>
                <div className="muted small">
                  {i.status === "generating" ? (
                    <span className="status-generating">生成中…</span>
                  ) : i.status === "failed" ? (
                    <span className="danger-text">生成失败</span>
                  ) : (
                    <>
                      {md(i.periodStart)}–{md(i.periodEnd)} · {i.memoCount} 条
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="insight-detail">
            {detail ? (
              <InsightDetail
                insight={detail}
                onOpenMemo={setMemoView}
                onChange={(next) => {
                  setDetail(next);
                  loadList();
                }}
                onDeleted={async () => {
                  const items = await loadList();
                  navigate(items[0] ? `/insights/${items[0].id}` : "/insights");
                }}
              />
            ) : (
              list && list.length > 0 && <div className="muted small">选择左侧的一份报告</div>
            )}
          </div>
        </div>
      )}
      {memoView && <MemoDialog id={memoView} onClose={() => setMemoView(null)} />}
    </>
  );
}

function InsightDetail({
  insight,
  onOpenMemo,
  onChange,
  onDeleted,
}: {
  insight: Insight;
  onOpenMemo: (id: string) => void;
  onChange: (i: Insight) => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const c = insight.content;

  if (insight.status === "generating") {
    return (
      <div className="insight-generating">
        <div className="spinner" />
        <div>
          <b>正在生成「{insight.planName ?? "洞察"}」</b>
          <div className="muted small">
            分析 {md(insight.periodStart)}–{md(insight.periodEnd)} 的 memo，通常需要半分钟到几分钟。可以先离开，生成后会出现在这里。
          </div>
        </div>
      </div>
    );
  }
  if (insight.status === "failed") {
    return (
      <div className="insight-failed">
        <b>生成失败</b>
        <div className="muted small">{insight.error}</div>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={async () => (await api.deleteInsight(insight.id), onDeleted())}>
            删除这条记录
          </button>
        </div>
      </div>
    );
  }
  if (!c) return null;

  const cites = (ids: string[]) => (
    <div className="cites">
      {ids.map((id) => {
        const m = c.memos[id];
        return (
          <button key={id} className="cite" onClick={() => onOpenMemo(id)} title={m?.excerpt}>
            <span className="cite-date">{m ? md(m.createdAt) : "memo"}</span>
            <span className="cite-text">{m?.excerpt ?? id.slice(0, 8)}</span>
          </button>
        );
      })}
    </div>
  );
  const section = (title: string, items: InsightItem[]) =>
    items.length > 0 && (
      <section className="insight-section">
        <h3>{title}</h3>
        {items.map((it, i) => (
          <div key={i} className="insight-item">
            <div className="insight-item-title">{it.title}</div>
            <div className="insight-item-detail">{it.detail}</div>
            {cites(it.memoIds)}
          </div>
        ))}
      </section>
    );

  async function feedback(f: "useful" | "useless") {
    const next = insight.feedback === f ? null : f;
    await api.insightFeedback(insight.id, next);
    onChange({ ...insight, feedback: next });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api.saveInsight(insight.id);
      onChange({ ...insight, savedMemoId: r.memoId });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="insight-article">
      <header>
        <h2>{insight.title}</h2>
        <div className="muted small">
          {insight.planName} · {md(insight.periodStart)}–{md(insight.periodEnd)} · {c.stats.window} 条 memo
          {c.stats.history > 0 && <> + {c.stats.history} 条相关历史</>} · {insight.model?.split("/").pop()}
        </div>
      </header>
      <p className="insight-summary">{c.summary}</p>
      {section("反复出现的主题", c.themes)}
      {section("新的连接", c.connections)}
      {section("想做未做", c.unfinished)}
      {c.questions.length > 0 && (
        <section className="insight-section">
          <h3>值得追问的问题</h3>
          {c.questions.map((q, i) => (
            <div key={i} className="insight-item">
              <div className="insight-item-title">{q.question}</div>
              {q.why && <div className="insight-item-detail">{q.why}</div>}
              {cites(q.memoIds)}
            </div>
          ))}
        </section>
      )}
      <footer className="insight-actions">
        <span className="muted small">这份报告</span>
        <button className={"btn btn-ghost btn-sm" + (insight.feedback === "useful" ? " on" : "")} onClick={() => feedback("useful")}>
          👍 有用
        </button>
        <button className={"btn btn-ghost btn-sm" + (insight.feedback === "useless" ? " on" : "")} onClick={() => feedback("useless")}>
          👎 没用
        </button>
        <span className="spacer" />
        {insight.savedMemoId ? (
          <span className="muted small">已存为 memo</span>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={saving} onClick={save}>
            {saving ? "保存中…" : "存为 memo"}
          </button>
        )}
      </footer>
    </article>
  );
}

function MemoDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [memo, setMemo] = useState<Memo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getMemo(id).then((r) => setMemo(r.memo), (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  const html = useMemo(() => (memo ? renderMarkdown(memo.content) : ""), [memo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog dialog-wide" onMouseDown={(e) => e.stopPropagation()}>
        {error ? (
          <div className="form-error">{error === "不存在" ? "这条 memo 已被删除" : error}</div>
        ) : memo ? (
          <>
            <div className="muted small">{new Date(memo.createdAt).toLocaleString()}</div>
            <div
              className="markdown"
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={(e) => {
                // 标签链接：关闭弹窗并跳转到笔记列表
                const a = (e.target as HTMLElement).closest("a.tag") as HTMLAnchorElement | null;
                if (a) {
                  e.preventDefault();
                  onClose();
                  navigate(`/#tag=${encodeURIComponent(a.dataset.tag!)}`);
                  dispatchEvent(new HashChangeEvent("hashchange"));
                }
              }}
            />
          </>
        ) : (
          <div className="muted small">加载中…</div>
        )}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
