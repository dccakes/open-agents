import { ImageResponse } from "next/og";

export const alt = "QuackOps — agentic coding for Pickle Engineering";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

const DARK_TEAL = "#04231f";
const ACCENT = "#c7e89e";

const STAR_PATH =
  "M255.03 395.533C259.27 392.992 259.346 386.862 255.169 384.217L147.095 315.758C143.685 313.598 142.974 308.914 145.589 305.836L265.299 164.93C267.779 162.012 272.202 161.796 274.953 164.458L358.547 245.374C361.87 248.591 367.376 247.5 369.227 243.257L416.021 136.007C417.408 132.828 421.003 131.254 424.273 132.394L562.682 180.642C566.358 181.923 568.147 186.086 566.549 189.642L510.469 314.507C508.271 319.401 512.472 324.751 517.736 323.763L651.962 298.554C655.768 297.839 659.373 300.532 659.776 304.392L675.915 458.886C676.321 462.771 673.308 466.167 669.41 466.219L534.205 468.022C529.277 468.087 526.141 473.328 528.405 477.715L575.605 569.191C577.192 572.266 576.155 576.047 573.223 577.879L429.891 667.421C426.307 669.66 421.576 668.015 420.146 664.034L370.483 525.753C369.007 521.644 364.043 520.055 360.463 522.547L234.901 609.965C231.996 611.988 228.018 611.368 225.862 608.557L127.674 480.5C125.258 477.349 126.124 472.791 129.528 470.751L255.03 395.533Z";

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: DARK_TEAL,
        color: "#ffffff",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Brand glow — accent green top-left, teal bottom-right */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "radial-gradient(ellipse 900px 500px at 15% 20%, rgba(199, 232, 158, 0.14), transparent 60%), radial-gradient(ellipse 700px 500px at 85% 80%, rgba(13, 148, 136, 0.16), transparent 60%)",
        }}
      />

      {/* Border frame */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          borderRadius: 24,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          display: "flex",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 56px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Logo lockup */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 44,
            }}
          >
            <svg viewBox="0 0 801 800" width="34" height="34">
              <path d={STAR_PATH} fill={ACCENT} />
            </svg>
            <span
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "#ffffff",
              }}
            >
              QuackOps
            </span>
            <span
              style={{
                fontSize: 15,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(255, 255, 255, 0.45)",
              }}
            >
              Pickle Eng
            </span>
          </div>

          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: ACCENT,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Agentic engineering,</span>
            <span>running on Pickle time.</span>
          </div>

          <div
            style={{
              marginTop: 26,
              fontSize: 26,
              lineHeight: 1.45,
              color: "rgba(255, 255, 255, 0.7)",
              maxWidth: 760,
            }}
          >
            Coding agents in cloud sandboxes — branch pushed, PR opened.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TechPill label="Sandboxes" />
          <TechPill label="Durable workflows" />
          <TechPill label="GitHub native" />

          <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
            <span
              style={{
                fontSize: 18,
                color: "rgba(255, 255, 255, 0.4)",
                letterSpacing: "0.01em",
              }}
            >
              Internal · Pickle employees only
            </span>
          </div>
        </div>
      </div>
    </div>,
    { ...size },
  );
}

function TechPill({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.12)",
        background: "rgba(255, 255, 255, 0.05)",
        fontSize: 16,
        color: "rgba(255, 255, 255, 0.6)",
      }}
    >
      {label}
    </div>
  );
}
