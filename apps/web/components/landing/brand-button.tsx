import { cva, type VariantProps } from "class-variance-authority";

/**
 * Pickle-brand button styling for the marketing surface: fully rounded, lifted
 * on hover, accent green as the primary action.
 *
 * These are class strings rather than a component so they can be layered onto
 * the shared `Button` (which owns focus/disabled behaviour) or onto a plain
 * anchor.
 */
export const brandButton = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        accent:
          "bg-(--pk-accent) text-(--pk-dark-teal) shadow-none hover:-translate-y-0.5 hover:bg-(--pk-accent) hover:brightness-105 hover:shadow-lg",
        primary:
          "bg-(--pk-primary) text-white hover:-translate-y-0.5 hover:bg-(--pk-primary-hover) hover:shadow-lg",
        outlineDark:
          "border border-white/25 bg-transparent text-white hover:border-(--pk-accent) hover:bg-white/5 hover:text-(--pk-accent)",
        outlineLight:
          "border border-(--l-border) bg-transparent text-(--l-fg) hover:border-(--pk-primary) hover:bg-(--pk-primary)/5",
      },
      scale: {
        sm: "h-9 px-4 text-[13px]",
        md: "h-11 px-6 text-sm",
        lg: "h-12 px-8 text-base md:h-14 md:px-10",
      },
    },
    defaultVariants: {
      tone: "accent",
      scale: "md",
    },
  },
);

export type BrandButtonProps = VariantProps<typeof brandButton>;
