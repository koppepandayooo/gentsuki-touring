"""JMPSA 二輪車通行規制区間情報 を取得して web/data/regulations.json に保存する。

出典: 一般社団法人日本二輪車普及安全協会 https://www.jmpsa.or.jp/society/roadinfo/
データは毎年6月更新なので、その後に再実行する。
"""
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.jmpsa.or.jp/society/roadinfo/"
OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "regulations.json"
DELAY = 0.7


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gentsuki-touring personal app"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def text(s):
    s = re.sub(r"<br\s*/?>", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def parse_detail(page):
    fields = dict(
        (text(k), text(v))
        for k, v in re.findall(
            r'regulation-table-ttl">(.*?)</p>\s*<p class="p-prefectures-regulation-table-txt">(.*?)</p>',
            page, re.S)
    )
    points = []
    for label, lat, lon in re.findall(
            r'map-list-ttl">(.*?)</p>.*?[?&]q=(-?[\d.]+),(-?[\d.]+)', page, re.S):
        points.append({"label": text(label), "lat": float(lat), "lon": float(lon)})
    return fields, points


def geocode_section(pref, section_html):
    """座標のない行は 地理院の住所検索で始点・終点のおおよその位置を出す（丁目〜町レベル）"""
    pts = []
    for part in re.split(r"<br\s*/?>", section_html)[:2]:
        addr = text(part)
        addr = re.sub(r"(から)?[～~〜].*$|まで.*$", "", addr)
        addr = re.sub(r"[（(].*", "", addr)
        addr = re.sub(r"(\d+番.*|\d+号.*|地先.*|先.*)$", "", addr).strip()
        if not addr:
            continue
        time.sleep(DELAY)
        try:
            q = urllib.parse.quote(pref + addr if not addr.startswith(pref) else addr)
            res = json.loads(get(f"https://msearch.gsi.go.jp/address-search/AddressSearch?q={q}"))
        except Exception:
            res = []
        if res:
            lon, lat = res[0]["geometry"]["coordinates"]
            pts.append({"label": text(part), "lat": lat, "lon": lon})
    return pts


def main():
    index = get(BASE)
    prefs = re.findall(r'href="(area-\d+-\d+\.html)" class="p-roadinfo-list-item-link">(.*?)<', index)
    results = []
    for href, pref in prefs:
        time.sleep(DELAY)
        page = get(BASE + href)
        rows = re.findall(r'<tr>(.*?)</tr>', page, re.S)
        for row in rows:
            tds = re.findall(r'<td class="p-east-area-table-txt[^"]*">(.*?)</td>', row, re.S)
            if len(tds) < 3:
                continue
            # 詳細ページ（座標つき）へのリンクがない行もある
            m = re.search(r'href="(area-[\d-]+\.html)"[^>]*>(.*?)</a>', row, re.S)
            ttl = re.search(r'traffic-ttl">(.*?)</p>', row, re.S)
            cid = re.search(r'\?x=(\d+)', row)
            cancelled = "解除されました" in row
            item = {
                "id": m.group(1).removesuffix(".html") if m else f"x{cid.group(1) if cid else len(results)}",
                "pref": pref,
                "road": text(m.group(2) if m else (ttl.group(1) if ttl else "")),
                "section": text(tds[0]),
                "target": text(tds[1]),
                "time": text(tds[2]),
                "cancelled": cancelled,
                "points": [],
            }
            if cancelled:
                pass
            elif m:
                time.sleep(DELAY)
                try:
                    _, item["points"] = parse_detail(get(BASE + m.group(1)))
                except Exception as e:  # 詳細が取れなくても一覧の情報は残す
                    print("  detail failed", item["id"], e)
            else:
                item["points"] = geocode_section(pref, tds[0])
                item["approx"] = True
            results.append(item)
        print(pref, sum(1 for r in results if r["pref"] == pref), flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "一般社団法人日本二輪車普及安全協会 二輪車通行規制区間情報",
        "sourceUrl": BASE,
        "fetched": time.strftime("%Y-%m-%d"),
        "items": results,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved", len(results), "->", OUT)


if __name__ == "__main__":
    main()
