import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.jsx';

const KIND_ICON = { usb: 'usb', hotspot: 'hotspot', 'pc-hotspot': 'hotspot', wifi: 'wifi', ethernet: 'usb', other: 'wifi' };

const GUIDES = {
  usb: {
    title: 'USB cable',
    steps: [
      'Plug the phone into this computer.',
      'Turn on USB debugging (Settings › Developer options) and tap Allow on the phone.',
      'MicMe sets up the cable link by itself. It appears under “Links” as USB.',
      'Or turn on USB tethering instead (Settings › Connections › Hotspot & tethering).',
    ],
  },
  hotspot: {
    title: 'Hotspot',
    steps: [
      'Turn on Mobile Hotspot on your phone.',
      'Connect this computer to the phone’s hotspot.',
      'Or turn on Windows Mobile Hotspot and join it from the phone.',
    ],
  },
  wifi: {
    title: 'Same Wi-Fi',
    steps: [
      'Put the phone and computer on the same Wi-Fi network.',
      'Guest and office networks often block devices from seeing each other. Use USB or a hotspot instead.',
    ],
  },
};

export function ConnectView({ info, phone, onNewCode, onDisconnect }) {
  const [qr, setQr] = useState(null);
  const [guide, setGuide] = useState('usb');

  useEffect(() => {
    if (!info?.url) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(info.url, { margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#0B0D12', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [info?.url]);

  return (
    <div className="connect">
      <section className="card pair-card">
        {phone ? (
          <div className="paired">
            <div className="paired-icon">
              <Icon name="phone" size={30} />
            </div>
            <h2>{phone.name}</h2>
            <p className="muted">
              Connected{phone.os ? ` · ${phone.os}` : ''} · {phone.ip === '127.0.0.1' ? 'USB cable' : phone.ip}
            </p>
            <div className="row gap">
              <button className="btn secondary" onClick={onDisconnect}>
                Disconnect
              </button>
              <button className="btn ghost" onClick={onNewCode}>
                <Icon name="refresh" size={15} /> New code
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="qr">
              {qr ? <img src={qr} alt="Pairing QR code" /> : <div className="qr-empty">Starting…</div>}
            </div>
            <div className="pair-text">
              <h2>Scan with the MicMe phone app</h2>
              <p className="muted">Open MicMe on your phone and tap “Scan QR code”, or type the code by hand.</p>
              <div className="code-box">
                <span className="code">{info?.code || '------'}</span>
                <button className="btn ghost sm" onClick={onNewCode} title="Make a new code">
                  <Icon name="refresh" size={14} /> New
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="connect-side">
        <section className="card">
          <div className="card-head">
            <h2>Links</h2>
          </div>
          <ul className="links">
            {info?.usbDevices?.map((d) => (
              <li key={d.serial} className="link-usb">
                <Icon name="usb" size={16} />
                <span className="link-label">USB · {d.model}</span>
                <code>cable</code>
              </li>
            ))}
            {info?.addresses?.map((a) => (
              <li key={a.address}>
                <Icon name={KIND_ICON[a.kind] || 'wifi'} size={16} />
                <span className="link-label">{a.label}</span>
                <code>{a.address}</code>
              </li>
            ))}
            {!info?.usbDevices?.length && !info?.addresses?.length && <li className="muted">No links yet. Plug in USB or join a hotspot.</li>}
          </ul>
          {!info?.adbAvailable && (
            <p className="hint small">Plain-USB mode needs Android platform-tools (adb). Without it, use USB tethering or a hotspot.</p>
          )}
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
      </div>
    </div>
  );
}
