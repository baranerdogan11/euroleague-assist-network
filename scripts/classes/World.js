import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Force from "./Force.js";
import Label from "./Label.js";
import { TEAM_COLORS } from "./teamColors.js";

/* Cream-paper editorial palette (shared with index.css). */
const BG = new THREE.Color("#f5f1e8");
const INK = new THREE.Color("#1a1a1a");
const NODE_RADIUS = 0.35;
const DIM_OPACITY = 0.1;
const Z_SQUASH = 0.45; // flatten the 3D layout so it reads as low relief
const EDGE_R_BASE = 0.045;
const EDGE_R_SPAN = 0.085;
const RING_RADIUS = 3.4;
const PAIR_GAP = 1.7;
const UP = new THREE.Vector3(0, 1, 0);

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default class World {
  constructor(app, canvasSelector, labelsSelector) {
    this.app = app;
    this.canvas = document.querySelector(canvasSelector);
    this.labelsContainer = document.querySelector(labelsSelector);

    this.scene = new THREE.Scene();
    this.scene.background = BG;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.set(0, 0, 18);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(BG, 1);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff4dc, 1.05);
    key.position.set(-7, 12, 14);
    this.scene.add(key);
    const counter = new THREE.DirectionalLight(0xd9e4f2, 0.25);
    counter.position.set(8, -2, 4);
    this.scene.add(counter);

    this.group = new THREE.Group();
    this.group.position.y = 1.2;
    this.scene.add(this.group);

    this.nodeMeshes = [];
    this.edgeMeshes = [];
    this.nodeById = new Map();
    this.force = new Force();
    this.label = new Label(this.labelsContainer, this.camera, this.canvas);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.hovered = null;
    this.pinned = null;
    this.pinnedB = null;
    this._mode = "default"; // default → single → pair
    this._focusActive = false;
    this._preFocus = null;
    this._tweens = [];
    this._downPos = null;
    this._dragNode = null;
    this._dragPlane = new THREE.Plane();
    this._accent = new THREE.Color("#cb1c1f");

    const ramp = new Uint8Array([150, 210, 255]);
    this._toon = new THREE.DataTexture(ramp, 3, 1, THREE.RedFormat);
    this._toon.minFilter = THREE.NearestFilter;
    this._toon.magFilter = THREE.NearestFilter;
    this._toon.needsUpdate = true;

    this._nodeGeom = new THREE.SphereGeometry(NODE_RADIUS, 40, 40);
    this._haloMat = new THREE.MeshBasicMaterial({ color: BG.clone() });
    // Tapered tube: thick (-Y) end at the passer, thin (+Y) at the scorer.
    this._edgeGeom = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion() };

    this._bind();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  /* ── Events ──────────────────────────────────────────────────── */

  _bind() {
    this.canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
    this.canvas.addEventListener("pointerleave", () => this.setHovered(null));
    this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    window.addEventListener("pointerup", (e) => this._onPointerUp(e));
    this.canvas.addEventListener("dblclick", () => {
      if (this._mode === "default") this.fitAll();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("dialog[open]")) return;
      this.back();
    });
    window.addEventListener("resize", () => this.resize());
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.backButton = document.querySelector("[data-back]");
    this.backButton?.addEventListener("click", () => this.back());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this._ensureAspect();
    this.renderer.setSize(w, h, false);
    if (this._mode === "default" && this.networkRadius) {
      const next = this._fitDistance(this.networkRadius);
      if (Math.abs(next - (this.fitDist ?? 0)) > 0.5) {
        this.fitDist = next;
        this.fitAll();
      }
    }
  }

  _fitDistance(radius) {
    const tanV = Math.tan(((this.camera.fov * Math.PI) / 180) / 2);
    const tanH = tanV * this.camera.aspect;
    return Math.max(12, Math.max((radius / tanV) * 1.45, (radius / tanH) * 1.5));
  }

  /* ── Build / teardown ────────────────────────────────────────── */

  clear() {
    this._tweens = [];
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.traverse?.((o) => {
        if (o !== c && o.material && o.material !== this._haloMat) o.material.dispose?.();
      });
      if (c.material && c.material !== this._haloMat) c.material.dispose?.();
    }
    this.nodeMeshes = [];
    this.edgeMeshes = [];
    this.nodeById.clear();
    this.label.clear();
    this.hovered = null;
    this.pinned = null;
    this.pinnedB = null;
    this._focusActive = false;
    this._preFocus = null;
    this._dragNode = null;
    if (this._mode === "pair") this.app.plays?.close();
    this._mode = "default";
    this._updateBackButton();
  }

  setAccent(hex) {
    this._accent = new THREE.Color(hex);
    document.documentElement.style.setProperty("--accent", hex);
    const c = this._accent;
    document.documentElement.style.setProperty(
      "--accent-glow",
      `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, 0.35)`
    );
  }

  build(network) {
    this.clear();
    this.network = network;
    this.setAccent((TEAM_COLORS[network.team] || ["#cb1c1f"])[0]);
    const data = this.app.data;

    const totals = network.nodes.map((n) => {
      const t = data.totalsFor(n.player_id);
      return t.out + t.in;
    });
    const maxTotal = Math.max(...totals, 1);
    network.nodes.forEach((node, i) => {
      const scale = 0.7 + 1.3 * (totals[i] / maxTotal);
      const mat = new THREE.MeshToonMaterial({
        color: this._accent,
        gradientMap: this._toon,
        transparent: true,
        opacity: 1,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(this._nodeGeom, mat);
      mesh.renderOrder = 2;
      mesh.userData = { node, baseScale: scale, opacity: 1 };
      mesh.scale.setScalar(0.001);
      mesh.position.set(node.x, node.y, 0);
      const halo = new THREE.Mesh(this._nodeGeom, this._haloMat);
      halo.scale.setScalar(1.3);
      halo.renderOrder = 1;
      mesh.add(halo);
      mesh.userData.halo = halo;
      this.group.add(mesh);
      this.nodeMeshes.push(mesh);
      this.nodeById.set(node.player_id, mesh);
      // Entrance: pop in with a short stagger.
      this._tween(mesh.scale, { x: scale, y: scale, z: scale }, 650, easeOut, 120 + i * 45, `scale:${node.player_id}`);
    });

    const maxCount = Math.max(...network.edges.map((e) => e.count), 1);
    for (const edge of network.edges) {
      const t = edge.count / maxCount;
      const color = INK.clone().lerp(BG, 0.62 * (1 - Math.sqrt(t)));
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(this._edgeGeom, mat);
      const fwd = data.directedCount(edge.sourceId, edge.targetId);
      const back = data.directedCount(edge.targetId, edge.sourceId);
      const passerId = fwd >= back ? edge.sourceId : edge.targetId;
      const scorerId = passerId === edge.sourceId ? edge.targetId : edge.sourceId;
      mesh.userData = {
        edge,
        passer: this.nodeById.get(passerId),
        scorer: this.nodeById.get(scorerId),
        radius: EDGE_R_BASE + EDGE_R_SPAN * t,
        baseColor: color,
        opacity: 1,
      };
      mesh.material.opacity = 0;
      this._tween(mesh.material, { opacity: 1 }, 900, easeOut, 500, `edge:${edge.sourceId}:${edge.targetId}`);
      this.group.add(mesh);
      this.edgeMeshes.push(mesh);
    }

    this.label.rebuild(network.nodes, this.nodeById, this, (n) => {
      const t = data.totalsFor(n.player_id);
      return `${t.out} OUT · ${t.in} IN`;
    });

    // Pre-solve the layout: run the simulation to rest right now, then
    // spring every dot from its (compact) pipeline position out to its
    // settled one. The entrance reads as the network unfolding, and the
    // camera can frame the final shape from the first frame.
    const start = network.nodes.map((n) => ({ n, x: n.x, y: n.y, z: 0 }));
    this.force.start(network.nodes, network.edges);
    this.force.settle(320);
    const settled = network.nodes.map((n) => ({ n, x: n.x, y: n.y, z: n.z }));
    this._focusActive = true; // suspend ticking while the entrance plays
    let left = settled.length;
    settled.forEach((s, i) => {
      const o = start[i];
      s.n.x = o.x;
      s.n.y = o.y;
      s.n.z = o.z;
      this._tween(s.n, { x: s.x, y: s.y, z: s.z }, 1400, easeOut, 80 + i * 30, `pos:${s.n.player_id}`, () => {
        if (--left === 0 && this._mode === "default") this._focusActive = false;
      });
    });

    this._ensureAspect();
    this.networkRadius = this._measureRadius(settled);
    this.fitDist = this._fitDistance(this.networkRadius);
    this.fitAll(true);
    this._applyDimming();
  }

  _ensureAspect() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const aspect = w && h ? w / h : window.innerWidth / Math.max(1, window.innerHeight);
    if (!Number.isFinite(this.camera.aspect) || Math.abs(this.camera.aspect - aspect) > 1e-6) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Bounding radius (in the group's plane) of a set of {x,y,z} positions. */
  _measureRadius(points) {
    let r = 0;
    for (const p of points) r = Math.max(r, Math.hypot(p.x, p.y, (p.z || 0) * Z_SQUASH) + 1.0);
    return Math.max(4, r);
  }

  /* ── Per-frame ───────────────────────────────────────────────── */

  _syncPositions() {
    for (const mesh of this.nodeMeshes) {
      const n = mesh.userData.node;
      mesh.position.set(n.x, n.y, (n.z || 0) * Z_SQUASH);
    }
    const { a, b, d, q } = this._tmp;
    for (const em of this.edgeMeshes) {
      const { passer, scorer, radius } = em.userData;
      if (!passer || !scorer || !passer.visible || !scorer.visible) {
        em.visible = false;
        continue;
      }
      em.visible = em.material.opacity > 0.001;
      a.copy(passer.position);
      b.copy(scorer.position);
      d.subVectors(b, a);
      const dist = d.length();
      const gapA = NODE_RADIUS * passer.scale.x * 1.15;
      const gapB = NODE_RADIUS * scorer.scale.x * 1.15;
      const len = Math.max(0.01, dist - gapA - gapB);
      d.normalize();
      q.setFromUnitVectors(UP, d);
      em.quaternion.copy(q);
      em.position.copy(a).addScaledVector(d, gapA + len / 2);
      em.scale.set(radius, len, radius);
    }
  }

  _animate() {
    requestAnimationFrame(this._animate);
    if (!this._focusActive && !this._dragNode) this.force.tick();
    else if (this._dragNode) this.force.tick();
    this._runTweens();
    this._syncPositions();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.label.update();
  }

  /* ── Tiny tween engine ───────────────────────────────────────── */

  _tween(obj, to, duration, ease = easeInOut, delay = 0, key = null, onDone = null) {
    if (key) this._tweens = this._tweens.filter((t) => t.key !== key);
    const from = {};
    for (const k of Object.keys(to)) from[k] = obj[k];
    this._tweens.push({ obj, from, to, duration, ease, start: performance.now() + delay, key, onDone });
  }

  _runTweens() {
    if (!this._tweens.length) return;
    const now = performance.now();
    const keep = [];
    for (const t of this._tweens) {
      if (now < t.start) {
        keep.push(t);
        continue;
      }
      const p = Math.min(1, (now - t.start) / t.duration);
      const e = t.ease(p);
      for (const k of Object.keys(t.to)) t.obj[k] = t.from[k] + (t.to[k] - t.from[k]) * e;
      if (p < 1) keep.push(t);
      else t.onDone?.();
    }
    this._tweens = keep;
  }

  /* ── Pointer ─────────────────────────────────────────────────── */

  _setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.nodeMeshes.filter((m) => m.visible && m.userData.opacity > 0.5),
      false
    );
    return hits.length ? hits[0].object : null;
  }

  _onPointerMove(e) {
    this._setPointer(e);
    if (this._dragCandidate && !this._dragNode && this._downPos) {
      const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      if (moved > 5) {
        this._dragNode = this._dragCandidate;
        this.controls.enabled = false;
        const world = this._dragNode.getWorldPosition(new THREE.Vector3());
        const normal = this.camera.getWorldDirection(new THREE.Vector3());
        this._dragPlane.setFromNormalAndCoplanarPoint(normal, world);
        this.force.dragStart(this._dragNode.userData.node);
      }
    }
    if (this._dragNode) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this._dragPlane, hit)) {
        this.group.worldToLocal(hit);
        this.force.dragMove(this._dragNode.userData.node, hit.x, hit.y, hit.z / Z_SQUASH);
      }
      return;
    }
    this.setHovered(this._pick());
  }

  _onPointerDown(e) {
    this._setPointer(e);
    this._downPos = { x: e.clientX, y: e.clientY };
    const mesh = this._pick();
    if (mesh && this._mode === "default") {
      // Drag a dot: freeze it in the sim and move it on a camera-facing plane.
      this._dragCandidate = mesh;
    }
  }

  _onPointerUp(e) {
    const down = this._downPos;
    this._downPos = null;
    if (this._dragNode) {
      this.force.dragEnd(this._dragNode.userData.node);
      this._dragNode = null;
      this.controls.enabled = true;
      this._dragCandidate = null;
      return;
    }
    const cand = this._dragCandidate;
    this._dragCandidate = null;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > 5) return; // orbit drag, not a click
    if (e.target !== this.canvas) return;
    this._setPointer(e);
    const mesh = this._pick() || cand;
    if (mesh) this.handleNodeClick(mesh);
  }

  handleNodeClick(mesh) {
    if (!mesh) return;
    if (this._mode === "default") {
      this.pin(mesh);
    } else if (this._mode === "single") {
      if (mesh === this.pinned) this.back();
      else this.pinPair(mesh);
    } else if (this._mode === "pair") {
      if (mesh === this.pinnedB) this.back();
    }
  }

  setHoveredFromLabel(mesh) {
    this.setHovered(mesh);
  }

  setHovered(mesh) {
    if (this.hovered === mesh) return;
    this.hovered = mesh;
    this.canvas.classList.toggle("over-node", !!mesh);
    this._applyDimming();
  }

  /* ── Pin / focus state machine ───────────────────────────────── */

  pin(mesh) {
    this.pinned = mesh;
    this.pinnedB = null;
    this._mode = "single";
    this.app.notePinned();
    this._enterFocus(mesh);
    this._updateBackButton();
    const n = mesh.userData.node;
    this.app.sidebar.renderPlayer(this.network, n.player_id, n.name);
  }

  pinPair(meshB) {
    this.pinnedB = meshB;
    this._mode = "pair";
    this._enterPair(this.pinned, meshB);
    this._updateBackButton();
    const a = this.pinned.userData.node;
    const b = meshB.userData.node;
    this.app.sidebar.renderPair(this.network, a.player_id, b.player_id, a.name, b.name);
    this.app.plays.open(a, b);
  }

  back() {
    if (this._mode === "pair") {
      this.app.plays.close();
      this.pinnedB = null;
      this._mode = "single";
      this._enterFocus(this.pinned);
      const n = this.pinned.userData.node;
      this.app.sidebar.renderPlayer(this.network, n.player_id, n.name);
    } else if (this._mode === "single") {
      this.pinned = null;
      this._mode = "default";
      this._exitFocus();
      this.app.sidebar.renderTeam(this.network);
    }
    this._updateBackButton();
  }

  _updateBackButton() {
    const focused = this._mode !== "default";
    if (this.backButton) this.backButton.hidden = !focused;
    document.body.classList.toggle("focused", focused);
    if (this._mode !== "pair") document.body.classList.remove("pair-mode");
  }

  /** Neighbours of a node: anyone sharing a drawn edge, sorted by pair total. */
  _neighbours(mesh) {
    const id = mesh.userData.node.player_id;
    const out = [];
    for (const e of this.network.edges) {
      if (e.sourceId === id) out.push({ id: e.targetId, count: e.count });
      else if (e.targetId === id) out.push({ id: e.sourceId, count: e.count });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  _enterFocus(mesh) {
    if (!this._focusActive) {
      this._preFocus = this.network.nodes.map((n) => ({ n, x: n.x, y: n.y, z: n.z || 0 }));
      this._focusActive = true;
    }
    const id = mesh.userData.node.player_id;
    const neigh = this._neighbours(mesh);
    const neighIds = new Set(neigh.map((x) => x.id));
    this._moveNode(mesh.userData.node, 0, 0, 0);
    neigh.forEach((x, i) => {
      const ang = Math.PI / 2 - (i / neigh.length) * Math.PI * 2;
      const r = RING_RADIUS + (neigh.length > 8 ? 0.4 : 0);
      this._moveNode(this.nodeById.get(x.id).userData.node, Math.cos(ang) * r, Math.sin(ang) * r, 0);
    });
    const data = this.app.data;
    this.label.resetStats();
    for (const x of neigh) {
      // From the pinned player's perspective: what they gave this
      // teammate and what they received from them.
      this.label.setStat(x.id, `${data.directedCount(x.id, id)} OUT · ${data.directedCount(id, x.id)} IN`);
    }
    this._focusNeighbours = neighIds;
    this._applyDimming();
    this._cameraTo(0, 0, this._fitDistance(RING_RADIUS + 2.0));
  }

  _enterPair(meshA, meshB) {
    const a = meshA.userData.node;
    const b = meshB.userData.node;
    this._moveNode(a, -PAIR_GAP, 0, 0);
    this._moveNode(b, PAIR_GAP, 0, 0);
    const data = this.app.data;
    this.label.resetStats();
    this.label.setStat(a.player_id, `${data.directedCount(a.player_id, b.player_id)} OUT · ${data.directedCount(b.player_id, a.player_id)} IN`);
    this.label.setStat(b.player_id, `${data.directedCount(b.player_id, a.player_id)} OUT · ${data.directedCount(a.player_id, b.player_id)} IN`);
    document.body.classList.add("pair-mode");
    this._applyDimming();
    // Pan so the pair sits in the left ~58% of the viewport (the plays
    // panel covers the right) by moving the orbit target to the right.
    const panelFrac = Math.min(0.42, (26 * 16) / this.canvas.clientWidth);
    const dist = this._fitDistance(PAIR_GAP + 3.2);
    const visibleHalfW = Math.tan(((this.camera.fov * Math.PI) / 180) / 2) * this.camera.aspect * dist;
    this._cameraTo(visibleHalfW * panelFrac, 0, dist);
  }

  _exitFocus() {
    this.label.resetStats();
    this._focusNeighbours = null;
    const saved = this._preFocus || [];
    let left = saved.length;
    for (const s of saved) {
      this._moveNode(s.n, s.x, s.y, s.z, () => {
        if (--left === 0) {
          this._focusActive = false;
          this._preFocus = null;
          this.force.nudge(0.12);
        }
      });
    }
    if (!saved.length) this._focusActive = false;
    this._applyDimming();
    this.fitAll();
  }

  _moveNode(node, x, y, z, onDone) {
    node.vx = node.vy = node.vz = 0;
    this._tween(node, { x, y, z }, 750, easeInOut, 0, `pos:${node.player_id}`, onDone);
  }

  /* ── Dimming / visibility ────────────────────────────────────── */

  _applyDimming() {
    const states = new Map();
    const nodeTarget = new Map(); // id → opacity
    const hoverId = this.hovered?.userData.node.player_id;
    const pinId = this.pinned?.userData.node.player_id;
    const pinBId = this.pinnedB?.userData.node.player_id;

    if (this._mode === "pair") {
      for (const m of this.nodeMeshes) {
        const id = m.userData.node.player_id;
        const keep = id === pinId || id === pinBId;
        nodeTarget.set(id, keep ? 1 : 0);
        states.set(id, keep ? "pinned" : "hidden");
      }
    } else if (this._mode === "single") {
      const neigh = this._focusNeighbours || new Set();
      for (const m of this.nodeMeshes) {
        const id = m.userData.node.player_id;
        if (id === pinId) {
          nodeTarget.set(id, 1);
          states.set(id, "pinned");
        } else if (neigh.has(id)) {
          nodeTarget.set(id, 1);
          states.set(id, id === hoverId ? "hover" : "");
        } else {
          nodeTarget.set(id, 0);
          states.set(id, "hidden");
        }
      }
    } else if (hoverId) {
      const neigh = new Set(this._neighbours(this.hovered).map((x) => x.id));
      for (const m of this.nodeMeshes) {
        const id = m.userData.node.player_id;
        const near = id === hoverId || neigh.has(id);
        nodeTarget.set(id, near ? 1 : DIM_OPACITY);
        states.set(id, id === hoverId ? "hover" : near ? "" : "dimmed");
      }
    } else {
      for (const m of this.nodeMeshes) {
        nodeTarget.set(m.userData.node.player_id, 1);
      }
    }

    for (const m of this.nodeMeshes) {
      const id = m.userData.node.player_id;
      const o = nodeTarget.get(id) ?? 1;
      this._fadeNode(m, o);
    }
    for (const em of this.edgeMeshes) {
      const { edge, baseColor } = em.userData;
      const s = edge.sourceId;
      const t = edge.targetId;
      let o = 1;
      let color = baseColor;
      if (this._mode === "pair") {
        o = (s === pinId && t === pinBId) || (s === pinBId && t === pinId) ? 1 : 0;
        if (o) color = this._accent;
      } else if (this._mode === "single") {
        o = s === pinId || t === pinId ? 1 : 0;
        if (o) color = this._accent.clone().lerp(INK, 0.35);
      } else if (hoverId) {
        o = s === hoverId || t === hoverId ? 1 : DIM_OPACITY * 0.6;
      }
      em.material.color.copy(color);
      this._tween(em.material, { opacity: o }, 300, easeOut, 0, `eop:${s}:${t}`);
    }
    this.label.setStates(states);
  }

  _fadeNode(mesh, opacity) {
    const ud = mesh.userData;
    if (ud.opacity === opacity) return;
    ud.opacity = opacity;
    mesh.visible = true;
    this._tween(mesh.material, { opacity }, 300, easeOut, 0, `nop:${ud.node.player_id}`, () => {
      mesh.visible = opacity > 0;
    });
    ud.halo.visible = opacity > 0.5;
    const s = ud.baseScale * (opacity > 0 ? 1 : 0.4);
    this._tween(mesh.scale, { x: s, y: s, z: s }, 300, easeOut, 0, `scale:${ud.node.player_id}`);
  }

  /* ── Camera ──────────────────────────────────────────────────── */

  _cameraTo(tx, ty, dist, immediate = false) {
    const target = new THREE.Vector3(tx, ty + this.group.position.y, 0);
    const pos = new THREE.Vector3(tx, ty + this.group.position.y, dist);
    if (immediate) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      return;
    }
    this._tween(this.controls.target, { x: target.x, y: target.y, z: target.z }, 900, easeInOut, 0, "cam:target");
    this._tween(this.camera.position, { x: pos.x, y: pos.y, z: pos.z }, 900, easeInOut, 0, "cam:pos");
  }

  fitAll(immediate = false) {
    if (this.network && this._mode === "default" && !this._tweens.some((t) => String(t.key).startsWith("pos:"))) {
      this.networkRadius = this._measureRadius(this.network.nodes);
      this.fitDist = this._fitDistance(this.networkRadius);
    }
    const dist = Math.min(this.fitDist ?? 18, this.controls.maxDistance);
    this._cameraTo(0, 0, Number.isFinite(dist) ? dist : 18, immediate);
  }
}
