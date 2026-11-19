import { Icon } from '../components/Icon.jsx';
import { Stage } from '../components/Stage.jsx';

const QUALITIES = [
  ['low', '360p'],
  ['medium', '720p'],
  ['high', '1080p'],
];

/** Camera and Screen tabs share the stage; `mode` decides the controls and copy. */
export function VideoView({ mode, phone, phoneState, stream, linkState, stats, control, recorder, outStream, clean, onToggleClean }) {
  const s = phoneState || {};
  const source = s.source || 'camera';
  const isScreen = mode === 'screen';
  const showing = !!(stream?.getVideoTracks().length && s.hasVideo && (isScreen ? source === 'screen' : source === 'camera' && s.cam));
  const live = showing && linkState === 'live';

  let placeholder = null;
  if (!phone) {
    placeholder = <Empty icon="phone" title="No phone connected" text="Pair your phone on the Connect tab." />;
  } else if (isScreen && source !== 'screen') {
    placeholder = (
      <Empty icon="phone" title="Phone screen" text="Show your phone’s screen here. The phone will ask you to allow it.">
        <button className="btn" onClick={() => control('source', 'screen')}>
          Start screen sharing
        </button>
      </Empty>
    );
  } else if (!isScreen && source === 'screen') {
    placeholder = (
      <Empty icon="cam" title="The phone is sharing its screen" text="Camera and screen share one video stream. Stop screen sharing to use the camera.">
        <button className="btn secondary" onClick={() => control('source', 'camera')}>
          Switch to camera
        </button>
      </Empty>
    );
  } else if (!isScreen && !s.cam) {
    placeholder = (
      <Empty icon="camOff" title="Camera is off" text="Turn the phone camera on to see it here.">
        <button className="btn" onClick={() => control('cam', true)}>
          Turn camera on
        </button>
      </Empty>
    );
  }

  const banner =
    phone && showing && linkState !== 'live'
      ? linkState === 'lost'
        ? 'Video link interrupted, retrying…'
        : 'Connecting video…'
      : null;

  return (
    <div className="video-view">
      <Stage stream={stream} hasVideo={showing} placeholder={placeholder} banner={banner} clean={clean} onToggleClean={onToggleClean} />

      <div className="video-bar card">
        {isScreen ? (
          <>
            <button className="btn secondary" disabled={!phone || source !== 'screen'} onClick={() => control('source', 'camera')}>
              Stop sharing
            </button>
            <span className="muted small">Pinch or scroll to zoom · drag to pan · double-click for fullscreen · R rotate</span>
          </>
        ) : (
          <>
            <button className={`btn ${s.cam ? 'secondary' : ''}`} disabled={!phone || source === 'screen'} onClick={() => control('cam', !s.cam)}>
              <Icon name={s.cam ? 'camOff' : 'cam'} size={16} /> {s.cam ? 'Camera off' : 'Camera on'}
            </button>
            <button className="btn secondary" disabled={!phone || !s.cam || source === 'screen'} onClick={() => control('flip')}>
              <Icon name="flip" size={16} /> {s.facing === 'front' ? 'Front' : 'Back'}
            </button>
            <div className="seg" role="radiogroup" aria-label="Video quality">
              {QUALITIES.map(([k, label]) => (
                <button key={k} role="radio" aria-checked={s.quality === k} className={s.quality === k ? 'active' : ''} disabled={!phone} onClick={() => control('quality', k)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="spacer" />
        {live && stats?.width && (
          <span className="muted small num">
            {stats.width}×{stats.height} · {stats.fps ?? '—'} fps · {stats.rtt ?? '—'} ms
          </span>
        )}
        <button
          className={`btn ${recorder.recording ? 'danger' : 'secondary'}`}
          disabled={!live}
          onClick={() => (recorder.recording ? recorder.stop() : recorder.start(stream, outStream))}
        >
          <Icon name={recorder.recording ? 'stop' : 'record'} size={14} /> {recorder.recording ? 'Stop' : 'Record'}
        </button>
      </div>
    </div>
  );
}

function Empty({ icon, title, text, children }) {
  return (
    <>
      <div className="pulse-ring">
        <Icon name={icon} size={38} />
      </div>
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      {children && <div style={{ marginTop: 8 }}>{children}</div>}
    </>
  );
}
