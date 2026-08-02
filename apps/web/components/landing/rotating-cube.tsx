import { cn } from "@/lib/utils";

/**
 * The tumbling brand cube from withpickle.com, rebuilt with CSS 3D transforms
 * so the landing page ships no WebGL runtime. Face lightness steps mimic the
 * marketing site's perspective shading: front brightest, back darkest.
 */

// Lightness steps around the brand's primary green (178 79% 16%), stepped for
// perspective depth: the face toward the viewer reads lightest.
const FACES = [
  { key: "front", transform: "translateZ(var(--pk-cube-half))", shade: "24%" },
  {
    key: "back",
    transform: "rotateY(180deg) translateZ(var(--pk-cube-half))",
    shade: "9%",
  },
  {
    key: "right",
    transform: "rotateY(90deg) translateZ(var(--pk-cube-half))",
    shade: "18%",
  },
  {
    key: "left",
    transform: "rotateY(-90deg) translateZ(var(--pk-cube-half))",
    shade: "13%",
  },
  {
    key: "top",
    transform: "rotateX(90deg) translateZ(var(--pk-cube-half))",
    shade: "18%",
  },
  {
    key: "bottom",
    transform: "rotateX(-90deg) translateZ(var(--pk-cube-half))",
    shade: "13%",
  },
] as const;

export function RotatingCube({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center [perspective:1200px]",
        className,
      )}
      style={
        {
          "--pk-cube-size": "clamp(10rem, 26vw, 19rem)",
          "--pk-cube-half": "calc(var(--pk-cube-size) / 2)",
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div
        className="absolute rounded-full blur-3xl"
        style={{
          width: "calc(var(--pk-cube-size) * 1.6)",
          height: "calc(var(--pk-cube-size) * 1.6)",
          background:
            "radial-gradient(circle, hsl(79 70% 72% / 0.16) 0%, transparent 68%)",
        }}
      />

      <div
        className="pk-cube-tumble relative"
        style={{
          width: "var(--pk-cube-size)",
          height: "var(--pk-cube-size)",
        }}
      >
        {FACES.map((face) => (
          <div
            key={face.key}
            className="absolute inset-0 border-2"
            style={{
              transform: face.transform,
              backgroundColor: `hsl(178 60% ${face.shade})`,
              borderColor: "hsl(178 79% 6%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
