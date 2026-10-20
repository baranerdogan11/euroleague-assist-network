import { TEAM_NAMES, TEAM_SHORT } from "./teamColors.js";

/**
 * Pair-mode panel: every assist between two players, grouped by game,
 * each group linking to the game on euroleaguebasketball.net.
 */
export default class Plays {
  constructor(app, panelSelector) {
    this.app = app;
    this.panel = document.querySelector(panelSelector);
    this.titleEl = this.panel.querySelector("[data-plays-title]");
    this.subEl = this.panel.querySelector("[data-plays-sub]");
    this.listEl = this.panel.querySelector("[data-plays-list]");
    this._pair = null;
    this._closeTimer = null;
    this.app.data.on("plays-ready", () => {
      if (this._pair && !this.panel.hidden) this._render(...this._pair);
    });
  }

  open(nodeA, nodeB) {
    clearTimeout(this._closeTimer);
    this._pair = [nodeA, nodeB];
    this._render(nodeA, nodeB);
    this.panel.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.panel.classList.add("open")));
  }

  close() {
    this._pair = null;
    this.panel.classList.remove("open");
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this.panel.hidden = true;
    }, 650);
  }

  _render(a, b) {
    const data = this.app.data;
    this.titleEl.innerHTML =
      `<span class="plays-panel-heads">${this._head(a)}${this._head(b)}</span>` +
      `${esc(a.name)} <span class="plays-panel-amp">×</span> ${esc(b.name)}`;
    const season = data.network.season;
    if (!data.playsLoaded) {
      this.subEl.textContent = `Loading plays · ${season}`;
      this.listEl.innerHTML = `<p class="plays-panel-empty">Loading plays…</p>`;
      data.loadPlays(data.network.team, season);
      return;
    }
    const plays = data.playsBetween(a.player_id, b.player_id);
    this.subEl.textContent = `${plays.length} ${plays.length === 1 ? "play" : "plays"} · ${season} regular season`;
    if (!plays.length) {
      this.listEl.innerHTML = `<p class="plays-panel-empty">No direct assists between these two players yet this season.</p>`;
      return;
    }
    const groups = [];
    let cur = null;
    for (const p of plays) {
      if (!cur || cur.gameId !== p.gameId) {
        cur = { gameId: p.gameId, round: p.round, location: p.location, opponent: p.opponent, plays: [] };
        groups.push(cur);
      }
      cur.plays.push(p);
    }
    this.listEl.innerHTML = groups
      .map((g) => {
        const label = `R${g.round} · ${g.location} ${TEAM_SHORT[g.opponent] || g.opponent}`;
        const url = this._gameUrl(g);
        return (
          `<div class="play-group"><div class="play-group-head">` +
          `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` +
          `<span class="play-group-count">${g.plays.length}</span></div>` +
          g.plays
            .map((p) => {
              const [desc, when] = p.description.split(" · ");
              return (
                `<a class="play-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">` +
                `<span class="play-link-desc">${esc(desc)}</span>` +
                `<span class="play-link-meta">${esc(when || `${p.quarter} ${p.time}`)}</span></a>`
              );
            })
            .join("") +
          `</div>`
        );
      })
      .join("");
  }

  /** euroleaguebasketball.net/en/euroleague/game-center/{season}/{home}-{away}/{code}/{game}/ */
  _gameUrl(g) {
    const team = this.app.data.network.team;
    const home = g.location === "vs" ? team : g.opponent;
    const away = g.location === "vs" ? g.opponent : team;
    const slug = (code) =>
      (TEAM_NAMES[code] || code)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const season = this.app.data.network.season;
    const code = this.app.data.meta?.seasonCode || "E2026";
    return `https://www.euroleaguebasketball.net/en/euroleague/game-center/${season}/${slug(home)}-${slug(away)}/${code}/${g.gameId}/`;
  }

  _head(node) {
    return (
      `<img class="headshot" src="${esc(this.app.headshotSrc(node.player_id))}" alt="" loading="lazy" ` +
      `onerror="this.onerror=null;this.src='./public/headshots/0.svg'" title="${esc(node.name)}" />`
    );
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
