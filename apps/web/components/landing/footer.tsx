import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "https://github.com/Next-Degree/quack-ops", label: "Repo" },
  {
    href: "https://github.com/Next-Degree/quack-ops/blob/main/README.md",
    label: "Setup",
  },
  { href: "https://withpickle.com", label: "Pickle" },
] as const;

export function LandingFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 md:px-10">
      <div className="flex items-center gap-4 text-xs text-white/40">
        <span>Pickle · internal tool</span>
        {LINKS.map((link) => (
          <a
            className="transition-colors hover:text-(--pk-accent)"
            href={link.href}
            key={link.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
      </div>
      <ThemeToggle />
    </footer>
  );
}
