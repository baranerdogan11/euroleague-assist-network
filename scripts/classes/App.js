import Data from "./Data.js";
import Filters from "./Filters.js";
import World from "./World.js";
import Intro from "./Intro.js";
import Plays from "./Plays.js";
import Stats from "./Stats.js";
import Sidebar from "./Sidebar.js";
import { TEAM_NAMES, setTeamNames } from "./teamColors.js";

const DEFAULT_TEAM = "MAD";

export default class App {
  constructor() {
    this.data = new Data(this);
    this.stats = new Stats(this);
    this.filters = new Filters(this, ".rail-form");
    this.world = new World(this, ".canvas", ".labels");
    this.plays = new Plays(this, ".plays-panel");
    this.sidebar = new Sidebar(this, ".sidebar");
    this.intro = new Intro();
    this.headshotIds = null;
    this.setup();
  }

  async setup() {
    this.data.on("ready", (network) => {
      this._hideLoadError();
      this.onDataReady(network);
    });
    this.data.on("error", () => this._showLoadError());

    this.intro.run();
    this._installSidebarPositioner();
    this._installSidebarToggle();
    this._installLoadError();
    this._installHint();
    document.querySelector("[data-brand]")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.world.back();
      this.world.back();
    });

    let meta;
    try {
      [meta] = await Promise.all([this.data.loadMeta(), this.data.loadQuintiles(), this._loadManifest()]);
    } catch (err) {
      console.error(err);
      this._showLoadError();
      return;
    }
    setTeamNames(meta.clubs);
    if (this.data.quintiles) this.stats.setQuintiles(this.data.quintiles);
    const hashTeam = location.hash.replace("#", "").toUpperCase();
    const start = TEAM_NAMES[hashTeam] ? hashTeam : DEFAULT_TEAM;
    this.filters.init(meta.clubs, meta.season, start);
    this._renderCaption(meta);
    window.addEventListener("hashchange", () => {
      const t = location.hash.replace("#", "").toUpperCase();
      if (TEAM_NAMES[t] && t !== this.filters.currentTeam) this.loadTeam(t);
    });
    this.data.load(start, meta.season);
  }

  _renderCaption(meta) {
    const cap = document.querySelector("[data-meta-caption]");
    if (cap) {
      cap.textContent = `Data courtesy of the EuroLeague live API · ${meta.gamesPlayed} games through Round ${meta.roundsPlayed}`;
    }
  }

  async _loadManifest() {
    try {
      const res = await fetch("./public/headshots/manifest.json");
      if (!res.ok) throw new Error(res.status);
      this.headshotIds = new Set(await res.json());
    } catch {
      this.headshotIds = null;
    }
  }

  headshotSrc(playerId) {
    if (this.headshotIds && !this.headshotIds.has(playerId)) return "./public/headshots/0.svg";
    return `./public/headshots/${playerId}.png`;
  }

  loadTeam(code) {
    this.filters.setTeam(code);
    if (location.hash !== `#${code}`) history.replaceState(null, "", `#${code}`);
    this.data.load(code, this.filters.currentSeason);
  }

  onDataReady(network) {
    this.world.build(network);
    this.filters.syncToNetwork(network);
    this.updateChrome(network);
    this.data.loadPlays(network.team, network.season);
    for (const n of network.nodes) {
      const img = new Image();
      img.decoding = "async";
      img.src = this.headshotSrc(n.player_id);
    }
    this.sidebar.renderTeam(network);
  }

  updateChrome(network) {
    const teamEl = document.querySelector("[data-team-display]");
    const subEl = document.querySelector("[data-team-sub]");
    if (teamEl) teamEl.innerHTML = `${esc(TEAM_NAMES[network.team] || network.team)} <span class="team-accent">·</span>`;
    const rounds = this.data.meta?.roundsPlayed;
    if (subEl) subEl.textContent = `${network.season} Assist Network${rounds ? ` · Through Round ${rounds}` : ""}`;
    document.querySelector("[data-stat='players']").textContent = network.nodes.length;
    document.querySelector("[data-stat='edges']").textContent = network.edges.length;
    document.querySelector("[data-stat='assists']").textContent = this.data.totalAssists().toLocaleString();
  }

  /* ── Hint ────────────────────────────────────────────────────── */

  _installHint() {
    this._hintEl = document.querySelector("[data-hint]");
    let seen = null;
    try {
      seen = localStorage.getItem("hint_seen");
    } catch {
      seen = "1";
    }
    if (seen || !this._hintEl) {
      this._hintEl = null;
      return;
    }
    this._hintTimer = setTimeout(() => this._hintEl?.classList.add("show"), 3200);
  }

  notePinned() {
    if (!this._hintEl) return;
    clearTimeout(this._hintTimer);
    this._hintEl.classList.remove("show");
    this._hintEl = null;
    try {
      localStorage.setItem("hint_seen", "1");
    } catch {
      /* private mode */
    }
  }

  /* ── Chrome plumbing ─────────────────────────────────────────── */

  _installLoadError() {
    this._errorEl = document.querySelector(".load-error");
    this._errorEl?.querySelector("[data-retry]")?.addEventListener("click", () => {
      this._hideLoadError();
      if (this.filters.currentTeam) this.data.load(this.filters.currentTeam, this.filters.currentSeason);
      else this.setup();
    });
  }

  _showLoadError() {
    this._errorEl?.classList.add("visible");
  }

  _hideLoadError() {
    this._errorEl?.classList.remove("visible");
  }

  _installSidebarToggle() {
    const btn = document.querySelector("[data-sidebar-toggle]");
    btn?.addEventListener("click", () => {
      const open = document.body.classList.toggle("sidebar-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  _installSidebarPositioner() {
    const masthead = document.querySelector(".masthead");
    const sidebar = document.querySelector(".sidebar");
    if (!masthead || !sidebar) return;
    const reposition = () => {
      sidebar.style.top = `${masthead.getBoundingClientRect().bottom + 14}px`;
    };
    reposition();
    new ResizeObserver(reposition).observe(masthead);
    window.addEventListener("resize", reposition);
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
