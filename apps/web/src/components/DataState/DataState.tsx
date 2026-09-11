import type { ReactNode } from "react";

type DataStateVariant = "empty" | "error" | "loading" | "offline";

interface DataStateProps {
  action?: ReactNode;
  description?: string;
  title?: string;
  variant: DataStateVariant;
}

const DEFAULT_CONTENT: Record<
  DataStateVariant,
  { description: string; marker: string; title: string }
> = {
  empty: {
    description: "添加手工交易或导入 CSV 后，内容会出现在这里。",
    marker: "0",
    title: "这里还没有数据",
  },
  error: {
    description: "本次读取没有完成。你的现有账本不会因此被更改。",
    marker: "!",
    title: "暂时无法读取",
  },
  loading: {
    description: "正在安全地读取最新数据。",
    marker: "…",
    title: "正在读取账本",
  },
  offline: {
    description: "重新联网后再试；为保护隐私和准确性，不会显示缓存的交易记录。",
    marker: "×",
    title: "当前处于离线状态",
  },
};

export function DataState({ action, description, title, variant }: DataStateProps) {
  const content = DEFAULT_CONTENT[variant];
  const urgent = variant === "error";

  return (
    <section
      aria-busy={variant === "loading" ? true : undefined}
      aria-live={urgent ? "assertive" : "polite"}
      className={`data-state data-state--${variant}`}
      role={urgent ? "alert" : "status"}
    >
      <span aria-hidden="true" className="data-state-marker">
        {content.marker}
      </span>
      <div className="data-state-copy">
        <h2>{title ?? content.title}</h2>
        <p>{description ?? content.description}</p>
        {variant === "loading" ? (
          <div aria-hidden="true" className="data-state-skeleton">
            <span />
            <span />
          </div>
        ) : null}
        {action ? <div className="data-state-action">{action}</div> : null}
      </div>
    </section>
  );
}
