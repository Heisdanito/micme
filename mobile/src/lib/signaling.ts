import type { Pairing } from './pairing';

export type SignalMessage = { t: string; [key: string]: any };

/**
 * Opens a WebSocket to every candidate host at once and keeps the first one
 * that answers. The desktop puts USB/hotspot/Wi-Fi addresses in the QR code,
 * so whichever link actually reaches the computer wins.
 */
export function openFirstReachable(
  pairing: Pairing,
  timeoutMs = 4000,
): Promise<{ ws: WebSocket; host: string }> {
  return new Promise((resolve, reject) => {
    const sockets: WebSocket[] = [];
    let settled = false;
    let failures = 0;

    const finish = (err?: Error, win?: { ws: WebSocket; host: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of sockets) {
        if (!win || s !== win.ws) {
          s.onopen = s.onerror = s.onclose = null;
          try { s.close(); } catch {}
        }
      }
      if (win) resolve(win);
      else reject(err);
    };

    const timer = setTimeout(
      () => finish(new Error(`Couldn't reach ${pairing.name}. Check that both devices share the hotspot, Wi-Fi or USB link and the desktop app is open.`)),
      timeoutMs,
    );

    for (const host of pairing.hosts) {
      const ws = new WebSocket(`ws://${host}:${pairing.port}/ws`);
      sockets.push(ws);
      ws.onopen = () => {
        ws.onerror = ws.onclose = null;
        finish(undefined, { ws, host });
      };
      ws.onerror = ws.onclose = () => {
        failures += 1;
        if (failures === pairing.hosts.length) {
          finish(new Error(`No route to ${pairing.name} on ${pairing.hosts.join(', ')}.`));
        }
      };
    }
  });
}

export function send(ws: WebSocket | null, msg: SignalMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
