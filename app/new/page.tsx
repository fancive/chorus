"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import {
  getOrCreateBrowserToken,
  getNickname,
  setNickname,
} from "@/lib/client/identity";

interface ModeInfo {
  id: "interview" | "dialogue" | "coach";
  label: string;
  description: string;
}
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

interface Catalog {
  modes: ModeInfo[];
  templates: TemplateInfo[];
  dimensions: Dimension[];
}

export default function NewRoomPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [nickname, setNick] = useState<string>("");
  const [mode, setMode] = useState<ModeInfo["id"]>("dialogue");
  const [topic, setTopic] = useState<string>("");
  const [roleKind, setRoleKind] = useState<"template" | "custom">("template");
  const [templateId, setTemplateId] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [customColor, setCustomColor] = useState<string>("#6366f1");
  const [dims, setDims] = useState<Record<string, string | undefined>>({});
  const [freeform, setFreeform] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNick(getNickname());
    void fetch("/api/role-templates")
      .then((r) => r.json())
      .then((c: Catalog) => {
        setCatalog(c);
        setTemplateId(c.templates[0]?.id ?? "");
      });
  }, []);

  function rollRandom() {
    if (!catalog) return;
    const pick = (arr: { value: string }[]) =>
      arr[Math.floor(Math.random() * arr.length)]?.value;
    const next: Record<string, string | undefined> = {};
    for (const d of catalog.dimensions) next[d.key] = pick(d.options);
    setDims(next);
  }

  async function submit() {
    if (!catalog || submitting) return;
    setSubmitting(true);
    setNickname(nickname);
    const browserToken = getOrCreateBrowserToken();
    const role =
      roleKind === "template"
        ? { kind: "template" as const, templateId }
        : {
            kind: "custom" as const,
            name: customName.trim() || "自定义角色",
            color: customColor,
            dimensions: { ...dims, freeform: freeform.trim() || undefined },
          };
    const r = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserToken,
        nickname,
        mode,
        topic: topic.trim() || undefined,
        role,
      }),
    });
    if (r.ok) {
      const { id } = await r.json();
      router.push(`/room/${id}`);
    } else {
      setSubmitting(false);
      alert("创建失败：" + (await r.text()));
    }
  }

  if (!catalog) {
    return <main className="p-8 text-slate-400">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← 返回
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">创建房间</h1>

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
        <h2 className="text-sm font-medium text-slate-700">选模式</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {catalog.modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-md border px-3 py-3 text-left text-sm ${
                mode === m.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              <div className="font-medium">{m.label}</div>
              <div className={`mt-1 text-xs ${mode === m.id ? "text-slate-200" : "text-slate-500"}`}>
                {m.description}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-700">选角色</h2>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setRoleKind("template")}
            className={`rounded-md px-3 py-1.5 text-sm ${roleKind === "template" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            模板
          </button>
          <button
            onClick={() => setRoleKind("custom")}
            className={`rounded-md px-3 py-1.5 text-sm ${roleKind === "custom" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            自定义
          </button>
        </div>
        {roleKind === "template" ? (
          <div className="mt-3 grid gap-2">
            {catalog.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={`flex items-center gap-3 rounded-md border px-3 py-3 text-left ${
                  templateId === t.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                }`}
              >
                <Avatar initials={t.initials} color={t.color} />
                <div>
                  <div className="text-sm font-medium text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="flex gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="角色名（如：王阳明、我妈、产品总监）"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
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
                      onClick={() =>
                        setDims((prev) => ({
                          ...prev,
                          [d.key]: prev[d.key] === o.value ? undefined : o.value,
                        }))
                      }
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        dims[d.key] === o.value
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
                value={freeform}
                onChange={(e) => setFreeform(e.target.value)}
                placeholder="想精确控制的细节..."
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-700">起手话题（可跳过）</h2>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="一句话开场"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      <div className="mt-10">
        <button
          onClick={() => void submit()}
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-4 py-3 text-white hover:bg-slate-800 disabled:bg-slate-400"
        >
          {submitting ? "进入中..." : "进入房间"}
        </button>
      </div>
    </main>
  );
}
