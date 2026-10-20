/**
 * Loads a club's assist network JSON and normalises it:
 *
 *   on disk:  { team_abbr, season, nodes:[{player_id, name, x, y}],
 *               edges:[[a, b, count]], directed:[[passer, scorer, count]], modularity }
 *   emitted:  { team, season, nodes:[{id, player_id, name, x, y}],
 *               edges:[{sourceId, targetId, source, target, count}],
 *               directed:[{passerId, scorerId, count}], modularity }
 *
 * Player ids are strings ("P005791") — never coerce them to numbers.
 */
export default class Data {
  constructor(app) {
    this.app = app;
    this.listeners = {};
    this.network = null;
    this.plays = [];
    this.playsLoaded = false;
    this._playsKey = null;
    this.quintiles = null;
    this.meta = null;
  }

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
    return this;
  }

  off(event, fn) {
    this.listeners[event] = (this.listeners[event] || []).filter((x) => x !== fn);
  }

  emit(event, ...args) {
    (this.listeners[event] || []).forEach((fn) => fn(...args));
  }

  async loadMeta() {
    if (this.meta) return this.meta;
    const res = await fetch("./public/data/meta.json");
    if (!res.ok) throw new Error(`meta ${res.status}`);
    this.meta = await res.json();
    return this.meta;
  }

  async loadQuintiles() {
    if (this.quintiles) return this.quintiles;
    try {
      const res = await fetch("./public/data/team_quintiles.json");
      if (!res.ok) throw new Error(`${res.status}`);
      this.quintiles = await res.json();
    } catch (err) {
      console.warn("Could not load team_quintiles.json:", err);
      this.quintiles = null;
    }
    return this.quintiles;
  }

  async load(team, season) {
    const key = `${team}_${season}`;
    this._loadKey = key;
    const url = `./public/data/assist_networks/${key}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const raw = await res.json();
      if (this._loadKey !== key) return; // a newer load won
      this.network = this.normalize(raw);
      this.emit("ready", this.network);
    } catch (err) {
      console.error(`Failed to load ${url}:`, err);
      if (this._loadKey === key) this.emit("error", err);
    }
  }

  normalize(raw) {
    const nodes = raw.nodes.map((n) => ({ ...n, id: n.player_id }));
    const edges = raw.edges.map(([sourceId, targetId, count]) => ({
      sourceId,
      targetId,
      source: sourceId,
      target: targetId,
      count,
    }));
    const directed = (raw.directed || []).map(([passerId, scorerId, count]) => ({
      passerId,
      scorerId,
      count,
    }));
    return {
      team: raw.team_abbr,
      season: raw.season,
      nodes,
      edges,
      directed,
      modularity: raw.modularity ?? 0,
    };
  }

  totalAssists() {
    if (!this.network) return 0;
    return this.network.directed.reduce((acc, d) => acc + d.count, 0);
  }

  async loadPlays(team, season) {
    const key = `${team}_${season}`;
    if (this._playsKey === key) return;
    this._playsKey = key;
    this.plays = [];
    this.playsLoaded = false;
    const url = `./public/data/assist_plays/${key}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const raw = await res.json();
      if (this._playsKey === key) {
        this.plays = raw.plays || [];
        this.playsLoaded = true;
        this.emit("plays-ready");
      }
    } catch (err) {
      console.warn(`Failed to load plays for ${key}:`, err);
      if (this._playsKey === key) this._playsKey = null;
    }
  }

  playsBetween(idA, idB) {
    return this.plays.filter(
      (p) =>
        (p.passerId === idA && p.scorerId === idB) ||
        (p.passerId === idB && p.scorerId === idA)
    );
  }

  /** Assists given (out) and received (in) for one player. */
  totalsFor(playerId) {
    let out = 0;
    let inn = 0;
    if (!this.network) return { out, in: inn };
    for (const d of this.network.directed) {
      if (d.passerId === playerId) out += d.count;
      if (d.scorerId === playerId) inn += d.count;
    }
    return { out, in: inn };
  }

  /** Directed count passer → scorer. */
  directedCount(passerId, scorerId) {
    let c = 0;
    for (const d of this.network?.directed || []) {
      if (d.passerId === passerId && d.scorerId === scorerId) c += d.count;
    }
    return c;
  }
}
