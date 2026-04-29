import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Chorus / 对话场</h1>
      <p className="mt-3 text-slate-600">
        一个由主持人控场的多角色 AI 对话空间。
      </p>
      <div className="mt-10">
        <Link
          href="/new"
          className="inline-flex items-center rounded-md bg-slate-900 px-5 py-3 text-white hover:bg-slate-800"
        >
          创建房间
        </Link>
      </div>
      <p className="mt-16 text-sm text-slate-400">
        MVP v1 — scaffolding only. UI in progress.
      </p>
    </main>
  );
}
