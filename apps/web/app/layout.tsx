import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pickle's brand typeface, used on the landing surface.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const themeInitializationScript = `
(() => {
  const storageKey = "open-agents-theme";
  const darkModeMediaQuery = "(prefers-color-scheme: dark)";
  const storedTheme = window.localStorage.getItem(storageKey);

  const theme =
    storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";

  const resolvedTheme =
    theme === "system"
      ? window.matchMedia(darkModeMediaQuery).matches
        ? "dark"
        : "light"
      : theme;

  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
})();
`;

const isPreviewDeployment = process.env.VERCEL_ENV === "preview";
const faviconPath = isPreviewDeployment
  ? "/favicon-preview.svg"
  : "/favicon.ico";
const metadataBase =
  process.env.VERCEL_ENV === "production" &&
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : process.env.VERCEL_URL
      ? new URL(`https://${process.env.VERCEL_URL}`)
      : new URL("https://quackops.withpickle.com");

const DESCRIPTION =
  "QuackOps is Pickle's internal agentic coding platform. Spawn coding agents that run in cloud sandboxes, push branches, and open pull requests. For Pickle employees only.";

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "QuackOps — Pickle Engineering",
    template: "%s | QuackOps",
  },
  description: DESCRIPTION,
  applicationName: "QuackOps",
  icons: isPreviewDeployment
    ? { icon: faviconPath, shortcut: faviconPath }
    : {
        icon: [
          { url: "/favicon.ico" },
          { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
          { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
          {
            url: "/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            url: "/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
        shortcut: "/favicon.ico",
        apple: [
          { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "QuackOps — Pickle Engineering",
    description: DESCRIPTION,
    siteName: "QuackOps",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#04231f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} font-sans overflow-x-hidden antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
