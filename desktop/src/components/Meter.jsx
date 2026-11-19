import { useEffect, useRef } from 'react';

/** Peak-hold level meter driven by an AnalyserNode, updated in rAF without re-rendering React. */
export function Meter({ analyser, bars = 32 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cells = [...el.children];
    if (!analyser) {
      cells.forEach((c) => c.classList.remove('on', 'hot', 'clip'));
      return;
    }
    const buf = new Float32Array(analyser.fftSize);
    let level = 0;
    let raf;
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = 20 * Math.log10(rms || 1e-8);
      const target = Math.min(1, Math.max(0, (db + 60) / 60));
      level = target > level ? target : level * 0.9 + target * 0.1;
      const lit = Math.round(level * bars);
      for (let i = 0; i < bars; i++) {
        const c = cells[i];
        const on = i < lit;
        c.classList.toggle('on', on && i < bars * 0.7);
        c.classList.toggle('hot', on && i >= bars * 0.7 && i < bars * 0.9);
        c.classList.toggle('clip', on && i >= bars * 0.9);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [analyser, bars]);

  return (
    <div className="meter" ref={ref} role="meter" aria-label="Input level">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
