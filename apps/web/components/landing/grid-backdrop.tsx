/**
 * Static grid of rounded square outlines on dark teal, with a top fade and a
 * centre column wash so text stays readable — the backdrop behind the
 * scroll-lit manifesto on withpickle.com.
 *
 * Rendered as an SVG pattern (rather than the marketing site's canvas) so it
 * costs nothing at runtime and needs no client component.
 */

const SQUARE_SIZE = 12;
const SPACING = 8;
const BORDER_RADIUS = 6;
const TILE = SQUARE_SIZE + SPACING;

export function GridBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 bg-(--pk-dark-teal)">
      <svg className="size-full" aria-hidden="true">
        <title>Decorative grid</title>
        <defs>
          <pattern
            id="pk-grid"
            width={TILE}
            height={TILE}
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="0.5"
              y="0.5"
              width={SQUARE_SIZE}
              height={SQUARE_SIZE}
              rx={BORDER_RADIUS}
              fill="none"
              stroke="hsl(178 79% 16%)"
              strokeWidth="1"
            />
          </pattern>

          <linearGradient id="pk-grid-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(178 79% 8%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(178 79% 8%)" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="pk-grid-column" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(178 79% 8%)" stopOpacity="0" />
            <stop offset="35%" stopColor="hsl(178 79% 8%)" stopOpacity="1" />
            <stop offset="65%" stopColor="hsl(178 79% 8%)" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(178 79% 8%)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect width="100%" height="100%" fill="url(#pk-grid)" />
        <rect width="100%" height="100%" fill="url(#pk-grid-column)" />
        <rect width="100%" height="15%" fill="url(#pk-grid-top)" />
      </svg>
    </div>
  );
}
