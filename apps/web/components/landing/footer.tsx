import { PickleStar } from "./pickle-star";
import { ThemeToggle } from "./theme-toggle";

const PRODUCT_LINKS = [
  { href: "#about", label: "Why QuackOps" },
  { href: "#product", label: "How a run works" },
  { href: "#platform", label: "Platform" },
] as const;

const INTERNAL_LINKS = [
  { href: "https://github.com/Next-Degree/quack-ops", label: "Repo" },
  {
    href: "https://github.com/Next-Degree/quack-ops/blob/main/README.md",
    label: "Setup guide",
  },
  { href: "https://withpickle.com", label: "Pickle" },
] as const;

export function LandingFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-[1320px] md:border-t md:border-(--l-border)">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="flex items-center gap-2">
              <PickleStar className="size-4 text-(--pk-primary)" />
              <span className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
                QuackOps
              </span>
            </div>
            <div className="mt-3 text-sm text-(--l-fg-2)">
              Built by Pickle Engineering,
              <br />
              for Pickle Engineering.
            </div>
          </div>

          <div className="hidden lg:block" />

          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
              Product
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {PRODUCT_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
              Internal
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {INTERNAL_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 pb-6 pt-6 md:px-10 md:pb-10 md:pt-0">
          <span className="text-xs text-(--l-fg-3)">
            © {new Date().getFullYear()} Pickle · Internal tool
          </span>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
