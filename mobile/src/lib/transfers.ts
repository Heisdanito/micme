import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type Transfer = {
  id: string;
  dir: 'in' | 'out';
  name: string;
  size: number;
  done: number;
  state: 'active' | 'done' | 'failed';
  error?: string;
  uri?: string;
};

export type Link = { base: string; token: string };
export type Offer = { id: string; name: string; size: number };

type Listener = (list: Transfer[]) => void;

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

function inbox(): Directory {
  const dir = new Directory(Paths.document, 'MicMe');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function uniqueFile(dir: Directory, name: string): File {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 1000; i++) {
    const f = new File(dir, i ? `${stem} (${i})${ext}` : name);
    if (!f.exists) return f;
  }
  return new File(dir, `${stem}-${Date.now()}${ext}`);
}

/**
 * Phone side of file sharing. Same model as LocalSend: plain HTTP to the
 * desktop, authorised by the session token handed out at pairing.
 */
export class TransferManager {
  private list: Transfer[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.list);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private patch(id: string, p: Partial<Transfer>) {
    this.list = this.list.map((t) => (t.id === id ? { ...t, ...p } : t));
    this.emit();
  }

  private add(t: Transfer) {
    this.list = [t, ...this.list].slice(0, 50);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.list);
  }

  /** Lets the user pick files and uploads them to the computer's Downloads/MicMe. */
  async pickAndSend(link: Link) {
    const picked = await File.pickFileAsync({ multipleFiles: true });
    if (picked.canceled || !picked.result) return;
    for (const file of picked.result) this.upload(link, file);
  }

  private async upload(link: Link, file: File) {
    const id = nextId();
    const size = file.size ?? 0;
    this.add({ id, dir: 'out', name: file.name, size, done: 0, state: 'active' });
    try {
      const url = `${link.base}/api/upload?name=${encodeURIComponent(file.name)}&size=${size}`;
      let last = 0;
      const res = await file.upload(url, {
        headers: { 'x-micme-token': link.token, 'content-type': 'application/octet-stream' },
        onProgress: ({ bytesSent, totalBytes }) => {
          const now = Date.now();
          if (now - last > 150) {
            last = now;
            this.patch(id, { done: bytesSent, size: totalBytes || size });
          }
        },
      });
      if (res.status >= 200 && res.status < 300) this.patch(id, { state: 'done', done: size });
      else this.patch(id, { state: 'failed', error: `Computer replied ${res.status}` });
    } catch (e: any) {
      this.patch(id, { state: 'failed', error: e?.message || 'Upload failed' });
    }
  }

  /** Downloads files the computer offered into the app's MicMe folder. */
  async receive(link: Link, offers: Offer[]) {
    const dir = inbox();
    for (const o of offers) {
      const id = o.id;
      const target = uniqueFile(dir, o.name);
      this.add({ id, dir: 'in', name: target.name, size: o.size, done: 0, state: 'active' });
      try {
        let last = 0;
        const file = await File.downloadFileAsync(`${link.base}/api/files/${o.id}`, target, {
          headers: { 'x-micme-token': link.token },
          onProgress: ({ bytesWritten, totalBytes }) => {
            const now = Date.now();
            if (now - last > 150) {
              last = now;
              this.patch(id, { done: bytesWritten, size: totalBytes > 0 ? totalBytes : o.size });
            }
          },
        });
        this.patch(id, { state: 'done', done: o.size, uri: file.uri });
      } catch (e: any) {
        this.patch(id, { state: 'failed', error: e?.message || 'Download failed' });
      }
    }
  }

  async share(t: Transfer) {
    if (t.uri && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(t.uri, { dialogTitle: t.name });
  }

  /** Android: copy a received file into a folder the user picks (e.g. Downloads). */
  async saveToFolder(t: Transfer) {
    if (!t.uri || Platform.OS !== 'android') return this.share(t);
    const dest = await Directory.pickDirectoryAsync();
    await new File(t.uri).copy(dest);
  }

  clearFinished() {
    this.list = this.list.filter((t) => t.state === 'active');
    this.emit();
  }
}
