/**
 * Graph-theory metrics for the sidebar. Stateless apart from the
 * league-wide quintile cutoffs loaded once at startup.
 */
export default class Stats {
  constructor(app) {
    this.app = app;
    this.quintiles = null;
  }

  setQuintiles(q) {
    this.quintiles = q;
  }

  /* ── Team level ─────────────────────────────────────────────── */

  edgeDensity(network) {
    const n = network.nodes.length;
    const max = (n * (n - 1)) / 2;
    return max > 0 ? network.edges.length / max : 0;
  }

  /** Shannon entropy of the out-degree (assists given) distribution, / log2(n). */
  entropy(network) {
    const n = network.nodes.length;
    if (n <= 1) return 0;
    const out = new Map(network.nodes.map((x) => [x.player_id, 0]));
    for (const d of network.directed) {
      if (out.has(d.passerId)) out.set(d.passerId, out.get(d.passerId) + d.count);
    }
    const total = [...out.values()].reduce((a, b) => a + b, 0);
    if (!total) return 0;
    let h = 0;
    for (const v of out.values()) {
      if (v > 0) {
        const p = v / total;
        h -= p * Math.log2(p);
      }
    }
    return h / Math.log2(n);
  }

  modularity(network) {
    return network.modularity ?? 0;
  }

  /* ── Player level ───────────────────────────────────────────── */

  /** out / (in + out): 0 = pure scorer, 1 = pure passer. */
  asymmetry(network, playerId) {
    let out = 0;
    let inn = 0;
    for (const d of network.directed) {
      if (d.passerId === playerId) out += d.count;
      if (d.scorerId === playerId) inn += d.count;
    }
    const t = out + inn;
    return t === 0 ? 0.5 : out / t;
  }

  /** HITS hub/authority via power iteration on assist-weighted edges. */
  hits(network, iters = 24) {
    const ids = network.nodes.map((n) => n.player_id);
    const adj = new Map(ids.map((id) => [id, new Map()]));
    for (const d of network.directed) {
      if (adj.has(d.passerId) && adj.has(d.scorerId)) {
        const m = adj.get(d.passerId);
        m.set(d.scorerId, (m.get(d.scorerId) || 0) + d.count);
      }
    }
    let hubs = new Map(ids.map((id) => [id, 1]));
    let auths = new Map(ids.map((id) => [id, 1]));
    for (let i = 0; i < iters; i++) {
      const na = new Map(ids.map((id) => [id, 0]));
      for (const [u, outs] of adj) {
        const hu = hubs.get(u);
        for (const [v, w] of outs) na.set(v, na.get(v) + hu * w);
      }
      const nh = new Map(ids.map((id) => [id, 0]));
      for (const [u, outs] of adj) {
        let h = 0;
        for (const [v, w] of outs) h += na.get(v) * w;
        nh.set(u, h);
      }
      const norm = (m) => Math.sqrt([...m.values()].reduce((a, b) => a + b * b, 0)) || 1;
      const an = norm(na);
      const hn = norm(nh);
      for (const id of ids) {
        na.set(id, na.get(id) / an);
        nh.set(id, nh.get(id) / hn);
      }
      hubs = nh;
      auths = na;
    }
    return { hubs, authorities: auths };
  }

  /* ── Pair level ─────────────────────────────────────────────── */

  pairTotals(network) {
    const pairs = new Map();
    for (const d of network.directed) {
      const key = [d.passerId, d.scorerId].sort().join("|");
      pairs.set(key, (pairs.get(key) || 0) + d.count);
    }
    const list = [...pairs.entries()].map(([key, total]) => {
      const [aId, bId] = key.split("|");
      return { aId, bId, total };
    });
    list.sort((x, y) => y.total - x.total);
    return list;
  }

  pairRank(network, idA, idB) {
    const pairs = this.pairTotals(network);
    const idx = pairs.findIndex(
      (p) => (p.aId === idA && p.bId === idB) || (p.aId === idB && p.bId === idA)
    );
    return { rank: idx >= 0 ? idx + 1 : null, total: pairs.length };
  }

  /* ── Stars & ranks ──────────────────────────────────────────── */

  teamStars(metricKey, value) {
    const q = this.quintiles?.[metricKey];
    if (!q) return 1;
    if (value < q.q20) return 1;
    if (value < q.q40) return 2;
    if (value < q.q60) return 3;
    if (value < q.q80) return 4;
    return 5;
  }

  playerStars(values, value) {
    const N = values.length;
    if (!N) return 1;
    let lt = 0;
    let eq = 0;
    for (const v of values) {
      if (v < value) lt++;
      else if (v === value) eq++;
    }
    const pct = (lt + (eq + 1) / 2) / N;
    if (pct <= 0.2) return 1;
    if (pct <= 0.4) return 2;
    if (pct <= 0.6) return 3;
    if (pct <= 0.8) return 4;
    return 5;
  }

  pairStars(rank) {
    if (rank == null) return 1;
    if (rank === 1) return 5;
    if (rank === 2) return 4;
    if (rank === 3) return 3;
    if (rank <= 8) return 2;
    return 1;
  }

  teamRank(metricKey, team) {
    const ranked = this.quintiles?.[metricKey]?.ranked;
    if (!ranked) return null;
    const idx = ranked.findIndex((r) => r.team === team);
    return idx >= 0 ? { rank: idx + 1, total: ranked.length } : null;
  }

  playerRank(values, value) {
    const N = values.length;
    if (!N) return { rank: 0, total: 0 };
    let gt = 0;
    let eq = 0;
    for (const v of values) {
      if (v > value) gt++;
      else if (v === value) eq++;
    }
    return { rank: Math.round(gt + (eq + 1) / 2), total: N };
  }

  playerRankedList(network, metricFn) {
    const scored = network.nodes.map((n) => ({
      playerId: n.player_id,
      name: n.name,
      value: metricFn(n.player_id),
    }));
    scored.sort((a, b) => b.value - a.value);
    return scored.map((p, i) => ({ ...p, rank: i + 1 }));
  }
}
