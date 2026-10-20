"""
Turn the cached EuroLeague play-by-play into the static JSON the viewer
reads. Mirrors the OptykMedia NBA assist-network schema:

  public/data/assist_networks/{CLUB}_{SEASON}.json
      { team_abbr, season, nodes:[{player_id, name, x, y}],
        edges:[[a, b, count]], directed:[[passer, scorer, count]], modularity }
  public/data/assist_plays/{CLUB}_{SEASON}.json
      { team_abbr, season, plays:[{gameId, actionNumber, passerId, scorerId,
        description, location, opponent, round, quarter, time}] }
  public/data/team_quintiles.json   league cutoffs + ranked lists
  public/data/meta.json             season label, rounds played, club list

    python pipeline/build.py
"""
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache"
OUT = ROOT / "public" / "data"
SEASON_CODE = "E2026"
SEASON = "2026-27"
TOP_N = 12          # players per network (as the reference)
MIN_EDGE = 2        # undirected pair must share >= this many assists to draw
SCORING = {"2FGM": "2PT", "3FGM": "3PT", "FTM": "FT"}
QUARTERS = [("FirstQuarter", "Q1"), ("SecondQuarter", "Q2"),
            ("ThirdQuarter", "Q3"), ("ForthQuarter", "Q4"), ("ExtraTime", "OT")]


def pid(raw):
    """PBP ids look like 'P010568   '; people codes are '010568'."""
    return (raw or "").strip()


def short_name(full):
    """'JONES, CHRIS' -> 'C. Jones'; 'MIRANDA SANCHEZ, ALBERTO' -> 'A. Miranda Sanchez'."""
    if not full:
        return "?"
    if "," in full:
        last, first = [s.strip() for s in full.split(",", 1)]
    else:
        parts = full.split()
        last, first = parts[-1], " ".join(parts[:-1])
    def cap(w):
        return "-".join("'".join(x.capitalize() for x in h.split("'")) for h in w.split("-"))
    last_t = " ".join(cap(w) for w in last.lower().split())
    # Keep particles lowercase-ish readable: "DE COLO" -> "De Colo" is fine.
    initial = (first[:1] + ".") if first else ""
    return f"{initial} {last_t}".strip()


def last_name(full):
    return short_name(full).split(" ", 1)[1] if " " in short_name(full) else short_name(full)


def load_cache():
    games = {g["gameCode"]: g for g in json.loads((CACHE / "games.json").read_text())}
    clubs = json.loads((CACHE / "clubs.json").read_text())["data"]
    people = {}
    for c in clubs:
        for p in json.loads((CACHE / "people" / f"{c['code']}.json").read_text()):
            if p["type"] != "J":
                continue
            code = "P" + p["person"]["code"]
            people[code] = {
                "id": code,
                "club": c["code"],
                "name": p["person"]["name"],
                "short": short_name(p["person"]["name"]),
                "dorsal": p.get("dorsal") or "",
                "position": p.get("positionName") or "",
                "headshot": (p.get("images") or {}).get("headshot") or "",
            }
    return games, clubs, people


def parse_game(code, game, pbp):
    """Yield one record per assist: (team, passer, scorer, play dict)."""
    home = game["local"]["club"]["code"]
    away = game["road"]["club"]["code"]
    out = []
    for qkey, qlabel in QUARTERS:
        rows = pbp.get(qkey) or []
        for i, r in enumerate(rows):
            if r["PLAYTYPE"] != "AS":
                continue
            team = r["CODETEAM"].strip()
            passer = pid(r["PLAYER_ID"])
            # Walk back to the nearest scoring row by the same team. Almost
            # always the immediately preceding same-team row; the window
            # guards against the rare stray rebound/FTA row in between.
            scorer_row = None
            for j in range(i - 1, max(-1, i - 8), -1):
                rj = rows[j]
                if rj["CODETEAM"].strip() == team and rj["PLAYTYPE"] in SCORING:
                    scorer_row = rj
                    break
            if not scorer_row or not passer:
                continue
            scorer = pid(scorer_row["PLAYER_ID"])
            if not scorer or scorer == passer:
                continue
            m = re.search(r"\((\d+)\)", r.get("PLAYINFO") or "")
            n_ast = m.group(1) if m else ""
            kind = SCORING[scorer_row["PLAYTYPE"]]
            pts = {"2PT": 2, "3PT": 3, "FT": 1}[kind]
            out.append({
                "team": team,
                "passerId": passer,
                "scorerId": scorer,
                "scorerName": scorer_row.get("PLAYER") or "",
                "passerName": r.get("PLAYER") or "",
                "play": {
                    "gameId": str(code),
                    "actionNumber": r["NUMBEROFPLAY"],
                    "round": game["round"],
                    "quarter": qlabel,
                    "time": r.get("MARKERTIME") or "",
                    "kind": kind,
                    "pts": pts,
                    "nAst": n_ast,
                    "location": "vs" if team == home else "at",
                    "opponent": away if team == home else home,
                },
            })
    return out


def validate(code, box, parsed):
    """Compare parsed assists per team with the boxscore totals."""
    got = Counter(p["team"] for p in parsed)
    problems = []
    for t in box.get("Stats") or []:
        team_code = (t["PlayersStats"][0]["Team"] if t.get("PlayersStats") else "").strip()
        want = (t.get("totr") or {}).get("Assistances")
        if want is None or not team_code:
            continue
        if got.get(team_code, 0) != want:
            problems.append(f"game {code} {team_code}: parsed {got.get(team_code, 0)} vs box {want}")
    return problems


def entropy(directed_out, n):
    total = sum(directed_out.values())
    if n <= 1 or total == 0:
        return 0.0
    h = -sum((v / total) * math.log2(v / total) for v in directed_out.values() if v > 0)
    return h / math.log2(n)


def build_team(team, records, people):
    directed = Counter()
    for r in records:
        directed[(r["passerId"], r["scorerId"])] += 1
    totals = Counter()
    names = {}
    for (a, b), c in directed.items():
        totals[a] += c
        totals[b] += c
    for r in records:
        names.setdefault(r["passerId"], r["passerName"])
        names.setdefault(r["scorerId"], r["scorerName"])
    top = [p for p, _ in totals.most_common(TOP_N)]
    keep = set(top)

    und = Counter()
    for (a, b), c in directed.items():
        if a in keep and b in keep:
            und[tuple(sorted((a, b)))] += c
    edges = [[a, b, c] for (a, b), c in und.items() if c >= MIN_EDGE]
    edges.sort(key=lambda e: -e[2])
    directed_list = [[a, b, c] for (a, b), c in directed.items() if a in keep and b in keep]
    directed_list.sort(key=lambda e: -e[2])

    G = nx.Graph()
    G.add_nodes_from(top)
    for a, b, c in edges:
        G.add_edge(a, b, weight=c)
    if G.number_of_edges():
        comms = nx.community.greedy_modularity_communities(G, weight="weight")
        modularity = nx.community.modularity(G, comms, weight="weight")
        pos = nx.spring_layout(G, weight="weight", seed=7, k=1.6, iterations=300)
    else:
        modularity = 0.0
        pos = {p: (math.cos(i), math.sin(i)) for i, p in enumerate(top)}
    # Normalise by the spread of the CONNECTED cluster so a lone isolated
    # player can't squash everyone else into the centre; isolated players
    # are parked on the outer ring. The viewer's force sim refines from here.
    connected = [p for p in top if G.degree(p) > 0] or top
    cx = float(np.mean([pos[p][0] for p in connected]))
    cy = float(np.mean([pos[p][1] for p in connected]))
    spread = max(float(np.std([pos[p][0] for p in connected])),
                 float(np.std([pos[p][1] for p in connected])), 1e-6)
    k = 2.0 / spread
    new_pos = {}
    iso_i = 0
    for p in top:
        if G.degree(p) > 0 or len(connected) == len(top):
            new_pos[p] = (max(-3.5, min(3.5, (pos[p][0] - cx) * k)),
                          max(-3.5, min(3.5, (pos[p][1] - cy) * k)))
        else:
            ang = 2.3 + iso_i * 1.1
            new_pos[p] = (3.4 * math.cos(ang), 3.4 * math.sin(ang))
            iso_i += 1
    pos = new_pos
    scale = 1.0

    nodes = []
    for p in top:
        person = people.get(p)
        nm = person["short"] if person else short_name(names.get(p, p))
        nodes.append({
            "player_id": p,
            "name": nm,
            "x": round(float(pos[p][0] * scale), 3),
            "y": round(float(pos[p][1] * scale), 3),
        })

    n = len(top)
    density = len(edges) / (n * (n - 1) / 2) if n > 1 else 0.0
    out_deg = Counter()
    for a, b, c in directed_list:
        out_deg[a] += c
    ent = entropy(out_deg, n)
    return {
        "network": {
            "team_abbr": team, "season": SEASON,
            "nodes": nodes, "edges": edges, "directed": directed_list,
            "modularity": round(float(modularity), 4),
        },
        "metrics": {"edge_density": density, "entropy": ent, "modularity": float(modularity)},
        "total_assists": sum(directed.values()),
    }


def describe(r, people):
    sc = people.get(r["scorerId"], {}).get("short") or short_name(r["scorerName"])
    pa = people.get(r["passerId"], {}).get("short") or short_name(r["passerName"])
    sc_last = sc.split(" ", 1)[-1]
    pa_last = pa.split(" ", 1)[-1]
    p = r["play"]
    kind = {"2PT": "Two Pointer", "3PT": "Three Pointer", "FT": "Free Throw"}[p["kind"]]
    n_ast = f" {p['nAst']}" if p["nAst"] else ""
    return f"{sc_last} {kind} ({p['pts']} PTS) ({pa_last}{n_ast} AST) · {p['quarter']} {p['time']}"


def main():
    games, clubs, people = load_cache()
    played = sorted((g for g in games.values() if g["played"]), key=lambda g: g["gameCode"])
    by_team = defaultdict(list)
    problems = []
    for g in played:
        code = g["gameCode"]
        pbp = json.loads((CACHE / "pbp" / f"{code}.json").read_text())
        box = json.loads((CACHE / "box" / f"{code}.json").read_text())
        parsed = parse_game(code, g, pbp)
        problems += validate(code, box, parsed)
        for r in parsed:
            by_team[r["team"]].append(r)

    (OUT / "assist_networks").mkdir(parents=True, exist_ok=True)
    (OUT / "assist_plays").mkdir(parents=True, exist_ok=True)
    metrics = {}
    summary = []
    for c in clubs:
        team = c["code"]
        recs = by_team.get(team, [])
        built = build_team(team, recs, people)
        (OUT / "assist_networks" / f"{team}_{SEASON}.json").write_text(
            json.dumps(built["network"], ensure_ascii=False, indent=1))
        plays = []
        for r in recs:
            p = dict(r["play"])
            p.update({"passerId": r["passerId"], "scorerId": r["scorerId"],
                      "description": describe(r, people)})
            for k in ("kind", "pts", "nAst"):
                p.pop(k, None)
            plays.append(p)
        plays.sort(key=lambda p: (int(p["gameId"]), p["actionNumber"]))
        (OUT / "assist_plays" / f"{team}_{SEASON}.json").write_text(
            json.dumps({"team_abbr": team, "season": SEASON, "plays": plays}, ensure_ascii=False))
        metrics[team] = built["metrics"]
        summary.append((team, len(built["network"]["nodes"]), len(built["network"]["edges"]),
                        built["total_assists"], built["metrics"]))

    quint = {"season": SEASON}
    for key in ("edge_density", "entropy", "modularity"):
        vals = np.array([m[key] for m in metrics.values()])
        ranked = sorted(((t, m[key]) for t, m in metrics.items()), key=lambda x: -x[1])
        quint[key] = {
            "q20": round(float(np.percentile(vals, 20)), 4),
            "q40": round(float(np.percentile(vals, 40)), 4),
            "q60": round(float(np.percentile(vals, 60)), 4),
            "q80": round(float(np.percentile(vals, 80)), 4),
            "ranked": [{"team": t, "value": round(float(v), 4)} for t, v in ranked],
        }
    (OUT / "team_quintiles.json").write_text(json.dumps(quint, indent=1))

    rounds = max(g["round"] for g in played) if played else 0
    meta = {
        "season": SEASON, "seasonCode": SEASON_CODE,
        "roundsPlayed": rounds, "gamesPlayed": len(played),
        "lastGameUtc": max(g["utcDate"] for g in played) if played else None,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "minEdge": MIN_EDGE, "topN": TOP_N,
        "clubs": [{"code": c["code"], "name": c["name"], "short": c["abbreviatedName"],
                   "country": (c.get("country") or {}).get("name", ""),
                   "crest": (c.get("images") or {}).get("crest", "")} for c in clubs],
        "players": {p: {"name": v["name"], "short": v["short"], "club": v["club"],
                        "dorsal": v["dorsal"], "position": v["position"]}
                    for p, v in people.items()},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    print(f"{len(played)} games, rounds through {rounds}")
    for team, n, e, tot, m in summary:
        print(f"  {team}: {n} nodes, {e} edges (>= {MIN_EDGE}), {tot} assists, "
              f"density {m['edge_density']:.2f} entropy {m['entropy']:.2f} Q {m['modularity']:.3f}")
    if problems:
        print(f"{len(problems)} boxscore mismatches:")
        for p in problems:
            print("   ", p)
    else:
        print("all games match boxscore assist totals")


if __name__ == "__main__":
    main()
