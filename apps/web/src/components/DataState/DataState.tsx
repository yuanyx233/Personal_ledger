import type { ReactNode } from "react";

import type { TranslationKey } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";

type DataStateVariant = "empty" | "error" | "loading" | "offline";

interface DataStateProps {
  action?: ReactNode;
  description?: string;
  title?: string;
  variant: DataStateVariant;
}

const DEFAULT_CONTENT: Record<
  DataStateVariant,
  { descriptionKey: TranslationKey; marker: string; titleKey: TranslationKey }
> = {
  empty: {
    descriptionKey: "dataState.empty.description",
    marker: "0",
    titleKey: "dataState.empty.title",
  },
  error: {
    descriptionKey: "dataState.error.description",
    marker: "!",
    titleKey: "dataState.error.title",
  },
  loading: {
    descriptionKey: "dataState.loading.description",
    marker: "…",
    titleKey: "dataState.loading.title",
  },
  offline: {
    descriptionKey: "dataState.offline.description",
    marker: "×",
    titleKey: "dataState.offline.title",
  },
};

export function DataState({ action, description, title, variant }: DataStateProps) {
  const { t } = useTranslation();
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
        <h2>{title ?? t(content.titleKey)}</h2>
        <p>{description ?? t(content.descriptionKey)}</p>
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
