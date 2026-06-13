// FitScale — overlay-fit audit (owner 2026-06-12).
//
// Owner law: NOTHING that opens may ever vertical-scroll or clip — content
// SCALES DOWN to fit. This wrapper measures its content's natural layout
// size (ResizeObserver contentRect — transform-independent) and applies a
// uniform transform scale of min(1, maxW/naturalW, maxH/naturalH). The
// wrapper's own footprint is the SCALED size so flex centering still works.
//
// scale === 1 wherever the content already fits → pixel-identical at
// normal sizes. Only short/narrow regimes ever see a change.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface FitScaleProps {
  /** Available LOGICAL width (from useOverlayBox, minus chrome). */
  maxW: number;
  /** Available LOGICAL height (from useOverlayBox, minus chrome). */
  maxH: number;
  /** Layout width for the content before scaling. 'max-content' for
   *  intrinsic rows (e.g. a fixed card row); a number for column prompts
   *  (text wraps at this width). Defaults to min(maxW, naturalW). */
  contentWidth?: number | 'max-content';
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function FitScale({
  maxW,
  maxH,
  contentWidth,
  children,
  className,
  style,
}: FitScaleProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    const update = (): void => {
      // offsetWidth/Height are layout boxes — unaffected by our transform.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setNatural((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = natural.w > 0 && natural.h > 0 && maxW > 0 && maxH > 0;
  const s = ready ? Math.min(1, maxW / natural.w, maxH / natural.h) : 1;

  const innerWidth: CSSProperties['width'] =
    contentWidth === 'max-content'
      ? 'max-content'
      : typeof contentWidth === 'number'
        ? Math.min(contentWidth, maxW > 0 ? maxW : contentWidth)
        : maxW > 0
          ? Math.min(natural.w || maxW, maxW)
          : undefined;

  return (
    <div
      className={className}
      style={{
        ...style,
        width: ready ? natural.w * s : undefined,
        height: ready ? natural.h * s : undefined,
        overflow: 'visible',
      }}
      data-fit-scale={s < 1 ? s.toFixed(4) : undefined}
    >
      <div
        ref={innerRef}
        style={{
          width: innerWidth,
          transform: s < 1 ? `scale(${s})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default FitScale;
