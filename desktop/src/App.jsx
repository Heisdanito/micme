import { useCallback, useEffect, useState } from 'react';
import { AudioCard, PhoneCard, StatsCard } from './components/ControlPanel.jsx';
import { FilesCard } from './components/FilesCard.jsx';
import { Icon } from './components/Icon.jsx';
import { PairPanel } from './components/PairPanel.jsx';
import { Stage } from './components/Stage.jsx';
import { useAudioEngine, useOutputDevices, useRecorder } from './lib/audio.js';
import { useReceiver } from './lib/useReceiver.js';

const PREFS_KEY = 'micme.prefs';
const DEFAULT_PREFS = { outputId: 'default', gain: 1, monitor: false };

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clock(since) {
  if (!since) return '00:00';
  const s = Math.floor((Date.now() - since) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function App() {
  const [info, setInfo] = useState(null);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [clean, setClean] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [, tick] = useState(0);

  useEffect(() => {
    window.micme?.getInfo().then(setInfo);
    const offInfo = window.micme?.onInfo(setInfo);
    const offTransfer = window.micme?.onTransfer((t) =>
      setTransfers((list) => {
        const i = list.findIndex((x) => x.id === t.id);
        if (i === -1) return [t, ...list].slice(0, 30);
        const next = list.slice();
        next[i] = { ...next[i], ...t };
        return next;
      }),
    );
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      offInfo?.();
      offTransfer?.();
      clearInterval(timer);
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

  const { phone, phoneState, stream, linkState, stats, control, kick } = useReceiver(info);
  const devices = useOutputDevices();
  const engine = useAudioEngine(stream, prefs);
  const recorder = useRecorder();

  const hasVideo = !!(stream?.getVideoTracks().length && phoneState?.hasVideo && (phoneState.cam || phoneState.source === 'screen'));
  const live = linkState === 'live';

  // Stop a recording when the phone goes away so the file is still saved.
  useEffect(() => {
    if (!live && recorder.recording) recorder.stop();
  }, [live, recorder]);

  const toggleClean = useCallback(() => setClean((c) => !c), []);

  const status = !phone ? 'Waiting for phone' : live ? 'Live' : linkState === 'lost' ? 'Reconnecting' : 'Connecting';
  const tone = !phone ? 'idle' : live ? 'live' : 'busy';

  return (
    <div className={`app ${clean ? 'clean' : ''}`}>
      <PairPanel info={info} connected={!!phone} onNewCode={() => window.micme?.newCode().then(setInfo)} />

      <main className="main">
        <header className="topbar">
          <div className="who">
            <span className={`pill ${tone}`}>
              <i />
              {status}
            </span>
            {phone && (
              <span className="muted">
                {phone.name} <span className="dim">· {phone.ip}</span>
              </span>
            )}
          </div>
          <div className="actions">
            {stats?.rtt != null && <span className="muted num">{stats.rtt} ms</span>}
            <button
              className={`btn ${recorder.recording ? 'danger' : 'secondary'}`}
              disabled={!live}
              onClick={() => (recorder.recording ? recorder.stop() : recorder.start(hasVideo ? stream : null, engine?.outStream))}
              title="Record to Videos/MicMe"
            >
              <Icon name={recorder.recording ? 'stop' : 'record'} size={14} />
              {recorder.recording ? `Stop · ${clock(recorder.startedAt)}` : 'Record'}
            </button>
          </div>
        </header>

        <Stage
          stream={stream}
          hasVideo={hasVideo}
          phone={phone}
          phoneState={phoneState}
          linkState={linkState}
          analyser={engine?.analyser}
          clean={clean}
          onToggleClean={toggleClean}
        />
      </main>

      <aside className="panel">
        <AudioCard devices={devices} prefs={prefs} setPrefs={setPrefs} analyser={engine?.analyser} connected={live} />
        <PhoneCard phone={phone} phoneState={phoneState} control={control} kick={kick} />
        <FilesCard transfers={transfers} connected={!!phone} />
        <StatsCard stats={stats} phone={phone} />
      </aside>
    </div>
  );
}
