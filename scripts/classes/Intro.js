/**
 * Quiet chrome reveal: everything tagged data-reveal fades/slides up
 * in a short stagger. The graph is the protagonist; the UI gets out
 * of the way.
 */
export default class Intro {
  constructor() {
    this.targets = Array.from(document.querySelectorAll("[data-reveal]"));
  }

  run() {
    const anims = this.targets.map((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: 550,
          delay: 50 + i * 70,
          easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
          fill: "both",
        }
      )
    );
    return Promise.all(anims.map((a) => a.finished)).catch(() => {});
  }
}
