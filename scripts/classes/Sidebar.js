import { TEAM_NAMES } from "./teamColors.js";

const METRIC_INFO = {
  edgeDensity: {
    title: "Edge Density",
    definition:
      "The fraction of possible player pairs that actually share at least 2 assists this season. A 12-player roster has 66 possible pairs.",
    wikiUrl: "https://en.wikipedia.org/wiki/Dense_graph",
    forBasketball:
      "How interconnected the offense is. High density means constant ball movement and shared playmaking; low density means a few dominant ball-handlers running things.",
  },
  entropy: {
    title: "Out-Degree Entropy",
    definition:
      "Shannon entropy of the team's assists-given distribution, normalised by log₂(n). Measures how evenly assist-making is spread across the roster.",
    wikiUrl: "https://en.wikipedia.org/wiki/Entropy_(information_theory)",
    forBasketball:
      "How spread the playmaking is. High entropy = everyone passes. Low entropy = one ball-handler runs everything.",
  },
  modularity: {
    title: "Modularity",
    definition:
      "From greedy community detection: a Q-score for how cleanly the network partitions into sub-groups. Theoretically [−1, +1]; early in a season it runs higher than it will once lineups mix.",
    wikiUrl: "https://en.wikipedia.org/wiki/Modularity_(networks)",
    forBasketball:
      "Does the team split into distinct sub-units (a starting five, a bench unit) or play as one passing fabric? Higher = clearer sub-units.",
  },
  asymmetry: {
    title: "Pass-Score Asymmetry",
    definition:
      "out / (in + out) from directional assists. 0 = pure scorer (only receives assists), 1 = pure passer (only gives them), 0.5 = balanced.",
    wikiUrl: "https://en.wikipedia.org/wiki/Centrality",
    forBasketball:
      "Where the player sits on the passer–scorer spectrum. Point guards sit high; bigs and pure finishers sit low.",
  },
  hubScore: {
    title: "Hub Score (HITS)",
    definition:
      "From the HITS algorithm: a node scores high if it directs many edges to high-authority nodes (good scorers). Computed by power iteration.",
    wikiUrl: "https://en.wikipedia.org/wiki/HITS_algorithm",
    forBasketball: "Floor-general index: you pass a lot AND you pass to people who score.",
  },
  authorityScore: {
    title: "Authority Score (HITS)",
    definition:
      "From the HITS algorithm: a node scores high if many high-hub nodes (good passers) direct edges to it.",
    wikiUrl: "https://en.wikipedia.org/wiki/HITS_algorithm",
    forBasketball: "Finisher index: you get fed often, AND by the team's best passers.",
  },
  pairRank: {
    title: "Pair Rank",
    definition:
      "Where this pair ranks among all player pairs on the team, by total assists exchanged in either direction.",
    wikiUrl: "https://en.wikipedia.org/wiki/Network_theory",
    forBasketball:
      "How elite this two-man chemistry is on the team. #1 = the team's primary assist connection.",
  },
};

/**
 * Left sidebar: team metrics by default, player metrics once a dot is
 * pinned, pair rank when two are. Each row: label + ⓘ, value, stars,
 * optional range strip, and a clickable rank line that opens a
 * ranked popover for navigation.
 */
export default class Sidebar {
  constructor(app, rootSelector) {
    this.app = app;
    this.root = document.querySelector(rootSelector);
    this.dialog = document.querySelector(".info-modal");
    this.content = document.createElement("div");
    this.content.className = "sidebar-content";
    this.root.appendChild(this.content);
    this._section = null;
    this._lastHtml = null;

    this.root.addEventListener("click", (e) => {
      const info = e.target.closest("[data-info]");
      if (info) {
        e.stopPropagation();
        this.openInfo(info.dataset.info);
        return;
      }
      const rank = e.target.closest("[data-rank-key]");
      if (rank) {
        e.stopPropagation();
        this._openRankPopover(rank.dataset.rankKey, rank.dataset.rankScope, rank);
      }
    });
    if (this.dialog) {
      this.dialog.querySelector("[data-modal-close]")?.addEventListener("click", () => this.dialog.close());
      this.dialog.addEventListener("click", (e) => {
        if (e.target === this.dialog) this.dialog.close();
      });
    }
  }

  openInfo(key) {
    const info = METRIC_INFO[key];
    if (!info || !this.dialog) return;
    this.dialog.querySelector("[data-modal-title]").textContent = info.title;
    this.dialog.querySelector("[data-modal-def]").textContent = info.definition;
    this.dialog.querySelector("[data-modal-wiki]").href = info.wikiUrl;
    this.dialog.querySelector("[data-modal-basketball]").textContent = info.forBasketball;
    this.dialog.showModal();
  }

  /* ── Sections ────────────────────────────────────────────────── */

  renderTeam(network) {
    if (!network) return;
    const s = this.app.stats;
    const density = s.edgeDensity(network);
    const entropy = s.entropy(network);
    const mod = s.modularity(network);
    const team = network.team;
    const html =
      `<div class="sidebar-section-header">Team</div>` +
      this._row("edgeDensity", "Edge Density", density.toFixed(2), s.teamStars("edge_density", density),
        s.teamRank("edge_density", team), "team", this._rangeStrip("edge_density", density)) +
      this._row("entropy", "Entropy", entropy.toFixed(2), s.teamStars("entropy", entropy),
        s.teamRank("entropy", team), "team", this._rangeStrip("entropy", entropy)) +
      this._row("modularity", "Modularity", mod.toFixed(3), s.teamStars("modularity", mod),
        s.teamRank("modularity", team), "team", this._rangeStrip("modularity", mod));
    this._render(html, "team");
  }

  renderPlayer(network, playerId, playerName) {
    const s = this.app.stats;
    const asym = s.asymmetry(network, playerId);
    const hits = s.hits(network);
    const hub = hits.hubs.get(playerId) || 0;
    const auth = hits.authorities.get(playerId) || 0;
    const allAsym = network.nodes.map((n) => s.asymmetry(network, n.player_id));
    const allHub = network.nodes.map((n) => hits.hubs.get(n.player_id) || 0);
    const allAuth = network.nodes.map((n) => hits.authorities.get(n.player_id) || 0);
    const t = this.app.data.totalsFor(playerId);
    const html =
      `<div class="sidebar-section-header with-headshot">` +
      `<span>Player <span class="sidebar-section-context">${esc(playerName)}</span></span>` +
      this._headshot(playerId, playerName) +
      `</div>` +
      this._row("asymmetry", "Asymmetry", asym.toFixed(2), null, s.playerRank(allAsym, asym), "player",
        this._spectrum(asym) + `<div class="metric-pair-sub">${t.out} given · ${t.in} received</div>`) +
      this._row("hubScore", "Hub Score", hub.toFixed(2), s.playerStars(allHub, hub), s.playerRank(allHub, hub), "player") +
      this._row("authorityScore", "Authority", auth.toFixed(2), s.playerStars(allAuth, auth), s.playerRank(allAuth, auth), "player");
    this._render(html, "player");
  }

  renderPair(network, aId, bId, aName, bName) {
    const s = this.app.stats;
    const { rank, total } = s.pairRank(network, aId, bId);
    const star = s.pairStars(rank);
    const ab = this.app.data.directedCount(aId, bId);
    const ba = this.app.data.directedCount(bId, aId);
    const html =
      `<div class="sidebar-section-header with-headshot">` +
      `<span>Pair <span class="sidebar-section-context">${esc(aName)} × ${esc(bName)}</span></span>` +
      `<span class="headshot-pair">${this._headshot(aId, aName)}${this._headshot(bId, bName)}</span>` +
      `</div>` +
      `<div class="metric-card metric-pair">` +
      `<div class="metric-head"><span class="metric-label">Pair Rank</span>` +
      `<button class="metric-info" type="button" data-info="pairRank" aria-label="About Pair Rank">ⓘ</button></div>` +
      `<div class="metric-value">${rank == null ? "—" : "#" + rank}</div>` +
      `<div class="metric-pair-sub">out of ${total} pairs · ${ab + ba} assists</div>` +
      `<div class="metric-stars">${this._stars(star)}</div>` +
      `<div class="metric-pair-sub">${esc(aName.split(" ").pop())} → ${esc(bName.split(" ").pop())}: ${ab}<br>` +
      `${esc(bName.split(" ").pop())} → ${esc(aName.split(" ").pop())}: ${ba}</div>` +
      `</div>`;
    this._render(html, "pair");
  }

  /* ── Pieces ──────────────────────────────────────────────────── */

  _headshot(playerId, name) {
    return (
      `<img class="headshot" src="${esc(this.app.headshotSrc(playerId))}" alt="" loading="lazy" ` +
      `onerror="this.onerror=null;this.src='./public/headshots/0.svg'" title="${esc(name ?? "")}" />`
    );
  }

  _rangeStrip(metricKey, value) {
    const ranked = this.app.data.quintiles?.[metricKey]?.ranked;
    if (!ranked || ranked.length < 2) return "";
    const vals = ranked.map((r) => r.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (max - min < 1e-9) return "";
    const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    const dec = metricKey === "modularity" ? 3 : 2;
    return (
      `<div class="metric-range" aria-hidden="true">` +
      `<span class="metric-range-end">${min.toFixed(dec)}</span>` +
      `<span class="metric-range-track"><span class="metric-range-dot" style="left: ${pct}%"></span></span>` +
      `<span class="metric-range-end">${max.toFixed(dec)}</span></div>`
    );
  }

  _spectrum(value) {
    const pct = Math.max(0, Math.min(100, value * 100));
    return (
      `<div class="metric-spectrum" aria-hidden="true"><span>Scorer</span>` +
      `<span class="metric-range-track"><span class="metric-range-dot" style="left: ${pct}%"></span></span>` +
      `<span>Passer</span></div>`
    );
  }

  _row(key, label, value, star, rank = null, scope = null, extra = "") {
    let rankLine = "";
    if (rank && rank.total) {
      const text = `Rank #${rank.rank} of ${rank.total}`;
      rankLine =
        `<button class="metric-rank clickable" type="button" data-rank-key="${key}" ` +
        `data-rank-scope="${scope}" aria-label="Browse ranking for ${esc(label)}">${text}</button>`;
    }
    const stars = star === null ? "" : `<div class="metric-stars">${this._stars(star)}</div>`;
    return (
      `<div class="metric-card"><div class="metric-head">` +
      `<span class="metric-label">${esc(label)}</span>` +
      `<button class="metric-info" type="button" data-info="${key}" aria-label="About ${esc(label)}">ⓘ</button>` +
      `</div><div class="metric-value">${esc(value)}</div>${stars}${extra}${rankLine}</div>`
    );
  }

  _stars(n) {
    let html = "";
    for (let i = 0; i < 5; i++) html += this._ball(i < n);
    return html;
  }

  _ball(filled) {
    return (
      `<svg class="bball ${filled ? "filled" : "empty"}" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
      `<circle cx="8" cy="8" r="6.5" /><line x1="1.5" y1="8" x2="14.5" y2="8" /><line x1="8" y1="1.5" x2="8" y2="14.5" />` +
      `<path d="M2.5 3.2 Q8 7.5 13.5 3.2" fill="none" /><path d="M2.5 12.8 Q8 8.5 13.5 12.8" fill="none" /></svg>`
    );
  }

  _render(html, section) {
    if (html === this._lastHtml && section === this._section) return;
    this._lastHtml = html;
    this._closePopover();
    if (this._section === section || this._section === null) {
      this.content.innerHTML = html;
      this._section = section;
      this.root.dataset.section = section;
      return;
    }
    this._section = section;
    this.content.classList.add("fading");
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => {
      this.content.innerHTML = html;
      this.root.dataset.section = section;
      void this.content.offsetWidth;
      this.content.classList.remove("fading");
    }, 200);
  }

  /* ── Rank popover ────────────────────────────────────────────── */

  _openRankPopover(metricKey, scope, anchor) {
    if (this._popoverAnchor === anchor) {
      this._closePopover();
      return;
    }
    this._closePopover();
    const entries = this._rankEntries(metricKey, scope);
    if (!entries.length) return;
    const pop = document.createElement("div");
    pop.className = "rank-popover";
    pop.innerHTML =
      `<ul class="rank-popover-list">` +
      entries
        .map(
          (e) =>
            `<li class="rank-popover-item${e.isCurrent ? " current" : ""}" data-id="${esc(e.id)}">` +
            `<span class="rank-popover-rank">#${e.rank}</span><span class="rank-popover-name">${esc(e.label)}</span>` +
            `<span class="rank-popover-value">${esc(e.value)}</span></li>`
        )
        .join("") +
      `</ul>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 14 * 16 - 12))}px`;
    pop.querySelector(".current")?.scrollIntoView({ block: "nearest" });
    pop.addEventListener("click", (e) => {
      const item = e.target.closest(".rank-popover-item");
      if (item) this._selectRank(scope, item.dataset.id);
    });
    this._popover = pop;
    this._popoverAnchor = anchor;
    setTimeout(() => {
      document.addEventListener("click", this._onDocClick);
      document.addEventListener("keydown", this._onKeydown);
    }, 0);
  }

  _closePopover() {
    this._popover?.remove();
    this._popover = null;
    this._popoverAnchor = null;
    document.removeEventListener("click", this._onDocClick);
    document.removeEventListener("keydown", this._onKeydown);
  }

  _onDocClick = (e) => {
    if (!this._popover || this._popover.contains(e.target) || e.target.closest("[data-rank-key]")) return;
    this._closePopover();
  };

  _onKeydown = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    this._closePopover();
  };

  _rankEntries(metricKey, scope) {
    const s = this.app.stats;
    const network = this.app.data.network;
    if (!network) return [];
    if (scope === "team") {
      const key = { edgeDensity: "edge_density", entropy: "entropy", modularity: "modularity" }[metricKey];
      const ranked = this.app.data.quintiles?.[key]?.ranked || [];
      const dec = metricKey === "modularity" ? 3 : 2;
      return ranked.map((r, i) => ({
        rank: i + 1,
        label: TEAM_NAMES[r.team] || r.team,
        value: r.value.toFixed(dec),
        id: r.team,
        isCurrent: r.team === network.team,
      }));
    }
    let fn;
    if (metricKey === "asymmetry") fn = (id) => s.asymmetry(network, id);
    else {
      const hits = s.hits(network);
      const map = metricKey === "hubScore" ? hits.hubs : hits.authorities;
      fn = (id) => map.get(id) || 0;
    }
    const list = s.playerRankedList(network, fn);
    const values = list.map((p) => p.value);
    const focusedId = this.app.world?.pinned?.userData?.node?.player_id;
    return list.map((p) => ({
      rank: s.playerRank(values, p.value).rank,
      label: p.name,
      value: p.value.toFixed(2),
      id: p.playerId,
      isCurrent: p.playerId === focusedId,
    }));
  }

  _selectRank(scope, id) {
    this._closePopover();
    const world = this.app.world;
    if (scope === "team") {
      if (this.app.data.network?.team !== id) this.app.loadTeam(id);
    } else {
      const mesh = world?.nodeById?.get(id);
      if (!mesh) return;
      if (world._mode === "pair") world.back();
      if (world._mode === "single") world.back();
      if (world.pinned !== mesh) world.pin(mesh);
    }
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
