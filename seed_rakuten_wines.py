"""
seed_rakuten_wines.py (Stratified sampling by keyword x price-range)
- Rakuten Ichiba Item Search API から、keyword×価格帯×sort で分散取得（全セグメント一巡）
- 収集後、keyword×価格帯の各セグメントから均等にサンプリングして300本に整形
- Supabase(Postgres) の wine / offer テーブルへ投入（重複は wine.source_item_code でupsert）
- 429はリトライ、0件でも安全停止

ENV:
  export RAKUTEN_APP_ID="..."
  export RAKUTEN_ACCESS_KEY="..."
  export RAKUTEN_AFFILIATE_ID="..."             # 任意
  export RAKUTEN_ORIGIN="https://wine-akinator-app.vercel.app"
  export RAKUTEN_REFERER="https://wine-akinator-app.vercel.app/"
  export SUPABASE_URL="https://xxxx.supabase.co"
  export SUPABASE_SERVICE_ROLE_KEY="..."        # Legacy service_role key
"""

import os
import time
import math
import random
from typing import Any, Dict, List, Tuple, Optional

import requests
from supabase import create_client, Client


# ========= ENV =========
RAKUTEN_APP_ID = os.environ["RAKUTEN_APP_ID"]
RAKUTEN_ACCESS_KEY = os.environ["RAKUTEN_ACCESS_KEY"]
RAKUTEN_AFFILIATE_ID = os.getenv("RAKUTEN_AFFILIATE_ID")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

ORIGIN = os.getenv("RAKUTEN_ORIGIN", "https://wine-akinator-app.vercel.app")
REFERER = os.getenv("RAKUTEN_REFERER", "https://wine-akinator-app.vercel.app/")


# ========= Rakuten =========
ITEM_SEARCH_ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601"
FORMAT_VERSION = 2
HITS = 30  # max

# affiliateRate は elements に入れると 400 になりがちなので入れない
ELEMENTS = ",".join(
    [
        "itemCode",
        "itemName",
        "itemPrice",
        "itemUrl",
        "affiliateUrl",
        "mediumImageUrls",
        "reviewCount",
        "reviewAverage",
        "genreId",
        "shopName",
        "shopCode",
        "tagIds",
    ]
)


# ========= Collection Plan =========
TARGET = 300

# sortは “取り方の分散” 用（均等化の軸には含めない）
SORTS: List[str] = ["-reviewCount", "-reviewAverage", "-affiliateRate", "standard"]

# 均等化の軸：keyword × price-range
KEYWORDS: List[str] = [
    "赤ワイン 750ml",
    "白ワイン 750ml",
    "スパークリングワイン 750ml",
    "ロゼワイン 750ml",
    "フランス ワイン 750ml",
    "イタリア ワイン 750ml",
]

PRICE_RANGES: List[Tuple[Optional[int], Optional[int]]] = [
    (0, 2000),
    (2000, 5000),
    (5000, 10000),
    (10000, None),
]

# 1セグメント(kw×price)で集めたい候補数（sortを回して合計でこのくらい集める）
# 例: 1セグメントで目標 24 なら、sort 4本で各 6 くらい集まるイメージ
CANDIDATES_PER_SEGMENT = 24

# 429対策：間隔
BASE_SLEEP = 0.22


# ========= Helpers =========
def _extract_error_message(j: Any) -> Optional[str]:
    if not isinstance(j, dict):
        return None
    for k in ["error", "error_description", "errorMessage", "message"]:
        v = j.get(k)
        if isinstance(v, str) and v.strip():
            return f"{k}: {v}"
    if "errors" in j and isinstance(j["errors"], list) and j["errors"]:
        return f"errors: {j['errors'][:1]}"
    return None


def rakuten_get(params: Dict[str, Any]) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {RAKUTEN_ACCESS_KEY}",
        "Origin": ORIGIN,
        "Referer": REFERER,
    }

    base_params: Dict[str, Any] = {
        "applicationId": RAKUTEN_APP_ID,
        "accessKey": RAKUTEN_ACCESS_KEY,  # gatekeeper workaround
        "format": "json",
        "formatVersion": FORMAT_VERSION,
    }
    if RAKUTEN_AFFILIATE_ID:
        base_params["affiliateId"] = RAKUTEN_AFFILIATE_ID

    max_attempts = 6
    backoff = 0.7

    for attempt in range(1, max_attempts + 1):
        time.sleep(BASE_SLEEP + random.random() * 0.15)

        r = requests.get(
            ITEM_SEARCH_ENDPOINT,
            headers=headers,
            params={**base_params, **params},
            timeout=30,
        )

        if r.status_code in (429, 500, 502, 503, 504):
            wait = backoff * (2 ** (attempt - 1)) + random.random() * 0.25
            print(f"[rakuten] retryable status={r.status_code} attempt={attempt}/{max_attempts} wait={wait:.2f}s")
            time.sleep(wait)
            continue

        if r.status_code >= 400:
            print("[rakuten] http error body:", r.text[:800])
            r.raise_for_status()

        j = r.json()

        emsg = _extract_error_message(j)
        if emsg:
            print("[rakuten] api returned error JSON:", emsg)
            print("[rakuten] raw json keys:", list(j.keys())[:30])
            raise RuntimeError(emsg)

        return j

    r.raise_for_status()
    return {}  # unreachable


def _normalize_items(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(data, dict):
        return []
    if isinstance(data.get("items"), list):
        return [x for x in data["items"] if isinstance(x, dict)]
    if isinstance(data.get("Items"), list):
        out = []
        for x in data["Items"]:
            if isinstance(x, dict):
                if "Item" in x and isinstance(x["Item"], dict):
                    out.append(x["Item"])
                else:
                    out.append(x)
        return out
    if isinstance(data.get("item"), dict):
        return [data["item"]]
    if isinstance(data.get("Item"), dict):
        return [data["Item"]]
    return []


def normalize_style(item_name: str) -> str:
    name = (item_name or "").lower()
    if "スパークリング" in item_name or "sparkling" in name or "シャンパン" in item_name:
        return "sparkling"
    if "ロゼ" in item_name or "rose" in name:
        return "rose"
    if "白" in item_name or "ホワイト" in item_name:
        return "white"
    if "赤" in item_name or "レッド" in item_name:
        return "red"
    return "other"


def extract_tags(item_name: str) -> List[str]:
    candidates = [
        "スモーキー",
        "ミネラル",
        "果実味",
        "樽香",
        "ビター",
        "フローラル",
        "すっきり",
        "濃厚",
        "軽やか",
        "辛口",
        "甘口",
    ]
    return [t for t in candidates if t in (item_name or "")]


def item_to_rows(item: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    item_code = item.get("itemCode")
    item_name = item.get("itemName") or ""
    price = item.get("itemPrice")
    item_url = item.get("affiliateUrl") or item.get("itemUrl")
    review_count = item.get("reviewCount")
    review_avg = item.get("reviewAverage")

    tags = extract_tags(item_name)
    style = normalize_style(item_name)

    wine_row = {
        "source": "rakuten",
        "source_item_code": item_code,
        "display_name": item_name[:255],
        "style": style,
        "country": None,
        "region": None,
        "grapes": None,
        "tags": tags,
        "spice_tags": [],
        "v_social": 50,
        "v_adventure": 50,
        "v_light": 50,
        "v_food": 50,
    }

    offer_row = {
        "merchant": "rakuten",
        "url": item_url,
        "price_yen": int(price) if isinstance(price, (int, float)) else None,
        "review_count": int(review_count) if isinstance(review_count, (int, float)) else None,
        "review_average": float(review_avg) if str(review_avg or "").strip() != "" else None,
    }

    return wine_row, offer_row


def fetch_segment(keyword: str, sort: str, min_price: Optional[int], max_price: Optional[int], target: int) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen = set()
    page = 1

    while len(items) < target and page <= 100:
        params: Dict[str, Any] = {
            "hits": HITS,
            "page": page,
            "sort": sort,
            "elements": ELEMENTS,
            "keyword": keyword,
        }
        if min_price is not None:
            params["minPrice"] = min_price
        if max_price is not None:
            params["maxPrice"] = max_price

        data = rakuten_get(params)
        batch = _normalize_items(data)
        if not batch:
            break

        for it in batch:
            code = it.get("itemCode")
            if not code or code in seen:
                continue
            seen.add(code)
            items.append(it)
            if len(items) >= target:
                break

        count = data.get("count") or data.get("Count") or 0
        hits = data.get("hits") or data.get("Hits") or HITS
        try:
            last_page = math.ceil(int(count) / int(hits)) if count else page
        except Exception:
            last_page = page

        if page >= last_page:
            break
        page += 1

    return items


def chunk_list(xs: List[Any], n: int) -> List[List[Any]]:
    return [xs[i : i + n] for i in range(0, len(xs), n)]


def segment_key(keyword: str, mn: Optional[int], mx: Optional[int]) -> str:
    return f"{keyword}|{mn if mn is not None else '0'}-{mx if mx is not None else 'inf'}"


def stratified_sample(
    segment_items: Dict[str, Dict[str, Dict[str, Any]]],
    target: int,
) -> List[Dict[str, Any]]:
    """
    segment_items: seg_key -> {itemCode -> item}
    1) each segment: sample floor(target / #segments)
    2) fill remainder from global pool (deduped)
    """
    seg_keys = list(segment_items.keys())
    random.shuffle(seg_keys)

    m = len(seg_keys)
    if m == 0:
        return []

    per = target // m  # base per-segment
    remainder = target - per * m

    picked: Dict[str, Dict[str, Any]] = {}

    # 1) base per segment
    for sk in seg_keys:
        pool = list(segment_items[sk].values())
        random.shuffle(pool)
        for it in pool[:per]:
            code = it.get("itemCode")
            if code and code not in picked:
                picked[code] = it

    # 2) distribute remainder: one extra from first 'remainder' segments if available
    if remainder > 0:
        for sk in seg_keys[:remainder]:
            pool = list(segment_items[sk].values())
            random.shuffle(pool)
            for it in pool:
                code = it.get("itemCode")
                if code and code not in picked:
                    picked[code] = it
                    break

    # 3) if still short (some segments sparse), fill from global pool
    if len(picked) < target:
        global_pool: List[Dict[str, Any]] = []
        for sk in seg_keys:
            global_pool.extend(segment_items[sk].values())
        random.shuffle(global_pool)

        for it in global_pool:
            code = it.get("itemCode")
            if code and code not in picked:
                picked[code] = it
            if len(picked) >= target:
                break

    return list(picked.values())[:target]


def main():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # seg_key -> { itemCode -> item }
    segment_items: Dict[str, Dict[str, Dict[str, Any]]] = {}

    # 全セグメント（kw×price）を必ず一巡する
    for kw in KEYWORDS:
        for (mn, mx) in PRICE_RANGES:
            sk = segment_key(kw, mn, mx)
            segment_items[sk] = {}

            # このセグメントで欲しい候補を sort で分散取得
            # 例: 24候補/seg, sort4つ → 各6件ずつ
            per_sort = max(1, CANDIDATES_PER_SEGMENT // max(1, len(SORTS)))

            print(f"[segment] {sk} target_candidates={CANDIDATES_PER_SEGMENT} (per_sort={per_sort})")

            for s in SORTS:
                got = fetch_segment(kw, s, mn, mx, per_sort)
                print(f"  [sort] {s} got={len(got)}")

                for it in got:
                    code = it.get("itemCode")
                    if code:
                        segment_items[sk][code] = it

            print(f"[segment] candidates in seg: {len(segment_items[sk])}")

    # 均等化（keyword×price）
    items_list = stratified_sample(segment_items, TARGET)
    print(f"[final] stratified sampled items: {len(items_list)}")

    if not items_list:
        print("[stop] 0 items fetched. Not writing to Supabase.")
        return

    # Convert to rows
    wine_rows: List[Dict[str, Any]] = []
    offer_rows_by_code: Dict[str, Dict[str, Any]] = {}

    for it in items_list:
        wine_row, offer_row = item_to_rows(it)
        code = wine_row.get("source_item_code")
        if not code:
            continue
        wine_rows.append(wine_row)
        offer_rows_by_code[code] = offer_row

    if not wine_rows:
        print("[stop] wine_rows is empty. Not writing to Supabase.")
        return

    # Upsert wines
    print(f"[supabase] upserting wine rows: {len(wine_rows)}")
    supabase.table("wine").upsert(wine_rows, on_conflict="source_item_code").execute()

    # Fetch wine ids
    codes = [w["source_item_code"] for w in wine_rows if w.get("source_item_code")]
    wine_id_map: Dict[str, str] = {}
    for chunk in chunk_list(codes, 200):
        resp = supabase.table("wine").select("id,source_item_code").in_("source_item_code", chunk).execute()
        for row in (resp.data or []):
            wine_id_map[row["source_item_code"]] = row["id"]

    # Offers
    offer_rows: List[Dict[str, Any]] = []
    for code, offer_row in offer_rows_by_code.items():
        wid = wine_id_map.get(code)
        if not wid:
            continue
        offer_rows.append({"wine_id": wid, **offer_row})

    wine_ids = list({row["wine_id"] for row in offer_rows})
    print(f"[supabase] refreshing offers for wines: {len(wine_ids)}")
    for chunk in chunk_list(wine_ids, 200):
        supabase.table("offer").delete().eq("merchant", "rakuten").in_("wine_id", chunk).execute()

    print(f"[supabase] inserting offer rows: {len(offer_rows)}")
    for chunk in chunk_list(offer_rows, 200):
        supabase.table("offer").insert(chunk).execute()

    print("[done] seeded wines + offers into Supabase.")
    print("Check Supabase Table Editor: wine / offer")


if __name__ == "__main__":
    main()