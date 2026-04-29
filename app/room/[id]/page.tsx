"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RoomView } from "@/components/RoomView";
import { useRoomStore, type RoomMeta, type RoomMessage } from "@/lib/client/store";

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const init = useRoomStore((s) => s.init);
  const setEnded = useRoomStore((s) => s.setEnded);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/room/${id}`);
      if (!r.ok) {
        setError("房间不存在");
        return;
      }
      const data = await r.json();
      const meta: RoomMeta = {
        id: data.session.id,
        mode: data.session.mode,
        topic: data.session.topic,
        role: data.session.role,
        status: data.session.status,
      };
      const messages: RoomMessage[] = data.messages;
      init(meta, messages);
      if (data.session.status === "ended") setEnded();
      setLoaded(true);
    })();
  }, [id, init, setEnded]);

  if (error) {
    return <main className="p-8">{error}</main>;
  }
  if (!loaded) {
    return <main className="p-8 text-slate-400">加载中...</main>;
  }
  return <RoomView sessionId={id} />;
}
