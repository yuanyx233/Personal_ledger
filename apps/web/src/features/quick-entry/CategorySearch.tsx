import type { CategoriesResponse } from "@ledger/domain/api-contracts";
import { useRef, useState } from "react";

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
  triggerLabel = "其他类别…",
}: {
  busy: boolean;
  categories: Category[];
  onChoose: (category: Category) => void;
  onCreate: (name: string) => Promise<boolean>;
  triggerLabel?: string;
}) {
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
        {triggerLabel}
      </button>

      {expanded ? (
        <div className="quick-category-search">
          <label>
            搜索或输入类别
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
            <ul aria-label="已有类别搜索结果">
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
              创建新类别“{newCategoryName}”
            </button>
          ) : null}
          {query && matches.length === 0 && !newCategoryName ? (
            <p className="quick-category-input-error">类别名称含有不支持的字符。</p>
          ) : null}
        </div>
      ) : null}

      {confirmCreate ? (
        <div aria-labelledby="quick-create-title" className="quick-category-create-confirm">
          <h3 id="quick-create-title">确认创建新类别</h3>
          <p>将创建支出类别“{confirmCreate}”，并把它选为当前分类。</p>
          <div>
            <button disabled={busy} onClick={() => setConfirmCreate(null)} type="button">
              返回
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
              {busy ? "正在保存…" : "确认创建类别"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
