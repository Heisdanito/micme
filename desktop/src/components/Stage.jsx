import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Meter } from './Meter.jsx';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Live video with view gestures:
 *   wheel / trackpad pinch → zoom at cursor   drag → pan (when zoomed)
 *   double-click → fullscreen   R rotate · M mirror · F fullscreen · 0 reset
 */
export function Stage({ stream, hasVideo, phone, phoneState, linkState, analyser, clean, onToggleClean }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const [size, setSize] = useState({ cw: 1, ch: 1, vw: 16, vh: 9 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0, rot: 0, mirror: false });
  const drag = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream && hasVideo ? new MediaStream(stream.getVideoTracks()) : null;
    if (v.srcObject) v.play().catch(() => {});
  }, [stream, hasVideo]);

  useEffect(() => {
    const el = wrapRef.current;
    const v = videoRef.current;
    if (!el || !v) return;
    const measure = () =>
      setSize({ cw: el.clientWidth || 1, ch: el.clientHeight || 1, vw: v.videoWidth || 16, vh: v.videoHeight || 9 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    v.addEventListener('resize', measure);
    v.addEventListener('loadedmetadata', measure);
    measure();
    // Stop Chromium page-zoom on ctrl+wheel / trackpad pinch; we zoom the video instead.
    const noPageZoom = (e) => e.ctrlKey && e.preventDefault();
    el.addEventListener('wheel', noPageZoom, { passive: false });
    return () => {
      el.removeEventListener('wheel', noPageZoom);
      ro.disconnect();
      v.removeEventListener('resize', measure);
      v.removeEventListener('loadedmetadata', measure);
    };
  }, []);

  const reset = useCallback(() => setView((s) => ({ ...s, zoom: 1, x: 0, y: 0 })), []);
  const rotate = useCallback(() => setView((s) => ({ ...s, rot: (s.rot + 90) % 360, x: 0, y: 0 })), []);
  const mirror = useCallback(() => setView((s) => ({ ...s, mirror: !s.mirror })), []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (k === 'r') rotate();
      else if (k === 'm') mirror();
      else if (k === 'f') fullscreen();
      else if (k === '0') reset();
      else if (k === 'c') onToggleClean();
      else if (k === 'escape' && clean) onToggleClean();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate, mirror, fullscreen, reset, onToggleClean, clean]);

  const onWheel = (e) => {
    if (!hasVideo) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;
    setView((s) => {
      const zoom = clamp(s.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 1, 6);
      if (zoom === 1) return { ...s, zoom, x: 0, y: 0 };
      const k = zoom / s.zoom;
      return { ...s, zoom, x: px - (px - s.x) * k, y: py - (py - s.y) * k };
    });
  };

  const onPointerDown = (e) => {
    if (view.zoom <= 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setView((s) => ({ ...s, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }));
  };
  const onPointerUp = () => (drag.current = null);

  const sideways = view.rot % 180 !== 0;
  const fit = sideways ? Math.min(size.cw / size.vh, size.ch / size.vw) : Math.min(size.cw / size.vw, size.ch / size.vh);
  const sx = fit * view.zoom * (view.mirror ? -1 : 1);
  const sy = fit * view.zoom;
  const transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${view.rot}deg) scale(${sx}, ${sy})`;

  const waiting = !phone;
  const audioOnly = phone && !hasVideo;

  return (
    <section className={`stage ${view.zoom > 1 ? 'zoomed' : ''}`}>
      <div
        ref={wrapRef}
        className="stage-view"
        onWheel={onWheel}
        onDoubleClick={fullscreen}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className="stage-video"
          style={{ width: size.vw, height: size.vh, transform, visibility: hasVideo ? 'visible' : 'hidden' }}
        />

        {waiting && (
          <div className="stage-empty">
            <div className="pulse-ring">
              <Icon name="phone" size={40} />
            </div>
            <h2>Waiting for your phone</h2>
            <p className="muted">Open MicMe on your phone and scan the QR code.</p>
          </div>
        )}

        {audioOnly && (
          <div className="stage-empty">
            <div className={`mic-orb ${phoneState?.mic === false ? 'off' : ''}`}>
              <Icon name={phoneState?.mic === false ? 'micOff' : 'mic'} size={46} />
            </div>
            <h2>{phoneState?.mic === false ? 'Phone mic is muted' : 'Audio only'}</h2>
            <div className="stage-meter">
              <Meter analyser={analyser} bars={40} />
            </div>
          </div>
        )}

        {phone && linkState !== 'live' && (
          <div className="stage-banner">{linkState === 'lost' ? 'Link interrupted, waiting for the phone to reconnect…' : 'Starting stream…'}</div>
        )}
      </div>

      {hasVideo && (
        <div className="stage-tools">
          <button className="tool" onClick={rotate} title="Rotate (R)">
            <Icon name="refresh" />
          </button>
          <button className={`tool ${view.mirror ? 'on' : ''}`} onClick={mirror} title="Mirror (M)">
            <Icon name="mirror" />
          </button>
          <button className="tool zoom" onClick={reset} title="Reset zoom (0)" disabled={view.zoom === 1}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button className="tool" onClick={fullscreen} title="Fullscreen (F, double-click)">
            <Icon name="expand" />
          </button>
          <button className={`tool ${clean ? 'on' : ''}`} onClick={onToggleClean} title="Clean feed for OBS capture (C, Esc to exit)">
            <Icon name={clean ? 'shrink' : 'pin'} />
          </button>
        </div>
      )}
    </section>
  );
}
