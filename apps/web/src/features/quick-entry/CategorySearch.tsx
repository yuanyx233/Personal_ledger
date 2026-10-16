import type { CategoriesResponse } from "@ledger/domain/api-contracts";
import { useRef, useState } from "react";
import { useTranslation } from "../../i18n/useTranslation";

type Category = CategoriesResponse["data"]["categories"][number];

function categorySearchKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-CA");
}

function safeNewCategoryName(value: string) {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const hasUnsafeCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      character === "<" ||
      character === ">" ||
      codePoint < 32 ||
      (codePoint >= 127 && codePoint <= 159)
    );
  });
  return normalized.length > 0 && normalized.length <= 160 && !hasUnsafeCharacter
    ? normalized
    : null;
}

export function CategorySearch({
  busy,
  categories,
  onChoose,
  onCreate,
  triggerLabel,
}: {
  busy: boolean;
  categories: Category[];
  onChoose: (category: Category) => void;
  onCreate: (name: string) => Promise<boolean>;
  triggerLabel?: string;
}) {
  const { t } = useTranslation();
  const trigger = triggerLabel ?? t("categorySearch.trigger");
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmCreate, setConfirmCreate] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const query = categorySearchKey(search);
  const matches = query
    ? categories
        .filter(
          ({ active, editable, systemKey, name }) =>
            active &&
            (editable || systemKey === "TRANSFER") &&
            categorySearchKey(name).includes(query),
        )
        .slice(0, 8)
    : [];
  const newCategoryName = safeNewCategoryName(search);

  return (
    <>
      <button
        aria-expanded={expanded}
        className="quick-category-other"
        disabled={busy}
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        type="button"
      >
        {trigger}
      </button>

      {expanded ? (
        <div className="quick-category-search">
          <label>
            {t("categorySearch.label")}
            <input
              autoComplete="off"
              maxLength={160}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setConfirmCreate(null);
              }}
              ref={searchRef}
              type="search"
              value={search}
            />
          </label>
          {matches.length > 0 ? (
            <ul aria-label={t("categorySearch.results")}>
              {matches.map((category) => (
                <li key={category.id}>
                  <button disabled={busy} onClick={() => onChoose(category)} type="button">
                    {category.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {query && matches.length === 0 && newCategoryName ? (
            <button
              className="quick-category-create"
              disabled={busy}
              onClick={() => setConfirmCreate(newCategoryName)}
              type="button"
            >
              {t("categorySearch.create", { name: newCategoryName })}
            </button>
          ) : null}
          {query && matches.length === 0 && !newCategoryName ? (
            <p className="quick-category-input-error">{t("categorySearch.invalidName")}</p>
          ) : null}
        </div>
      ) : null}

      {confirmCreate ? (
        <div aria-labelledby="quick-create-title" className="quick-category-create-confirm">
          <h3 id="quick-create-title">{t("categorySearch.confirmTitle")}</h3>
          <p>{t("categorySearch.confirmBody", { name: confirmCreate })}</p>
          <div>
            <button disabled={busy} onClick={() => setConfirmCreate(null)} type="button">
              {t("categorySearch.back")}
            </button>
            <button
              className="primary-action"
              disabled={busy}
              onClick={() =>
                void onCreate(confirmCreate).then((created) => {
                  if (created) setConfirmCreate(null);
                })
              }
              type="button"
            >
              {busy ? t("categorySearch.saving") : t("categorySearch.confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
