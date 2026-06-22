/**
 * Audio capture — mic → PCM 16kHz mono → WebSocket.
 * pause()/resume() used to mute mic while PILOT is speaking.
 */
export class AudioCapture {
  private stream:    MediaStream | null = null;
  private ctx:       AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser:  AnalyserNode | null = null;
  private animFrame: number | null = null;
  private _paused = false;

  constructor(
    private onPCM:   (buf: ArrayBuffer) => void,
    private onLevel: (lvl: number) => void
  ) {}

  async start() {
    if (!navigator.mediaDevices) {
      throw new Error("Microphone access is unavailable. Please ensure you are using a secure context (HTTPS or localhost) and have granted microphone permissions.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       16000,
        channelCount:     1,
      },
    });

    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    src.connect(this.analyser);
    this._startMeter();

    // ScriptProcessor for PCM — AudioWorklet preferred but needs HTTPS
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    src.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.processor.onaudioprocess = (e) => {
      if (this._paused) return;   // drop audio while PILOT is speaking
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      this.onPCM(i16.buffer);
    };
  }

  pause()  { this._paused = true;  }
  resume() { this._paused = false; }

  private _startMeter() {
    const buf = new Uint8Array(this.analyser!.frequencyBinCount);
    const tick = () => {
      this.analyser!.getByteFrequencyData(buf);
      const avg = buf.slice(0, 32).reduce((a, b) => a + b, 0) / 32;
      this.onLevel(this._paused ? 0 : Math.min(avg / 128, 1));
      this.animFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.processor?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
    this._paused = false;
  }
}
