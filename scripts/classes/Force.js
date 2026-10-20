import * as d3 from "d3-force-3d";

/**
 * Thin wrapper over d3-force-3d: a 3D simulation we step by hand from
 * the render loop so it never fights our own position tweens.
 */
export default class Force {
  constructor() {
    this.sim = null;
    this.dragging = null;
  }

  start(nodes, edges) {
    for (const n of nodes) {
      if (n.z === undefined) n.z = (Math.random() - 0.5) * 2;
    }
    this.sim = d3
      .forceSimulation(nodes, 3)
      .force("charge", d3.forceManyBody().strength(-90).distanceMax(14))
      .force(
        "link",
        d3
          .forceLink(edges)
          .id((d) => d.id)
          .distance((e) => 3.2 + 5 / Math.sqrt(e.count))
          .strength(0.55)
      )
      .force("center", d3.forceCenter(0, 0, 0).strength(0.15))
      // Weak gravity: an isolated player (no drawn edge) has nothing but
      // repulsion acting on it and would otherwise drift off to infinity.
      .force("gx", d3.forceX(0).strength(0.09))
      .force("gy", d3.forceY(0).strength(0.09))
      .force("gz", d3.forceZ(0).strength(0.14))
      .force("collide", d3.forceCollide(1.6))
      .alpha(1)
      .alphaDecay(0.018)
      .velocityDecay(0.28)
      .stop();
  }

  /** Run the sim to rest synchronously (used to pre-compute the layout). */
  settle(maxTicks = 300) {
    if (!this.sim) return;
    for (let i = 0; i < maxTicks && this.sim.alpha() > this.sim.alphaMin(); i++) this.sim.tick();
  }

  tick() {
    if (!this.sim) return;
    if (this.sim.alpha() > this.sim.alphaMin()) this.sim.tick();
  }

  /** Reheat a little (after exiting a focus layout). */
  nudge(alpha = 0.25) {
    if (!this.sim) return;
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
  }

  dragStart(node) {
    if (!this.sim) return;
    this.dragging = node;
    this.sim.alpha(Math.max(this.sim.alpha(), 0.3)).alphaTarget(0.3);
    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;
  }

  dragMove(node, x, y, z) {
    node.fx = x;
    node.fy = y;
    node.fz = z;
  }

  dragEnd(node) {
    if (!this.sim) return;
    this.sim.alphaTarget(0);
    node.fx = null;
    node.fy = null;
    node.fz = null;
    this.dragging = null;
  }
}
