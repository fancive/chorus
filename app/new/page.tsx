"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import {
  getOrCreateBrowserToken,
  getNickname,
  setNickname,
} from "@/lib/client/identity";

interface TemplateInfo {
  id: string;
  name: string;
  blurb: string;
  initials: string;
  color: string;
}
interface Dimension {
  key: string;
  label: string;
  description: string;
  options: { value: string; label: string; prompt: string }[];
}
interface ModeInfo {
  id: "interview" | "dialogue" | "coach";
  label: string;
  description: string;
}

interface Catalog {
  people: TemplateInfo[];
  dimensions: Dimension[];
  topics: string[];
  modes: ModeInfo[];
}

function sample<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

const MAX_SELECTED = 3;
type Tab = "preset" | "custom";

interface CustomDraft {
  name: string;
  color: string;
  dims: Record<string, string | undefined>;
  freeform: string;
}

const emptyCustom: CustomDraft = {
  name: "",
  color: "#6366f1",
  dims: {},
  freeform: "",
};

export default function NewRoomPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [nickname, setNick] = useState<string>("");
  const [mode, setMode] = useState<ModeInfo["id"]>("dialogue");
  const [topic, setTopic] = useState<string>("");
  const [tab, setTab] = useState<Tab>("preset");
  const [picked, setPicked] = useState<string[]>([]); // template ids in selection order
  const [custom, setCustom] = useState<CustomDraft>(emptyCustom);
  const [customAdded, setCustomAdded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setNick(getNickname());
    const params = new URLSearchParams(window.location.search);
    const topicFromUrl = params.get("topic");
    if (topicFromUrl) setTopic(topicFromUrl.slice(0, 300));
    void fetch("/api/role-templates")
      .then((r) => r.json())
      .then((c: Catalog) => {
        setCatalog(c);
        setTopicSuggestions(sample(c.topics ?? [], 3));
      })
      .catch(() => {
        setCatalog({ people: [], dimensions: [], topics: [], modes: [] });
      });
  }, []);

  function rerollTopics() {
    if (!catalog) return;
    setTopicSuggestions(sample(catalog.topics ?? [], 3));
  }

  const tplById = useMemo(() => {
    const m = new Map<string, TemplateInfo>();
    if (catalog) for (const t of catalog.people) m.set(t.id, t);
    return m;
  }, [catalog]);

  const totalSelected = picked.length + (customAdded ? 1 : 0);

  function togglePreset(id: string) {
    if (picked.includes(id)) {
      setPicked(picked.filter((x) => x !== id));
      return;
    }
    if (totalSelected >= MAX_SELECTED) return;
    setPicked([...picked, id]);
  }

  function rollRandom() {
    if (!catalog) return;
    const pick = (arr: { value: string }[]) =>
      arr[Math.floor(Math.random() * arr.length)]?.value;
    const next: Record<string, string | undefined> = {};
    for (const d of catalog.dimensions) next[d.key] = pick(d.options);
    setCustom({ ...custom, dims: next });
  }

  function addCustom() {
    if (totalSelected >= MAX_SELECTED) return;
    if (!custom.name.trim()) return;
    setCustomAdded(true);
  }

  function removeCustom() {
    setCustomAdded(false);
  }

  async function submit() {
    if (!catalog || submitting || totalSelected === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setNickname(nickname);
    const browserToken = getOrCreateBrowserToken();
    const roles: unknown[] = picked.map((id) => ({
      kind: "template" as const,
      templateId: id,
    }));
    if (customAdded) {
      roles.push({
        kind: "custom" as const,
        name: custom.name.trim() || "自定义参会人",
        color: custom.color,
        dimensions: { ...custom.dims, freeform: custom.freeform.trim() || undefined },
      });
    }
    const r = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserToken,
        nickname,
        mode,
        topic: topic.trim() || undefined,
        roles,
      }),
    });
    if (r.ok) {
      const { id } = await r.json();
      router.push(`/room/${id}`);
    } else {
      setSubmitting(false);
      const raw = await r.text();
      let pretty: string = raw;
      try {
        const body = JSON.parse(raw) as {
          error?: string;
          message?: string;
          issues?: { message?: string; path?: (string | number)[] }[];
        };
        if (body.issues?.length) {
          pretty = body.issues
            .map((i) => `${i.path?.join(".") ?? ""} ${i.message ?? ""}`.trim())
            .filter(Boolean)
            .join("；");
        } else {
          pretty = body.message || body.error || raw;
        }
      } catch {
        /* keep raw */
      }
      setSubmitError(pretty || "未知错误");
    }
  }

  if (!catalog) {
    return <main className="p-8 text-slate-400">加载中...</main>;
  }

  const customChip = customAdded
    ? {
        initials: custom.name.slice(0, 1) || "自",
        color: custom.color,
        name: custom.name.trim() || "自定义",
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← 返回
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">创建房间</h1>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-700">选模式</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {catalog.modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`rounded-md border px-3 py-3 text-left transition ${
                mode === m.id
                  ? "border-slate-900 bg-white shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-400"
              }`}
            >
              <div className="text-sm font-medium text-slate-900">{m.label}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{m.description}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-700">你想被称作</h2>
        <input
          value={nickname}
          onChange={(e) => setNick(e.target.value)}
          placeholder="无名氏"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">
            选参会人 <span className="text-slate-400">({totalSelected}/{MAX_SELECTED})</span>
          </h2>
          {totalSelected > 1 && (
            <span className="text-xs text-slate-500">辩论场——主持人会让他们互相回应</span>
          )}
        </div>

        {/* Selected chips */}
        <div className="mt-3 flex min-h-[2.5rem] flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
          {totalSelected === 0 && (
            <span className="text-xs text-slate-400">尚未选择，从下面挑</span>
          )}
          {picked.map((id) => {
            const t = tplById.get(id);
            if (!t) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => togglePreset(id)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-2 py-1 text-xs hover:border-red-400"
              >
                <Avatar initials={t.initials} color={t.color} size={20} />
                <span>{t.name}</span>
                <span className="text-slate-400">✕</span>
              </button>
            );
          })}
          {customChip && (
            <button
              type="button"
              onClick={removeCustom}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-2 py-1 text-xs hover:border-red-400"
            >
              <Avatar initials={customChip.initials} color={customChip.color} size={20} />
              <span>{customChip.name}</span>
              <span className="text-slate-300">·自定义</span>
              <span className="text-slate-400">✕</span>
            </button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("preset")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "preset" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            现成的
          </button>
          <button
            type="button"
            onClick={() => setTab("custom")}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === "custom" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            自捏一个
          </button>
        </div>

        {tab === "preset" && (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {catalog.people.map((t) => (
              <PresetCard
                key={t.id}
                t={t}
                selected={picked.includes(t.id)}
                disabled={!picked.includes(t.id) && totalSelected >= MAX_SELECTED}
                onToggle={() => togglePreset(t.id)}
              />
            ))}
          </div>
        )}

        {tab === "custom" && (
          <div className="mt-4 space-y-4 rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between">
              <span className="text-xs text-slate-500">最多自捏 1 位</span>
              {customAdded ? (
                <span className="text-xs text-emerald-600">已加入选择</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <input
                value={custom.name}
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                placeholder="参会人名（如：王阳明、我妈、产品总监）"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="color"
                value={custom.color}
                onChange={(e) => setCustom({ ...custom, color: e.target.value })}
                className="h-10 w-12 rounded-md border border-slate-300"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">5 个维度（不必每个都选）</span>
              <button
                type="button"
                onClick={rollRandom}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
              >
                随机一组
              </button>
            </div>
            {catalog.dimensions.map((d) => (
              <div key={d.key}>
                <div className="text-xs text-slate-500">
                  {d.label}
                  <span className="ml-2 text-slate-400">{d.description}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() =>
                        setCustom({
                          ...custom,
                          dims: {
                            ...custom.dims,
                            [d.key]: custom.dims[d.key] === o.value ? undefined : o.value,
                          },
                        })
                      }
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        custom.dims[d.key] === o.value
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <div className="text-xs text-slate-500">补充描述（可选）</div>
              <textarea
                value={custom.freeform}
                onChange={(e) => setCustom({ ...custom, freeform: e.target.value })}
                placeholder="想精确控制的细节..."
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {customAdded ? (
                <button
                  type="button"
                  onClick={removeCustom}
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
                >
                  从已选移除
                </button>
              ) : (
                <button
                  type="button"
                  onClick={addCustom}
                  disabled={!custom.name.trim() || totalSelected >= MAX_SELECTED}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  加入已选
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">起手话题（可跳过）</h2>
          {topicSuggestions.length > 0 && (
            <button
              type="button"
              onClick={rerollTopics}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              换一批
            </button>
          )}
        </div>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="一句话开场"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {topicSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topicSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTopic(s)}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="mt-10">
        {submitError && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            创建失败：{submitError}
          </div>
        )}
        <button
          onClick={() => void submit()}
          disabled={submitting || totalSelected === 0}
          className="w-full rounded-md bg-slate-900 px-4 py-3 text-white hover:bg-slate-800 disabled:bg-slate-400"
        >
          {submitting ? "进入中..." : "进入房间"}
        </button>
      </div>
    </main>
  );
}

function PresetCard({
  t,
  selected,
  disabled,
  onToggle,
}: {
  t: TemplateInfo;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition ${
        selected
          ? "border-slate-900 bg-slate-50"
          : disabled
            ? "border-slate-200 opacity-40"
            : "border-slate-200 hover:border-slate-400"
      }`}
    >
      <Avatar initials={t.initials} color={t.color} />
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-900">{t.name}</div>
        <div className="text-xs text-slate-500">{t.blurb}</div>
      </div>
      {selected && <span className="text-xs text-emerald-600">✓</span>}
    </button>
  );
}
