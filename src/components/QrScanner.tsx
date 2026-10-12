// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Scanner de QR code via la caméra (getUserMedia + jsQR).
 *   • **Flash/torche** si l'appareil le permet.
 *   • **Choix d'un fichier** : décode un QR depuis une image (capture d'écran…).
 */

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X, Zap, ZapOff, Image as ImageIcon } from 'lucide-react';

interface QrScannerProps {
  /** Appelé dès qu'un QR est décodé (une seule fois). */
  onResult: (text: string) => void;
  onClose: () => void;
}

export function QrScanner({ onResult, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        trackRef.current = stream.getVideoTracks()[0] ?? null;
        const caps = (trackRef.current as unknown as { getCapabilities?: () => Record<string, unknown> })
          ?.getCapabilities?.();
        setTorchAvailable(Boolean(caps && 'torch' in caps && caps.torch));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && ctx) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height);
            if (code?.data) {
              cancelled = true;
              onResult(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError('Caméra indisponible ou refusée. Utilisez « Choisir un fichier ».');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onResult]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  const onPickFile = async (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image illisible.'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible.');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height);
      if (code?.data) onResult(code.data);
      else setError('Aucun QR code détecté dans cette image.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <span className="text-white text-sm">Scanner un QR code</span>
        <button type="button" onClick={onClose} className="p-2 rounded-lg bg-white/10 text-white" aria-label="Fermer">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute w-56 h-56 border-2 border-white/80 rounded-2xl" />
      </div>

      {/* Actions : fichier + flash */}
      <div className="flex items-center justify-center gap-8 py-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center gap-1 text-white/90"
          aria-label="Choisir un fichier"
        >
          <ImageIcon size={22} />
          <span className="text-[10px]">Fichier</span>
        </button>
        {torchAvailable && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`flex flex-col items-center gap-1 ${torchOn ? 'text-amber-300' : 'text-white/90'}`}
            aria-label="Flash"
          >
            {torchOn ? <Zap size={22} /> : <ZapOff size={22} />}
            <span className="text-[10px]">Flash</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }}
        />
      </div>
      {error && <p className="p-3 text-center text-sm text-amber-300">{error}</p>}
    </div>
  );
}