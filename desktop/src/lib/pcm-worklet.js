// Plays raw PCM pushed from the main thread with a small jitter buffer.
// Target ~60 ms of buffer; if the buffer grows past ~200 ms (network burst)
// the oldest audio is dropped so latency never creeps up.
const START_SAMPLES = 2880; // 60 ms @ 48 kHz
const MAX_SAMPLES = 9600; // 200 ms

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.pos = 0;
    this.buffered = 0;
    this.playing = false;
    this.underruns = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => {
      const f = e.data;
      if (!(f instanceof Float32Array)) return;
      this.queue.push(f);
      this.buffered += f.length;
      while (this.buffered > MAX_SAMPLES && this.queue.length > 1) {
        const dropped = this.queue.shift();
        this.buffered -= dropped.length;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.playing) {
      if (this.buffered >= START_SAMPLES) this.playing = true;
      else {
        out.fill(0);
        return true;
      }
    }
    for (let i = 0; i < out.length; i++) {
      if (!this.current || this.pos >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.pos = 0;
        if (!this.current) {
          out.fill(0, i);
          this.playing = false;
          this.underruns++;
          break;
        }
      }
      out[i] = this.current[this.pos++];
      this.buffered--;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);

    if (currentTime - this.lastReport > 0.5) {
      this.lastReport = currentTime;
      this.port.postMessage({ bufferMs: Math.round((Math.max(0, this.buffered) / sampleRate) * 1000), underruns: this.underruns });
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
