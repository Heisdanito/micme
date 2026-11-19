/**
 * Pairing payload shared with the desktop app (see desktop/electron/pairing.cjs).
 *
 *   micme://pair?h=192.168.43.12,192.168.42.129&p=8787&c=K7M2QX&n=MY-PC
 *
 *   h  comma-separated candidate IPv4 addresses of the computer
 *   p  signaling port
 *   c  6-character pairing code
 *   n  computer name (display only)
 */
export type Pairing = {
  hosts: string[];
  port: number;
  code: string;
  name: string;
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^[a-zA-Z0-9.-]{1,253}$/;

export function isValidHost(h: string) {
  return IPV4.test(h) || HOSTNAME.test(h);
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function readParams(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

/** Parses a scanned QR / deep link. Returns null when it is not a MicMe code. */
export function parsePairing(raw: string): Pairing | null {
  const text = raw.trim();
  const m = /^micme:\/\/pair\?(.+)$/i.exec(text);
  if (!m) return null;
  const q = readParams(m[1]);
  const hosts = (q.h || '').split(',').map((s) => s.trim()).filter(isValidHost);
  const port = Number(q.p);
  const code = normalizeCode(q.c || '');
  if (!hosts.length || !Number.isInteger(port) || port < 1 || port > 65535 || code.length !== 6) {
    return null;
  }
  return { hosts, port, code, name: (q.n || 'Computer').slice(0, 64) };
}

/** Builds a pairing from manual entry ("192.168.1.20" or "192.168.1.20:8787"). */
export function manualPairing(address: string, code: string): Pairing | null {
  const [host, portText] = address.trim().split(':');
  const port = portText ? Number(portText) : 8787;
  const c = normalizeCode(code);
  if (!host || !isValidHost(host) || !Number.isInteger(port) || c.length !== 6) return null;
  return { hosts: [host], port, code: c, name: host };
}
