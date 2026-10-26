// 视图（Lens）定义。新增视图 = 加一条；改问题或阈值后把 LENS_REV 加 1，补判任务会重判所有 memo。

export interface Lens {
  key: string;
  name: string;
  /** 交给 Clef 的 noul 问题 */
  question: string;
  /** 分数 ≥ threshold 视为命中 */
  threshold: number;
  /** 分数落在 [ask, threshold) 时，卡片上问用户 */
  ask?: number;
}

export const LENSES: Lens[] = [
  {
    key: "private",
    name: "隐私",
    question: "这段文字是否写出了可以直接用来登录或访问账户的凭据的值，例如密码、口令、API key、token、恢复码、私钥？",
    threshold: 0.8,
  },
  {
    key: "todo",
    name: "待办",
    question: "这条笔记是否记录了一件作者自己要去做的事（任务、提醒、计划要做的事项）？",
    threshold: 0.7,
    ask: 0.4,
  },
];

/** 视图集版本：LENSES 有任何改动都要加 1 */
export const LENS_REV = 1;

export const lensByKey = (key: string) => LENSES.find((l) => l.key === key);
