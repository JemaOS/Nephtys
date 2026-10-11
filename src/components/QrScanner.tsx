// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Scanner de QR code via la caméra (getUserMedia + jsQR). Utilisé pour lier un
 * appareil (multi-appareil) en scannant le « code » d'un appareil déjà connecté.
 */

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X } from 'lucide-react';

interface QrScannerProps {
  /** Appelé dès qu'un QR est décodé (une seule fois). */
  onResult: (text: string) => void;
  onClose: () => void;
}

export function QrScanner({ onResult, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

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
        setError('Caméra indisponible ou refusée. Saisissez la phrase manuellement.');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <span className="text-white text-sm">Scanner le code de l'autre appareil</span>
        <button type="button" onClick={onClose} className="p-2 rounded-lg bg-white/10 text-white" aria-label="Fermer">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute w-56 h-56 border-2 border-white/80 rounded-2xl" />
      </div>
      {error && <p className="p-4 text-center text-sm text-amber-300">{error}</p>}
    </div>
  );
}