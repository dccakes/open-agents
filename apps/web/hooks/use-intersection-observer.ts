"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * Tracks whether an element is currently intersecting the viewport.
 * Used to trigger the landing page's staggered entry animations.
 */
export function useIntersectionObserver(
  ref: RefObject<Element | null>,
  options?: IntersectionObserverInit,
): boolean {
  const [isVisible, setIsVisible] = useState(false);
  const threshold = options?.threshold;
  const root = options?.root;
  const rootMargin = options?.rootMargin;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: threshold ?? 0.3, root, rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold, root, rootMargin]);

  return isVisible;
}
