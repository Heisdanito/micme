import { Icon } from '../components/Icon.jsx';
import { Meter } from '../components/Meter.jsx';
import { isVirtualDevice } from '../lib/audio.js';

export function AudioView({ phone, phoneState, audioOn, analyser, health, devices, prefs, setPrefs, control, recorder, outStream }) {
  const micMuted = phoneState?.mic === false;
  const current = devices.find((d) => d.id === prefs.outputId);
  const virtual = devices.find((d) => isVirtualDevice(d.label));
  const usingVirtual = current && isVirtualDevice(current.label);

  const state = !phone ? 'idle' : !audioOn ? 'waiting' : micMuted ? 'muted' : 'live';
  const title = { idle: 'No phone connected', waiting: 'Waiting for audio…', muted: 'Phone mic is muted', live: 'Streaming audio' }[state];
  const sub = {
    idle: 'Pair your phone on the Connect tab.',
    waiting: 'Open MicMe on the phone. Audio starts as soon as it connects.',
    muted: 'Unmute here or on the phone.',
    live: usingVirtual ? `Other apps can use it as a mic: choose “CABLE Output”.` : 'Playing on this computer.',
  }[state];

  return (
    <div className="audio-view">
      <section className={`card audio-hero ${state}`}>
        <div className="hero-top">
          <div className={`mic-orb ${state === 'live' ? '' : 'off'}`}>
            <Icon name={micMuted ? 'micOff' : 'mic'} size={38} />
          </div>
          <div className="hero-text">
            <h2>{title}</h2>
            <p className="muted">{sub}</p>
          </div>
          <div className="hero-actions">
            <button className={`btn ${micMuted ? '' : 'secondary'}`} disabled={!audioOn} onClick={() => control('mic', micMuted)}>
              <Icon name={micMuted ? 'mic' : 'micOff'} size={16} /> {micMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className={`btn ${recorder.recording ? 'danger' : 'secondary'}`}
              disabled={!audioOn}
              onClick={() => (recorder.recording ? recorder.stop() : recorder.start(null, outStream))}
            >
              <Icon name={recorder.recording ? 'stop' : 'record'} size={14} /> {recorder.recording ? 'Stop' : 'Record'}
            </button>
          </div>
        </div>
        <div className="hero-meter">
          <Meter analyser={analyser} bars={48} />
        </div>
        <div className="chips">
          <span className="chip">
            <b className="num">{audioOn ? `${health.kbps}` : '—'}</b> kbps
          </span>
          <span className="chip">
            <b className="num">{audioOn ? `${health.bufferMs}` : '—'}</b> ms buffer
          </span>
          <span className="chip">
            <b className="num">{audioOn ? health.underruns : '—'}</b> dropouts
          </span>
          <span className="chip">48 kHz · mono</span>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Output</h2>
            {usingVirtual && <span className="tag ok">Virtual mic</span>}
          </div>
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
                  To use the phone as a mic in Zoom, Discord or OBS, send audio to <b>{virtual.label}</b>, then pick “CABLE Output” as the
                  mic in that app.{' '}
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
                  driver, then choose “CABLE Input” here.
                </>
              )}
            </p>
          )}
          <label className="switch">
            <input type="checkbox" checked={prefs.monitor} onChange={(e) => setPrefs({ monitor: e.target.checked })} />
            <span className="track" />
            <span>Also play on my speakers</span>
          </label>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Sound</h2>
          </div>
          <label className="field">
            <span>
              Volume <b className="num">{Math.round(prefs.gain * 100)}%</b>
            </span>
            <input type="range" min="0" max="3" step="0.05" value={prefs.gain} onChange={(e) => setPrefs({ gain: Number(e.target.value) })} />
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={!!phoneState?.voiceProcessing}
              disabled={!phone}
              onChange={(e) => control('voice', e.target.checked)}
            />
            <span className="track" />
            <span>Clean voice (noise suppression, echo cancel, auto gain)</span>
          </label>
        </section>
      </div>
    </div>
  );
}
