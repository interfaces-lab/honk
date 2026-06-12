export type GooseSvgAnimationOptions = {
  readonly durationMs?: number;
  readonly staggerMs?: number;
  readonly easing?: string;
};

const DEFAULT_DURATION_MS = 900;
const DEFAULT_STAGGER_MS = 70;
const DEFAULT_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

export function prepareGooseSvgPathAnimation(
  root: SVGSVGElement,
  options: GooseSvgAnimationOptions = {},
): Animation[] {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const easing = options.easing ?? DEFAULT_EASING;
  const paths = Array.from(root.querySelectorAll<SVGPathElement>("[data-goose-draw]"));

  return paths.map((path, index) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;

    return path.animate(
      [
        { strokeDashoffset: `${length}`, opacity: 0 },
        { strokeDashoffset: "0", opacity: 1 },
      ],
      {
        delay: index * staggerMs,
        duration: durationMs,
        easing,
        fill: "forwards",
      },
    );
  });
}

export function playGooseSvgLoadingLoop(root: SVGSVGElement): Animation[] {
  const orbit = root.querySelector<SVGElement>("[data-goose-part='orbit']");
  const goose = root.querySelector<SVGElement>("[data-goose-part='goose']");
  const eye = root.querySelector<SVGElement>("[data-goose-part='eye']");
  const animations: Animation[] = [];

  if (orbit) {
    animations.push(
      orbit.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
        duration: 1180,
        iterations: Number.POSITIVE_INFINITY,
        easing: "linear",
      }),
    );
  }

  if (goose) {
    animations.push(
      goose.animate(
        [
          { transform: "translateY(0) rotate(-1deg)" },
          { transform: "translateY(-20px) rotate(1deg)" },
          { transform: "translateY(0) rotate(-1deg)" },
        ],
        {
          duration: 1450,
          iterations: Number.POSITIVE_INFINITY,
          easing: "ease-in-out",
        },
      ),
    );
  }

  if (eye) {
    animations.push(
      eye.animate(
        [
          { transform: "scaleY(1)", offset: 0 },
          { transform: "scaleY(1)", offset: 0.86 },
          { transform: "scaleY(0.12)", offset: 0.91 },
          { transform: "scaleY(1)", offset: 1 },
        ],
        {
          duration: 3100,
          iterations: Number.POSITIVE_INFINITY,
          easing: "ease-in-out",
        },
      ),
    );
  }

  return animations;
}
