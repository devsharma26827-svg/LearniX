import React, { useEffect, useRef } from "react";

interface AudioWaveformProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isPaused: boolean;
  className?: string;
  barColor?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  analyser,
  isRecording,
  isPaused,
  className = "w-full h-10",
  barColor = "#168A72",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let bufferLength = 32;
    let dataArray = new Uint8Array(bufferLength);

    if (analyser) {
      analyser.fftSize = 64;
      bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
    }

    let phase = 0;

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyser && isRecording && !isPaused) {
        analyser.getByteFrequencyData(dataArray);
      } else if (isRecording && !isPaused) {
        // Subtle simulated wave
        phase += 0.08;
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.max(8, Math.sin(phase + i * 0.4) * 40 + 50 + (Math.random() * 15));
        }
      } else {
        // Paused/idle
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = 10;
        }
      }

      const numBars = Math.min(28, bufferLength);
      const barWidth = Math.max(2, (width / numBars) - 3);

      for (let i = 0; i < numBars; i++) {
        const val = dataArray[i] || 8;
        const percent = val / 255;
        const barHeight = Math.max(4, percent * height * 0.85);
        const x = i * (barWidth + 3) + 2;
        const y = (height - barHeight) / 2;

        if (isPaused) {
          ctx.fillStyle = "#969990";
        } else {
          ctx.fillStyle = barColor;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, isRecording, isPaused, barColor]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={40}
      className={`${className} rounded-xl bg-[#F4F6F5] dark:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36]`}
    />
  );
};
