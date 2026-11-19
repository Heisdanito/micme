import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon.jsx';
import { useAudioEngine, useOutputDevices, useRecorder } from './lib/audio.js';
import { useReceiver } from './lib/useReceiver.js';
import { AudioView } from './views/AudioView.jsx';
import { ConnectView } from './views/ConnectView.jsx';
import { FilesView } from './views/FilesView.jsx';
import { VideoView } from './views/VideoView.jsx';

const PREFS_KEY = 'micme.prefs';
const DEFAULT_PREFS = { outputId: 'default', gain: 1, monitor: false };

const TABS = [
  { id: 'connect', label: 'Connect', icon: 'qr', title: 'Connect', sub: 'Pair your phone over USB, hotspot or Wi-Fi.' },
  { id: 'audio', label: 'Audio', icon: 'mic', title: 'Audio', sub: 'Your phone as a microphone for this computer.' },
  { id: 'camera', label: 'Camera', icon: 'cam', title: 'Camera', sub: 'Your phone camera as a webcam.' },
  { id: 'screen', label: 'Screen', icon: 'screen', title: 'Screen', sub: 'Mirror your phone’s screen.' },
  { id: 'files', label: 'Files', icon: 'folder', title: 'Files', sub: 'Send files between your phone and this computer.' },
];

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function App() {
  const [info, setInfo] = useState(null);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [tab, setTab] = useState('connect');
  const [clean, setClean] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const pushRef = useRef(null);

  useEffect(() => {
    window.micme?.getInfo().then(setInfo);
    const offInfo = window.micme?.onInfo(setInfo);
    const offTransfer = window.micme?.onTransfer((t) =>
      setTransfers((list) => {
        const i = list.findIndex((x) => x.id === t.id);
        if (i === -1) return [t, ...list].slice(0, 50);
        const next = list.slice();
        next[i] = { ...next[i], ...t };
        return next;
      }),
    );
    return () => {
      offInfo?.();
      offTransfer?.();
    };
  }, []);

  const setPrefs = useCallback((p) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const onPcm = useCallback((buf) => pushRef.current?.(buf), []);
  const { phone, phoneState, stream, linkState, audioOn, stats, control, kick } = useReceiver(info, onPcm);
  const devices = useOutputDevices();
  const { engine, health, push } = useAudioEngine(!!phone, prefs);
  pushRef.current = push;
  const recorder = useRecorder();

  // Jump to Audio when a phone pairs, back to Connect when it leaves.
  const hadPhone = useRef(false);
  useEffect(() => {
    if (phone && !hadPhone.current) setTab((t) => (t === 'connect' ? 'audio' : t));
    if (!phone && hadPhone.current) setTab('connect');
    hadPhone.current = !!phone;
  }, [phone]);

  useEffect(() => {
    if (!phone && recorder.recording) recorder.stop();
  }, [phone, recorder]);

  const toggleClean = useCallback(() => setClean((c) => !c), []);
  const current = TABS.find((t) => t.id === tab);
  const activeTransfers = transfers.filter((t) => t.state === 'active' || t.state === 'queued').length;

  const status = !phone ? 'Not connected' : audioOn ? 'Connected' : 'Connecting';
  const tone = !phone ? 'idle' : audioOn ? 'live' : 'busy';
  const videoProps = { phone, phoneState, stream, linkState, stats, control, recorder, outStream: engine?.outStream, clean, onToggleClean: toggleClean };

  return (
    <div className={`shell ${clean ? 'clean' : ''}`}>
      <nav className="rail" aria-label="Sections">
        <div className="brand">
          <div className="logo">
            <Icon name="mic" size={20} />
          </div>
          <div>
            <h1>MicMe</h1>
            <p className="muted small">{info?.name || 'This computer'}</p>
          </div>
        </div>

        <ul className="nav">
          {TABS.map((t) => (
            <li key={t.id}>
              <button className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
                {t.id === 'audio' && audioOn && phoneState?.mic !== false && <i className="live-dot" title="Streaming" />}
                {t.id === 'screen' && phoneState?.source === 'screen' && <i className="live-dot" title="Sharing" />}
                {t.id === 'camera' && phoneState?.cam && phoneState?.source !== 'screen' && <i className="live-dot" title="Camera on" />}
                {t.id === 'files' && activeTransfers > 0 && <b className="badge">{activeTransfers}</b>}
              </button>
            </li>
          ))}
        </ul>

        <div className="device">
          <span className={`pill ${tone}`}>
            <i />
            {status}
          </span>
          {phone ? (
            <>
              <strong className="device-name">{phone.name}</strong>
              <span className="muted small">{phone.ip === '127.0.0.1' ? 'USB cable' : phone.ip}</span>
            </>
          ) : (
            <span className="muted small">Code {info?.code || '------'}</span>
          )}
        </div>
      </nav>

      <main className="view">
        <header className="view-head">
          <div>
            <h1>{current.title}</h1>
            <p className="muted">{current.sub}</p>
          </div>
          {recorder.recording && (
            <span className="pill rec">
              <i />
              Recording
            </span>
          )}
        </header>
        <div className="view-body">
          {tab === 'connect' && <ConnectView info={info} phone={phone} onNewCode={() => window.micme?.newCode().then(setInfo)} onDisconnect={kick} />}
          {tab === 'audio' && (
            <AudioView
              phone={phone}
              phoneState={phoneState}
              audioOn={audioOn}
              analyser={engine?.analyser}
              health={health}
              devices={devices}
              prefs={prefs}
              setPrefs={setPrefs}
              control={control}
              recorder={recorder}
              outStream={engine?.outStream}
            />
          )}
          {tab === 'camera' && <VideoView mode="camera" {...videoProps} />}
          {tab === 'screen' && <VideoView mode="screen" {...videoProps} />}
          {tab === 'files' && <FilesView transfers={transfers} connected={!!phone} />}
        </div>
      </main>
    </div>
  );
}
