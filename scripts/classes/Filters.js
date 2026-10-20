import { TEAM_NAMES, TEAM_SHORT, TEAM_COLORS } from "./teamColors.js";

/**
 * Team selection: a rail button opens a full-viewport grid of all 20
 * club crests, each tinted with its accent colour.
 */
export default class Filters {
  constructor(app, formSelector) {
    this.app = app;
    this.form = document.querySelector(formSelector);
    this.button = this.form.querySelector("[data-team-button]");
    this.buttonName = this.form.querySelector("[data-team-button-name]");
    this.buttonCrest = this.form.querySelector("[data-team-button-crest]");
    this.overlay = document.querySelector("[data-team-overlay]");
    this.grid = document.querySelector("[data-team-overlay-grid]");
    this._team = null;
    this._season = null;
    this._open = false;
    this._bind();
  }

  get currentTeam() {
    return this._team;
  }

  get currentSeason() {
    return this._season;
  }

  /** Called once meta.json is in: builds the grid and picks the default team. */
  init(clubs, season, defaultTeam) {
    this._season = season;
    this._clubs = clubs;
    this._buildOverlay();
    this.setTeam(defaultTeam);
  }

  setTeam(code) {
    this._team = code;
    if (this.buttonName) this.buttonName.textContent = TEAM_SHORT[code] || TEAM_NAMES[code] || code;
    if (this.buttonCrest) this.buttonCrest.src = `./public/logos/${code}.png`;
    if (this.grid) {
      for (const cell of this.grid.querySelectorAll("[data-team]")) {
        cell.classList.toggle("current", cell.dataset.team === code);
      }
    }
  }

  _buildOverlay() {
    if (!this.grid) return;
    const entries = [...this._clubs].sort((a, b) => a.name.localeCompare(b.name));
    this.grid.innerHTML = entries
      .map((c) => {
        const accent = (TEAM_COLORS[c.code] || ["#cb1c1f"])[0];
        return (
          `<button type="button" class="team-cell" data-team="${c.code}" style="--team-accent: ${accent}">` +
          `<img class="team-cell-logo" src="./public/logos/${c.code}.png" alt="" loading="lazy" />` +
          `<span class="team-cell-name">${escapeHtml(c.name)}</span>` +
          `<span class="team-cell-country">${escapeHtml(c.country || "")}</span>` +
          `</button>`
        );
      })
      .join("");
  }

  _bind() {
    this.button?.addEventListener("click", () => this.toggleOverlay());
    this.overlay
      ?.querySelector("[data-team-overlay-close]")
      ?.addEventListener("click", () => this.closeOverlay());
    this.grid?.addEventListener("click", (e) => {
      const cell = e.target.closest("[data-team]");
      if (!cell) return;
      const code = cell.dataset.team;
      this.closeOverlay();
      if (code !== this._team) this.app.loadTeam(code);
    });
    this._onKeydown = (e) => {
      if (e.key !== "Escape" || !this._open) return;
      e.stopPropagation();
      this.closeOverlay();
    };
  }

  toggleOverlay() {
    if (this._open) this.closeOverlay();
    else this.openOverlay();
  }

  openOverlay() {
    if (!this.overlay || this._open) return;
    this._open = true;
    this.overlay.classList.add("open");
    document.body.classList.add("team-overlay-open");
    document.addEventListener("keydown", this._onKeydown);
    this.grid?.querySelector(".team-cell.current")?.focus();
  }

  closeOverlay() {
    if (!this.overlay || !this._open) return;
    this._open = false;
    this.overlay.classList.remove("open");
    document.body.classList.remove("team-overlay-open");
    document.removeEventListener("keydown", this._onKeydown);
    this.button?.focus();
  }

  syncToNetwork(network) {
    if (network?.team && network.team !== this._team) this.setTeam(network.team);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
