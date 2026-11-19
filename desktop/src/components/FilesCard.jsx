import { useState } from 'react';
import { Icon } from './Icon.jsx';

export function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

export function FilesCard({ transfers, connected }) {
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState('');

  const send = async (paths) => {
    setMsg('');
    const r = await window.micme?.sendFiles(paths);
    if (r && !r.ok && r.error) setMsg(r.error);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    if (!connected) {
      setMsg('Connect a phone first.');
      return;
    }
    const paths = [...e.dataTransfer.files].map((f) => window.micme?.pathForFile(f)).filter(Boolean);
    if (paths.length) send(paths);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Files</h2>
        <button className="btn ghost sm" onClick={() => window.micme?.openDownloads()} title="Open Downloads/MicMe">
          Open folder
        </button>
      </div>
      <div
        className={`drop ${over ? 'over' : ''} ${connected ? '' : 'disabled'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p>{connected ? 'Drop files here to send them to the phone' : 'Connect a phone to share files'}</p>
        <button className="btn secondary sm" disabled={!connected} onClick={() => send()}>
          Choose files
        </button>
      </div>
      {msg && <p className="hint small">{msg}</p>}
      {transfers.length > 0 && (
        <ul className="transfers">
          {transfers.map((t) => {
            const pct = t.size ? Math.min(100, Math.round((t.done / t.size) * 100)) : t.state === 'done' ? 100 : 0;
            return (
              <li key={t.id} className={`transfer ${t.state}`}>
                <span className={`dir ${t.dir}`} title={t.dir === 'in' ? 'From phone' : 'To phone'}>
                  {t.dir === 'in' ? '↓' : '↑'}
                </span>
                <div className="t-body">
                  <div className="t-row">
                    {t.dir === 'in' && t.state === 'done' ? (
                      <button className="t-name link" onClick={() => window.micme?.showFile(t.path)} title="Show in folder">
                        {t.name}
                      </button>
                    ) : (
                      <span className="t-name">{t.name}</span>
                    )}
                    <span className="muted small">
                      {t.state === 'done'
                        ? formatBytes(t.size)
                        : t.state === 'failed'
                          ? 'Failed'
                          : t.state === 'queued'
                            ? 'Waiting'
                            : `${pct}%`}
                    </span>
                  </div>
                  {(t.state === 'active' || t.state === 'queued') && (
                    <div className="bar">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {t.state === 'failed' && t.error && <span className="small err">{t.error}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
