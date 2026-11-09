// Recebe o áudio do microfone e entrega pedaços de 100 ms (1600 amostras a 16 kHz).
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(input.length - offset, this.buffer.length - this.filled);
      this.buffer.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
