import { isVirtualDevice } from '../lib/audio.js';
import { Icon } from './Icon.jsx';
import { Meter } from './Meter.jsx';

const QUALITIES = [
  ['low', '360p'],
  ['medium', '720p'],
  ['high', '1080p'],
];

export function AudioCard({ devices, prefs, setPrefs, analyser, connected }) {
  const current = devices.find((d) => d.id === prefs.outputId);
  const virtual = devices.find((d) => isVirtualDevice(d.label));
  const usingVirtual = current && isVirtualDevice(current.label);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Audio</h2>
        {usingVirtual && <span className="tag ok">Virtual mic</span>}
      </div>
      <Meter analyser={analyser} />
      <label className="field">
        <span>Send phone audio to</span>
        <select value={prefs.outputId} onChange={(e) => setPrefs({ outputId: e.target.value })}>
          {devices.length === 0 && <option value="default">System default</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      {!usingVirtual && (
        <p className="hint small">
          {virtual ? (
            <>
              To use the phone as a mic in Zoom, Discord or OBS, pick <b>{virtual.label}</b> here, then choose the matching
              “CABLE Output” as the mic in that app.{' '}
              <button className="linkish" onClick={() => setPrefs({ outputId: virtual.id })}>
                Use it
              </button>
            </>
          ) : (
            <>
              To use the phone as a mic in other apps, install the free{' '}
              <button className="linkish" onClick={() => window.micme?.openExternal('https://vb-audio.com/Cable/')}>
                VB-CABLE
              </button>{' '}
              driver, then pick “CABLE Input” here.
            </>
          )}
        </p>
      )}
      <label className="field">
        <span>
          Volume <b className="num">{Math.round(prefs.gain * 100)}%</b>
        </span>
        <input
          type="range"
          min="0"
          max="3"
          step="0.05"
          value={prefs.gain}
          onChange={(e) => setPrefs({ gain: Number(e.target.value) })}
          disabled={!connected}
        />
      </label>
      <label className="switch">
        <input type="checkbox" checked={prefs.monitor} onChange={(e) => setPrefs({ monitor: e.target.checked })} />
        <span className="track" />
        <span>Also play on my speakers</span>
      </label>
    </section>
  );
}

export function PhoneCard({ phone, phoneState, control, kick }) {
  const s = phoneState || {};
  const disabled = !phone || !phoneState;
  const isScreen = s.source === 'screen';
  return (
    <section className="card">
      <div className="card-head">
        <h2>Phone</h2>
        {phone && (
          <button className="btn ghost sm danger" onClick={kick}>
            Disconnect
          </button>
        )}
      </div>
      <div className="ctrl-grid">
        <button className={`ctrl ${s.mic ? 'on' : ''}`} disabled={disabled} onClick={() => control('mic', !s.mic)}>
          <Icon name={s.mic ? 'mic' : 'micOff'} />
          <span>{s.mic ? 'Mic on' : 'Muted'}</span>
        </button>
        <button className={`ctrl ${s.cam ? 'on' : ''}`} disabled={disabled || isScreen} onClick={() => control('cam', !s.cam)}>
          <Icon name={s.cam ? 'cam' : 'camOff'} />
          <span>{s.cam ? 'Camera' : 'Cam off'}</span>
        </button>
        <button className="ctrl" disabled={disabled || !s.cam || isScreen} onClick={() => control('flip')}>
          <Icon name="flip" />
          <span>{s.facing === 'front' ? 'Front' : 'Back'}</span>
        </button>
        <button className={`ctrl ${s.voiceProcessing ? 'on' : ''}`} disabled={disabled} onClick={() => control('voice', !s.voiceProcessing)}>
          <Icon name="sparkle" />
          <span>Clean voice</span>
        </button>
      </div>
      <div className="seg" role="radiogroup" aria-label="Video quality">
        {QUALITIES.map(([k, label]) => (
          <button
            key={k}
            role="radio"
            aria-checked={s.quality === k}
            className={s.quality === k ? 'active' : ''}
            disabled={disabled}
            onClick={() => control('quality', k)}
          >
            {label}
          </button>
        ))}
      </div>
      {isScreen && <p className="hint small">The phone is sharing its screen. Stop it on the phone to go back to the camera.</p>}
    </section>
  );
}

export function StatsCard({ stats, phone }) {
  const rows = [
    ['Latency', stats?.rtt != null ? `${stats.rtt} ms` : '—'],
    ['Bitrate', stats?.kbps != null ? `${stats.kbps >= 1000 ? (stats.kbps / 1000).toFixed(1) + ' Mbps' : stats.kbps + ' kbps'}` : '—'],
    ['Video', stats?.width ? `${stats.width}×${stats.height} · ${stats.fps ?? '—'} fps` : '—'],
    ['Loss', stats?.lossPct != null ? `${stats.lossPct}%` : '—'],
    ['Jitter', stats?.jitterMs != null ? `${stats.jitterMs} ms` : '—'],
    ['Phone', phone ? `${phone.name}${phone.os ? ' · ' + phone.os : ''}` : '—'],
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Connection</h2>
      </div>
      <dl className="stats">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
