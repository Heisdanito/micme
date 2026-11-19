const os = require('node:os');

// Adapters that never lead to the phone.
const IGNORE = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|npcap/i;

/**
 * Guesses what kind of link an address is on, so the UI can say
 * "USB tethering" or "Phone hotspot" instead of just showing an IP.
 */
function classify(name, address) {
  const n = name.toLowerCase();
  if (address.startsWith('192.168.42.') || /rndis|usb|apple mobile/.test(n)) return { kind: 'usb', label: 'USB tethering' };
  if (address.startsWith('172.20.10.')) return { kind: 'hotspot', label: 'iPhone hotspot / USB' };
  if (address.startsWith('192.168.43.')) return { kind: 'hotspot', label: 'Android hotspot' };
  if (address.startsWith('192.168.137.')) return { kind: 'pc-hotspot', label: 'This PC’s hotspot' };
  if (/local area connection\*|wi-?fi direct|hosted/.test(n)) return { kind: 'pc-hotspot', label: 'This PC’s hotspot' };
  if (/wi-?fi|wlan|wireless|^en0$|^wl/.test(n)) return { kind: 'wifi', label: 'Wi-Fi' };
  if (/ethernet|^eth|^en\d|^enp/.test(n)) return { kind: 'ethernet', label: 'Ethernet / USB' };
  return { kind: 'other', label: name };
}

const RANK = { usb: 0, hotspot: 1, 'pc-hotspot': 2, wifi: 3, ethernet: 4, other: 5 };

function listAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(ifaces)) {
    if (IGNORE.test(name)) continue;
    for (const e of entries || []) {
      const v4 = e.family === 'IPv4' || e.family === 4;
      if (!v4 || e.internal || e.address.startsWith('169.254.')) continue;
      out.push({ name, address: e.address, ...classify(name, e.address) });
    }
  }
  out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  return out;
}

module.exports = { listAddresses, classify };
