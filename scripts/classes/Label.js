import * as THREE from "three";

/**
 * HTML overlay labels: one per player, projected under its dot every
 * frame. Crisp at any zoom, same font as the UI, and clickable —
 * hovering/clicking a name behaves exactly like its dot.
 */
export default class Label {
  constructor(container, camera, canvas) {
    this.container = container;
    this.camera = camera;
    this.canvas = canvas;
    this.entries = new Map(); // playerId → { el, stat, mesh, node }
    this._v = new THREE.Vector3();
  }

  rebuild(nodes, nodeById, world, statFor) {
    this.clear();
    for (const node of nodes) {
      const el = document.createElement("div");
      el.className = "label";
      const name = document.createElement("span");
      name.className = "label-name";
      name.textContent = node.name;
      const stat = document.createElement("span");
      stat.className = "label-stat";
      stat.textContent = statFor(node);
      el.append(name, stat);
      const mesh = nodeById.get(node.player_id);
      el.addEventListener("pointerenter", () => world.setHoveredFromLabel(mesh));
      el.addEventListener("pointerleave", () => world.setHoveredFromLabel(null));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        world.handleNodeClick(mesh);
      });
      this.container.appendChild(el);
      this.entries.set(node.player_id, { el, stat, mesh, node, defaultStat: stat.textContent });
    }
  }

  clear() {
    this.container.innerHTML = "";
    this.entries.clear();
  }

  setStat(playerId, text) {
    const e = this.entries.get(playerId);
    if (e) e.stat.textContent = text ?? e.defaultStat;
  }

  resetStats() {
    for (const e of this.entries.values()) e.stat.textContent = e.defaultStat;
  }

  /** states: Map<playerId, "dimmed"|"hidden"|"pinned"|"hover"|""> (missing = normal) */
  setStates(states) {
    for (const [id, e] of this.entries) {
      const s = states.get(id) || "";
      e.el.classList.toggle("dimmed", s === "dimmed");
      e.el.classList.toggle("hidden", s === "hidden");
      e.el.classList.toggle("pinned", s === "pinned");
      e.el.classList.toggle("hover", s === "hover");
    }
  }

  update() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const e of this.entries.values()) {
      const mesh = e.mesh;
      if (!mesh || !mesh.visible) {
        e.el.style.display = "none";
        continue;
      }
      // Anchor just under the sphere: offset in world units by the
      // sphere's current scale.
      this._v.copy(mesh.position);
      mesh.parent.localToWorld(this._v);
      this._v.y -= 0.42 * mesh.scale.x;
      this._v.project(this.camera);
      if (this._v.z > 1) {
        e.el.style.display = "none";
        continue;
      }
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      e.el.style.display = "";
      e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
    }
  }
}
