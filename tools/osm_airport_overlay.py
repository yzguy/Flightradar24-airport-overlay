#!/usr/bin/env python3
"""Render an airport overlay image from OpenStreetMap data.

Usage: python3 tools/osm_airport_overlay.py KDFW [--size 3000] [--entry-only]

Writes images/airports/<ICAO>.png and data/airports/<ICAO>.json (the
taxiway network used for taxi routes), and adds the airport to
js/fr24-airport-overlay-data.js. Requires Pillow.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

from PIL import Image, ImageDraw, ImageFont

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "Flightradar24-airport-overlay/1.0"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPERSAMPLE = 2
PAD_M = 300

COLORS = {
    "apron": (120, 120, 120, 70),
    "terminal": (90, 110, 160, 170),
    "hangar": (110, 110, 110, 150),
    "runway": (35, 35, 35, 235),
    "runway_edge": (255, 255, 255, 255),
    "taxiway": (255, 205, 0, 230),
    "taxilane": (255, 225, 120, 170),
    "label_bg": (20, 20, 20, 240),
    "label_fg": (255, 215, 0, 255),
    "rwy_label_bg": (200, 20, 20, 245),
    "rwy_label_fg": (255, 255, 255, 255),
}

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
]


def overpass(query, servers, rounds=2):
    """Try each Overpass server in turn, moving on after an error or timeout."""
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for rnd in range(rounds):
        if rnd:
            print("All Overpass servers failed, retrying in 20s", file=sys.stderr)
            time.sleep(20)
        for url in servers:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = json.load(r)
                if "elements" not in data:
                    raise ValueError(data.get("remark", "response has no elements"))
                return data
            except (urllib.error.URLError, OSError, ValueError) as err:
                reason = getattr(err, "code", None) or getattr(err, "reason", None) or err
                print(f"{urllib.parse.urlsplit(url).netloc} failed ({reason}), trying next server", file=sys.stderr)
                errors.append(f"{url}: {reason}")
    sys.exit("Could not reach any Overpass server:\n  " + "\n  ".join(errors))


def mercator(lat, lng):
    x = (lng + 180.0) / 360.0
    s = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    return x, y


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def ways(elements):
    """Yield (tags, [[(lat, lng), ...], ...], closed) for ways and multipolygon outers."""
    for e in elements:
        if e["type"] == "way" and "geometry" in e:
            pts = [(p["lat"], p["lon"]) for p in e["geometry"]]
            yield e["tags"], [pts], len(pts) > 3 and pts[0] == pts[-1]
        elif e["type"] == "relation":
            rings = [
                [(p["lat"], p["lon"]) for p in m["geometry"]]
                for m in e.get("members", [])
                if m.get("role") == "outer" and "geometry" in m
            ]
            if rings:
                yield e["tags"], rings, True


def taxi_graph(icao, elements):
    """Taxiway/runway centerlines with shared OSM node ids, for routing in js/fr24-taxi-route.js."""
    nodes, out_ways = {}, []
    for e in elements:
        kind = e.get("tags", {}).get("aeroway")
        if e["type"] != "way" or kind not in ("taxiway", "taxilane", "runway"):
            continue
        ids = e.get("nodes", [])
        if len(ids) < 2 or ids[0] == ids[-1]:
            continue
        for nid, p in zip(ids, e["geometry"]):
            nodes[str(nid)] = [round(p["lat"], 7), round(p["lon"], 7)]
        out_ways.append({"type": kind, "ref": e["tags"].get("ref", ""), "nodes": ids})
    return {
        "icao": icao,
        "attribution": "Data \u00a9 OpenStreetMap contributors (ODbL)",
        "nodes": nodes,
        "ways": out_ways,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("icao")
    ap.add_argument("--size", type=int, default=3000, help="pixels on the longest side")
    ap.add_argument("--overpass", action="append", metavar="URL",
                    help="Overpass API endpoint to use instead of the built-in list (repeatable)")
    ap.add_argument("--entry-only", action="store_true",
                    help="only add the airport list entry for an image and taxi graph generated earlier")
    args = ap.parse_args()
    icao = args.icao.upper()
    servers = args.overpass or OVERPASS_SERVERS

    res = overpass(f'[out:json][timeout:60];nwr["aeroway"="aerodrome"]["icao"="{icao}"];out tags bb;', servers)
    aero = [e for e in res["elements"] if "bounds" in e]
    if not aero:
        sys.exit(f"No aerodrome with icao={icao} found in OpenStreetMap")
    a = aero[0]
    b = a["bounds"]
    dlat = PAD_M / 111320.0
    dlng = PAD_M / (111320.0 * math.cos(math.radians((b["minlat"] + b["maxlat"]) / 2)))
    s, w, n, e = b["minlat"] - dlat, b["minlon"] - dlng, b["maxlat"] + dlat, b["maxlon"] + dlng

    x0, y0 = mercator(n, w)
    x1, y1 = mercator(s, e)
    scale = args.size / max(x1 - x0, y1 - y0)
    W, H = round((x1 - x0) * scale), round((y1 - y0) * scale)

    tags = a.get("tags", {})
    entry = {
        "neBoundLat": round(n, 6), "neBoundLng": round(e, 6),
        "swBoundLat": round(s, 6), "swBoundLng": round(w, 6),
        "name": tags.get("name:en") or tags.get("name", icao),
        "IATA": tags.get("iata", ""), "ICAO": icao,
        "uploader": "OpenStreetMap contributors", "email": "",
        "date": date.today().year, "image": f"{icao}.png",
        "taxiGraph": f"{icao}.json",
    }
    out = os.path.join(REPO, "images", "airports", f"{icao}.png")
    graph_out = os.path.join(REPO, "data", "airports", f"{icao}.json")

    if args.entry_only:
        # The bounds only fit the existing image if OpenStreetMap's airport outline hasn't changed.
        if not (os.path.exists(out) and os.path.exists(graph_out)):
            sys.exit(f"{out} or {graph_out} is missing; run without --entry-only to generate them")
        size = Image.open(out).size
        if size != (W, H):
            sys.exit(f"{out} is {size[0]}x{size[1]} but the current OpenStreetMap bounds give {W}x{H}; "
                     "regenerate the image by running without --entry-only")
        update_data_file(entry)
        return

    data = overpass(f'[out:json][timeout:120];(way["aeroway"]({s},{w},{n},{e});relation["aeroway"]({s},{w},{n},{e}););out geom;', servers)
    elements = data["elements"]
    ss = SUPERSAMPLE
    metres_per_px = 40075016.686 * math.cos(math.radians((s + n) / 2)) / scale

    def px(lat, lng):
        x, y = mercator(lat, lng)
        return ((x - x0) * scale * ss, (y - y0) * scale * ss)

    def width_px(tags, default_m, min_px):
        try:
            m = float(str(tags.get("width", default_m)).split()[0])
        except ValueError:
            m = default_m
        return max(min_px, m / metres_per_px) * ss

    img = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def fill_area(kind):
        for tags, rings, closed in ways(elements):
            if tags.get("aeroway") == kind and closed:
                for ring in rings:
                    d.polygon([px(*p) for p in ring], fill=COLORS[kind])

    for kind in ("apron", "hangar", "terminal"):
        fill_area(kind)

    def stroke(kind, default_m, min_px):
        for tags, rings, closed in ways(elements):
            if tags.get("aeroway") == kind and not closed:
                wpx = width_px(tags, default_m, min_px)
                for ring in rings:
                    d.line([px(*p) for p in ring], fill=COLORS[kind], width=round(wpx), joint="curve")

    stroke("taxilane", 8, 2)
    stroke("taxiway", 23, 4)

    runways = {}
    for tags, rings, closed in ways(elements):
        if tags.get("aeroway") == "runway" and not closed:
            wpx = width_px(tags, 45, 8)
            for ring in rings:
                pts = [px(*p) for p in ring]
                d.line(pts, fill=COLORS["runway_edge"], width=round(wpx + 3 * ss))
                d.line(pts, fill=COLORS["runway"], width=round(wpx))
                d.line(pts, fill=COLORS["runway_edge"], width=max(1, ss))
                runways.setdefault(tags.get("ref", ""), []).extend(ring)

    # Image is scaled down at the end, so draw labels at supersampled size.
    placed = []

    def label(text, cx, cy, fnt, bg, fg, force=False):
        l, t, r, btm = d.textbbox((0, 0), text, font=fnt)
        pad = 4 * ss
        bw, bh = r - l + 2 * pad, btm - t + 2 * pad
        box = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        if box[0] < 0 or box[1] < 0 or box[2] > W * ss or box[3] > H * ss:
            return False
        if not force and any(not (box[2] < p[0] or box[0] > p[2] or box[3] < p[1] or box[1] > p[3]) for p in placed):
            return False
        placed.append(box)
        d.rounded_rectangle(box, radius=3 * ss, fill=bg)
        d.text((box[0] + pad - l, box[1] + pad - t), text, font=fnt, fill=fg)
        return True

    rwy_font = font(26 * ss)
    for ref, pts in runways.items():
        ends = ref.split("/")
        if len(ends) != 2:
            continue
        p, q = max(((p, q) for p in pts for q in pts), key=lambda pq: (pq[0][0] - pq[1][0]) ** 2 + (pq[0][1] - pq[1][1]) ** 2)
        bearing = math.degrees(math.atan2(
            (q[1] - p[1]) * math.cos(math.radians(p[0])), q[0] - p[0])) % 360
        hdg = int("".join(c for c in ends[0] if c.isdigit()) or 0) * 10
        if abs((bearing - hdg + 180) % 360 - 180) > 90:
            p, q = q, p
        (px0, py0), (px1, py1) = px(*p), px(*q)
        rlen = math.hypot(px1 - px0, py1 - py0) or 1
        ux, uy = (px1 - px0) / rlen, (py1 - py0) / rlen
        off = 28 * ss
        label(ends[0], px0 - ux * off, py0 - uy * off, rwy_font, COLORS["rwy_label_bg"], COLORS["rwy_label_fg"], force=True)
        label(ends[1], px1 + ux * off, py1 + uy * off, rwy_font, COLORS["rwy_label_bg"], COLORS["rwy_label_fg"], force=True)

    tw_font = font(19 * ss)
    segs = {}
    for tags, rings, closed in ways(elements):
        ref = tags.get("ref", "")
        # Numeric refs on taxilanes are gate lead-ins, not taxiway names.
        if tags.get("aeroway") in ("taxiway", "taxilane") and ref and not ref.isdigit() and not closed:
            for ring in rings:
                segs.setdefault(tags["ref"], []).append([px(*p) for p in ring])
    def point_at(pts, dist):
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            seg = math.hypot(bx - ax, by - ay)
            if dist <= seg:
                t = dist / seg if seg else 0
                return ax + (bx - ax) * t, ay + (by - ay) * t
            dist -= seg
        return pts[-1]

    def length(pts):
        return sum(math.hypot(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(pts, pts[1:]))

    spacing = 450 * ss
    for ref, lines in sorted(segs.items(), key=lambda kv: len(kv[0])):
        lines = sorted(lines, key=length, reverse=True)
        placed_any = False
        for pts in lines:
            total = length(pts)
            dist = spacing / 2
            while dist <= total - spacing / 4:
                placed_any |= label(ref, *point_at(pts, dist), tw_font, COLORS["label_bg"], COLORS["label_fg"])
                dist += spacing
        for pts in lines:
            if placed_any:
                break
            placed_any = label(ref, *point_at(pts, length(pts) / 2), tw_font, COLORS["label_bg"], COLORS["label_fg"])

    attr = "Data \u00a9 OpenStreetMap contributors (ODbL)"
    af = font(12 * ss)
    l, t, r, btm = d.textbbox((0, 0), attr, font=af)
    d.text((W * ss - (r - l) - 8 * ss, H * ss - (btm - t) - 8 * ss), attr, font=af, fill=(255, 255, 255, 200))

    img = img.resize((W, H), Image.LANCZOS)
    img.save(out, optimize=True)

    os.makedirs(os.path.dirname(graph_out), exist_ok=True)
    with open(graph_out, "w") as f:
        json.dump(taxi_graph(icao, elements), f, separators=(",", ":"))

    print(f"Wrote {out} ({W}x{H}, {os.path.getsize(out) // 1024} KB, {metres_per_px:.1f} m/px)", file=sys.stderr)
    print(f"Wrote {graph_out} ({os.path.getsize(graph_out) // 1024} KB)", file=sys.stderr)
    update_data_file(entry)


def update_data_file(entry):
    """Add or replace this airport in js/fr24-airport-overlay-data.js, keeping the list sorted by ICAO."""
    path = os.path.join(REPO, "js", "fr24-airport-overlay-data.js")
    with open(path) as f:
        src = f.read()
    entries, cur = [], None
    for line in src.splitlines():
        line = line.strip()
        if line == "{":
            cur = {}
        elif line.startswith("}") and cur is not None:
            entries.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            k, v = line.split(":", 1)
            cur[k.strip()] = json.loads(v.strip().rstrip(","))
    action = "Updated" if any(x["ICAO"] == entry["ICAO"] for x in entries) else "Added"
    entries = sorted([x for x in entries if x["ICAO"] != entry["ICAO"]] + [entry], key=lambda x: x["ICAO"])
    lines = ["var fr24_airport_overlay_data = ["]
    for x in entries:
        lines += ["\t{"] + [f"\t\t{k}: {json.dumps(v)}," for k, v in x.items()] + ["\t},"]
    lines.append("\t]")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{action} {entry['ICAO']} in {os.path.relpath(path, REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
