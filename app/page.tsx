"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WineCard = {
  id: string;
  name: string;
  style: string | null;
  tags: string[];
  price_yen: number | null;
  url: string;
  review_average: number | null;
  review_count: number | null;
};

function yen(n: number | null) {
  if (typeof n !== "number") return "—";
  return new Intl.NumberFormat("ja-JP").format(n) + "円";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// 楽天のSEO商品名を “処方箋向けタイトル” に整形
function cleanTitle(raw: string) {
  if (!raw) return "";
  const s = raw
    .replace(/【.*?】/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/（.*?）/g, "")
    .replace(/送料無料/g, "")
    .replace(/ギフト/g, "")
    .replace(/父の日|母の日|敬老の日|お中元|お歳暮|誕生日|内祝い/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 記号区切りっぽいのは前半を優先
  const cut = s.split(/[｜|／/]/)[0].trim();

  // 末尾が長すぎる場合は自然に省略
  return cut.length > 34 ? cut.slice(0, 34) + "…" : cut;
}

// “理由” をそれっぽく生成（いまは仮でOK）
function buildReason(w: WineCard) {
  const parts: string[] = [];
  if (typeof w.review_average === "number") parts.push(`評価が高い（★${w.review_average.toFixed(2)}）`);
  if (typeof w.review_count === "number" && w.review_count > 0) parts.push(`レビューが付いてる（${w.review_count}件）`);
  if (typeof w.price_yen === "number") {
    if (w.price_yen <= 2000) parts.push("気軽に試せる価格帯");
    else if (w.price_yen <= 5000) parts.push("ちょい良い日向けの価格帯");
    else parts.push("ご褒美・贈り物の価格帯");
  }
  if (w.style) parts.push(`${w.style}系の気分に合う`);
  return parts.slice(0, 3);
}

function styleLabel(style: string | null) {
  switch (style) {
    case "red":
      return "Red";
    case "white":
      return "White";
    case "sparkling":
      return "Sparkling";
    case "rose":
      return "Rosé";
    default:
      return "Wine";
  }
}

export default function Page() {
  const [items, setItems] = useState<WineCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch("/api/wines?limit=40");
      const json = await res.json();
      setItems(json.items ?? []);
      setLoading(false);
    })();
  }, []);

  const top = items[0];
  const next = items[1];

  const onSwipe = (dir: "left" | "right") => {
    if (!top) return;
    console.log(dir, top.id);
    setItems((prev) => prev.slice(1));
  };

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
        color: "#0f172a",
      }}
    >
      <Header count={items.length} />

      {loading && <Skeleton />}

      {!loading && !top && (
        <EmptyState
          onReload={async () => {
            setLoading(true);
            const res = await fetch("/api/wines?limit=40");
            const json = await res.json();
            setItems(json.items ?? []);
            setLoading(false);
          }}
        />
      )}

      {!loading && top && (
        <>
          <div style={{ position: "relative", height: 560, marginTop: 10 }}>
            {next && <PrescriptionCard key={next.id} wine={next} depth="back" />}
            <SwipeablePrescriptionCard key={top.id} wine={top} onSwipe={onSwipe} />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
            <GhostButton onClick={() => onSwipe("left")}>スキップ</GhostButton>

            <a
              href={top.url}
              target="_blank"
              rel="noreferrer"
              style={{
                flex: 1,
                textAlign: "center",
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              楽天で見る
            </a>

            <GhostButton onClick={() => onSwipe("right")}>いいね</GhostButton>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65, textAlign: "center" }}>
            右：いいね / 左：スキップ / 中央：購入導線
          </div>
        </>
      )}
    </main>
  );
}

function Header({ count }: { count: number }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.4 }}>WINE PRESCRIPTION</div>
        <div style={{ fontSize: 20, fontWeight: 900, marginTop: 2 }}>今日の一杯を、処方する</div>
      </div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{count} cards</div>
    </header>
  );
}

function Skeleton() {
  return (
    <div
      style={{
        marginTop: 14,
        height: 560,
        borderRadius: 22,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(90deg, #fff 0%, #fafafa 50%, #fff 100%)",
      }}
    />
  );
}

function EmptyState({ onReload }: { onReload: () => void }) {
  return (
    <div style={{ padding: 16, marginTop: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 16 }}>おしまい</div>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>もう一回、処方箋を引こう。</div>
      <button
        onClick={onReload}
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "white",
          fontWeight: 700,
        }}
      >
        もう一回引く
      </button>
    </div>
  );
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 14px",
        borderRadius: 16,
        border: "1px solid #e5e7eb",
        background: "white",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function PrescriptionCard({ wine, depth }: { wine: WineCard; depth: "front" | "back" }) {
  const title = cleanTitle(wine.name);
  const reason = buildReason(wine);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 22,
        border: "1px solid #e5e7eb",
        background: "white",
        boxShadow: depth === "front" ? "0 20px 50px rgba(0,0,0,0.10)" : "0 10px 30px rgba(0,0,0,0.06)",
        transform: depth === "front" ? "translateY(0)" : "translateY(10px) scale(0.985)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      {/* Top strip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.5 }}>PRESCRIPTION</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{styleLabel(wine.style)}</div>
      </div>

      {/* Main */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.25 }}>{title}</div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill label={styleLabel(wine.style)} />
          <Pill label={yen(wine.price_yen)} />
          {typeof wine.review_average === "number" && <Pill label={`★ ${wine.review_average.toFixed(2)}`} />}
          {typeof wine.review_count === "number" && <Pill label={`${wine.review_count}件`} />}
        </div>

        {/* Reason box */}
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 16,
            border: "1px solid #eef2f7",
            background: "#fbfdff",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.4 }}>Reason</div>
          <ul style={{ marginTop: 8, paddingLeft: 18, marginBottom: 0, fontSize: 13, lineHeight: 1.55 }}>
            {reason.length ? reason.map((r, i) => <li key={i} style={{ opacity: 0.85 }}>{r}</li>) : (
              <li style={{ opacity: 0.7 }}>理由はこれから育てる（診断ロジック導入で強化）</li>
            )}
          </ul>
        </div>

        {/* Flavor hint */}
        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
          {wine.tags?.length ? wine.tags.slice(0, 6).join(" / ") : "香りや味のタグはこれから育てる"}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.6 }}>Swipe to decide</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>→ Like / ← Skip</div>
      </div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #eef2f7",
        background: "#fafafa",
      }}
    >
      {label}
    </span>
  );
}

function SwipeablePrescriptionCard({
  wine,
  onSwipe,
}: {
  wine: WineCard;
  onSwipe: (dir: "left" | "right") => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const rotate = useMemo(() => clamp(dx / 16, -10, 10), [dx]);
  const likeOpacity = useMemo(() => clamp((dx - 45) / 90, 0, 1), [dx]);
  const nopeOpacity = useMemo(() => clamp((-dx - 45) / 90, 0, 1), [dx]);

  const threshold = 120;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
    setDy(e.clientY - start.current.y);
  };

  const end = () => {
    setDragging(false);

    if (dx > threshold) {
      animateOut("right");
      return;
    }
    if (dx < -threshold) {
      animateOut("left");
      return;
    }
    setDx(0);
    setDy(0);
  };

  const animateOut = (dir: "left" | "right") => {
    const el = ref.current;
    if (!el) {
      onSwipe(dir);
      return;
    }
    const toX = dir === "right" ? 620 : -620;
    el.style.transition = "transform 170ms ease";
    el.style.transform = `translate(${toX}px, ${dy}px) rotate(${rotate}deg)`;
    setTimeout(() => {
      onSwipe(dir);
      if (el) {
        el.style.transition = "";
        el.style.transform = "";
      }
      setDx(0);
      setDy(0);
    }, 170);
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={dragging ? onPointerMove : undefined}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
        transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`,
        transition: dragging ? "none" : "transform 220ms ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          opacity: likeOpacity,
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: 1.2,
        }}
      >
        LIKE
      </div>
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          opacity: nopeOpacity,
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: 1.2,
        }}
      >
        NOPE
      </div>
      <PrescriptionCard wine={wine} depth="front" />
    </div>
  );
}