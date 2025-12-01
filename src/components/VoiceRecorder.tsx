import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Send, X, Trash2 } from 'lucide-react';

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onCancel,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        // Arrêter tous les tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Démarrer le timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Impossible d\'accéder au microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      onRecordingComplete(audioBlob, recordingTime);
    }
  };

  const handleDelete = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    chunksRef.current = [];
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-secondary backdrop-blur-[30px] border border-glass-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-text-primary">Message vocal</h3>
          <button
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Waveform visualization (simplified) */}
        <div className="mb-6 flex items-center justify-center h-24 bg-bg-surface rounded-xl">
          {isRecording ? (
            <div className="flex items-center gap-1">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary-500 rounded-full animate-pulse"
                  style={{
                    height: `${Math.random() * 60 + 20}px`,
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
          ) : audioUrl ? (
            <audio src={audioUrl} controls className="w-full" />
          ) : (
            <Mic size={48} className="text-text-tertiary" />
          )}
        </div>

        {/* Timer */}
        <div className="text-center mb-6">
          <div className="text-3xl font-mono font-semibold text-primary-500">
            {formatTime(recordingTime)}
          </div>
          <div className="text-sm text-text-tertiary mt-1">
            {isRecording ? 'Enregistrement en cours...' : audioBlob ? 'Enregistrement terminé' : 'Prêt'}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {isRecording ? (
            <>
              <button
                onClick={onCancel}
                className="w-12 h-12 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center transition-colors"
                aria-label="Annuler"
              >
                <X size={24} className="text-red-500" />
              </button>
              
              <button
                onClick={stopRecording}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg hover:shadow-xl active:scale-95"
                aria-label="Arrêter l'enregistrement"
              >
                <Square size={28} className="text-white" fill="white" />
              </button>
            </>
          ) : audioBlob ? (
            <>
              <button
                onClick={handleDelete}
                className="w-12 h-12 rounded-full bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center transition-colors"
                aria-label="Supprimer"
              >
                <Trash2 size={20} className="text-red-500" />
              </button>
              
              <button
                onClick={handleSend}
                className="w-16 h-16 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 hover:shadow-glow-primary flex items-center justify-center transition-all shadow-lg active:scale-95"
                aria-label="Envoyer"
              >
                <Send size={24} className="text-white" />
              </button>
            </>
          ) : null}
        </div>

        {/* Hint */}
        <div className="text-xs text-text-tertiary text-center mt-4">
          {isRecording 
            ? 'Cliquez sur le carré pour arrêter' 
            : audioBlob 
              ? 'Écoutez votre message avant de l\'envoyer'
              : 'Parlez dans votre microphone'}
        </div>
      </div>
    </div>
  );
};