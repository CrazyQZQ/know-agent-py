import { useEffect, useRef } from "react";
import gsap from "gsap";

interface EnterOptions {
  /** 垂直位移（px），默认 8 */
  y?: number;
  duration?: number;
  ease?: string;
  delay?: number;
}

/**
 * 元素进入动画 hook。用 gsap.context 限定作用域，卸载自动 revert。
 * 尊重 prefers-reduced-motion：降级为无动画（元素保持可见）。
 * 动画结束 clearProps，避免 transform/opacity 残留影响布局与测试。
 */
export function useEnterAnimation<T extends HTMLElement = HTMLDivElement>(
  options: EnterOptions = {},
) {
  const ref = useRef<T>(null);
  const { y = 8, duration = 0.28, ease = "power2.out", delay = 0 } = options;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          el,
          { autoAlpha: 0, y },
          {
            autoAlpha: 1,
            y: 0,
            duration,
            ease,
            delay,
            clearProps: "transform,opacity,visibility",
          },
        );
      });
    }, el);
    return () => ctx.revert();
  }, [y, duration, ease, delay]);
  return ref;
}
