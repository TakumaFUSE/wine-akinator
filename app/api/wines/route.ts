import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function pickBestOffer(offers: any[]) {
  if (!offers?.length) return null;

  // 価格があるなら最安、なければ先頭
  const withPrice = offers.filter((o) => typeof o.price_yen === "number");
  if (withPrice.length) {
    withPrice.sort((a, b) => a.price_yen - b.price_yen);
    return withPrice[0];
  }
  return offers[0];
}

// 楽天のSEOモリモリ商品名を「人が読むタイトル」に整形
function cleanTitle(raw: string) {
  if (!raw) return "";

  const s = raw
    // 括弧系ノイズ除去
    .replace(/【.*?】/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    // ギフト・販促ワード（よく出るやつ）
    .replace(/送料無料/g, "")
    .replace(/ギフト/g, "")
    .replace(/プレゼント/g, "")
    .replace(/ラッピング/g, "")
    .replace(/熨斗/g, "")
    .replace(/父の日|母の日|敬老の日|お中元|お歳暮|誕生日|内祝い|御祝|御礼|御歳暮|御中元/g, "")
    // 余計な空白を圧縮
    .replace(/\s+/g, " ")
    .trim();

  // 記号区切り（｜ / ／ |）がある場合は前半を優先
  const head = s.split(/[｜|／/]/)[0].trim();

  // 末尾を読みやすくトリム
  const maxLen = 38;
  if (head.length <= maxLen) return head;
  return head.slice(0, maxLen) + "…";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 30), 80);

  const supabase = supabaseServer();

  // wine + offer をまとめて取る（FKがある想定でネストselect）
  const { data, error } = await supabase
    .from("wine")
    .select(
      `
      id,
      display_name,
      style,
      tags,
      offer (
        merchant,
        url,
        price_yen,
        review_average,
        review_count
      )
    `.trim()
    )
    .limit(800); // 多めに取ってサーバー側でshuffle

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? [])
    .map((w: any) => {
      const offers = (w.offer ?? []).filter((o: any) => o.merchant === "rakuten");
      const best = pickBestOffer(offers);

      return {
        id: w.id,
        name: cleanTitle(w.display_name),
        style: w.style,
        tags: w.tags ?? [],
        price_yen: best?.price_yen ?? null,
        url: best?.url ?? null,
        review_average: best?.review_average ?? null,
        review_count: best?.review_count ?? null,
      };
    })
    .filter((x: any) => x.url); // アフィリンクないのは除外

  // shuffle（Fisher-Yates）
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  return NextResponse.json({ items: rows.slice(0, limit) });
}