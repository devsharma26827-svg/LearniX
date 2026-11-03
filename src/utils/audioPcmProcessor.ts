/**
 * Audio PCM Processor for Real-Time 16 kHz Mono Streaming
 * Resamples browser microphone audio (44.1 kHz / 48 kHz) to 16 kHz 16-bit signed PCM.
 */

export class AudioPcmProcessor {
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isProcessing = false;
  private onChunkCallback: ((pcmChunk: Uint8Array) => void) | null = null;

  constructor(private stream: MediaStream) {}

  public start(onPcmChunk: (pcmChunk: Uint8Array) => void): void {
    if (this.isProcessing) return;
    this.onChunkCallback = onPcmChunk;
    this.isProcessing = true;

    // Use native AudioContext
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();
    const sourceSampleRate = this.audioContext.sampleRate;
    const targetSampleRate = 16000;

    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);

    // Buffer size of 4096 gives ~85ms chunks at 48kHz
    const bufferSize = 4096;
    this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.isProcessing || !this.onChunkCallback) return;

      const inputChannel = e.inputBuffer.getChannelData(0); // Mono
      const resampled = this.resampleTo16k(inputChannel, sourceSampleRate, targetSampleRate);
      const int16Pcm = this.floatToInt16(resampled);

      this.onChunkCallback(new Uint8Array(int16Pcm.buffer));
    };

    this.mediaStreamSource.connect(this.processorNode);
    // Connect processor to destination to keep it ticking (silent)
    this.processorNode.connect(this.audioContext.destination);
  }

  public stop(): void {
    this.isProcessing = false;
    this.onChunkCallback = null;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
  }

  /**
   * High-quality linear interpolation resampling to 16 kHz.
   */
  private resampleTo16k(
    inputData: Float32Array,
    inputSampleRate: number,
    targetSampleRate: number
  ): Float32Array {
    if (inputSampleRate === targetSampleRate) {
      return inputData;
    }

    const ratio = inputSampleRate / targetSampleRate;
    const targetLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(targetLength);

    for (let i = 0; i < targetLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;

      const sample1 = inputData[index] || 0;
      const sample2 = inputData[index + 1] || sample1;

      result[i] = sample1 + frac * (sample2 - sample1);
    }

    return result;
  }

  /**
   * Converts Float32Array (-1.0 to +1.0) to signed 16-bit PCM Int16Array.
   */
  private floatToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }
}
