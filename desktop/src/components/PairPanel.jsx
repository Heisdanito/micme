import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';

const KIND_ICON = { usb: 'usb', hotspot: 'hotspot', 'pc-hotspot': 'hotspot', wifi: 'wifi', ethernet: 'usb', other: 'wifi' };

const GUIDES = {
  hotspot: {
    title: 'Hotspot',
    steps: [
      'Turn on Mobile Hotspot on your phone.',
      'Connect this computer to the phone’s hotspot.',
      'Or: turn on Windows Mobile Hotspot and join it from the phone.',
      'Scan the QR code with the MicMe app.',
    ],
  },
  usb: {
    title: 'USB',
    steps: [
      'Plug the phone into this computer with a data cable.',
      'Android: Settings › Network › Hotspot & tethering › USB tethering.',
      'iPhone: turn on Personal Hotspot, then trust this computer.',
      'A “USB tethering” address appears below. Scan the QR code.',
    ],
  },
  wifi: {
    title: 'Wi-Fi',
    steps: [
      'Put the phone and computer on the same Wi-Fi network.',
      'Guest or office networks may block devices from seeing each other.',
      'Scan the QR code with the MicMe app.',
    ],
  },
};

export function PairPanel({ info, onNewCode, connected }) {
  const [qr, setQr] = useState(null);
  const [guide, setGuide] = useState('hotspot');

  useEffect(() => {
    if (!info?.url) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(info.url, { margin: 1, width: 560, errorCorrectionLevel: 'M', color: { dark: '#0B0D12', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [info?.url]);

  const hasUsb = info?.addresses?.some((a) => a.kind === 'usb');

  return (
    <aside className="sidebar">
      <header className="brand">
        <div className="logo">
          <Icon name="mic" size={22} />
        </div>
        <div>
          <h1>MicMe</h1>
          <p className="muted small">{info?.name || 'This computer'}</p>
        </div>
      </header>

      <section className="card pair">
        <div className="card-head">
          <h2>Pair a phone</h2>
          <button className="btn ghost sm" onClick={onNewCode} title="Make a new code and disconnect the current phone">
            <Icon name="refresh" size={15} /> New code
          </button>
        </div>
        <div className={`qr ${connected ? 'qr-dim' : ''}`}>
          {qr ? <img src={qr} alt="Pairing QR code" /> : <div className="qr-empty">No network found.<br />Connect a hotspot, Wi-Fi or USB link.</div>}
          {connected && <span className="qr-badge">Connected</span>}
        </div>
        <div className="code-row">
          <span className="muted small">Code</span>
          <span className="code">{info?.code || '------'}</span>
          <span className="muted small">Port {info?.port || '—'}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Links on this computer</h2>
        </div>
        {info?.addresses?.length ? (
          <ul className="links">
            {info.addresses.map((a) => (
              <li key={a.address}>
                <Icon name={KIND_ICON[a.kind] || 'wifi'} size={16} />
                <span className="link-label">{a.label}</span>
                <code>{a.address}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No usable network. Turn on a hotspot or USB tethering.</p>
        )}
        {!hasUsb && guide === 'usb' && <p className="hint small">No USB link found yet. Turn on USB tethering on the phone.</p>}
      </section>

      <section className="card">
        <div className="tabs" role="tablist">
          {Object.entries(GUIDES).map(([k, g]) => (
            <button key={k} role="tab" aria-selected={guide === k} className={guide === k ? 'tab active' : 'tab'} onClick={() => setGuide(k)}>
              {g.title}
            </button>
          ))}
        </div>
        <ol className="steps">
          {GUIDES[guide].steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
