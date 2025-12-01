import React, { useRef, useState } from 'react';
import { Image, Video, File, X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface MediaUploaderProps {
  onMediaSelect: (file: File, type: 'image' | 'video' | 'file') => void;
  onUploadComplete: (url: string, type: 'image' | 'video' | 'file', fileName: string, fileSize: number) => void;
  onCancel: () => void;
}

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  onMediaSelect,
  onUploadComplete,
  onCancel,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileType = (file: File): 'image' | 'video' | 'file' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    return 'file';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Vérifier la taille (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      alert('Le fichier est trop volumineux (max 50MB)');
      return;
    }

    setSelectedFile(file);
    const type = getFileType(file);
    onMediaSelect(file, type);

    // Créer une preview pour les images et vidéos
    if (type === 'image' || type === 'video') {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const fileType = getFileType(selectedFile);
      const fileExt = selectedFile.name.split('.').pop() || 'bin';
      // Use 'media' bucket for all file types to ensure consistency
      const bucket = 'media';
      // Create a subfolder based on file type for organization
      const folder = fileType === 'image' ? 'images' : fileType === 'video' ? 'videos' : 'documents';
      const fileName = `${user.id}/${folder}/${Date.now()}_${selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Upload vers Supabase Storage
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: selectedFile.type || 'application/octet-stream',
        });

      clearInterval(progressInterval);

      if (error) {
        console.error('Upload error details:', error);
        throw new Error(error.message || 'Upload failed');
      }

      // Obtenir l'URL publique
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      setUploadProgress(100);
      onUploadComplete(publicUrl, fileType, selectedFile.name, selectedFile.size);
      
      // Reset
      setSelectedFile(null);
      setPreview(null);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      alert(`Erreur lors de l'upload du fichier: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setPreview(null);
    onCancel();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-secondary backdrop-blur-[30px] border border-glass-border rounded-2xl p-6 max-w-lg w-full shadow-2xl">
        {!selectedFile ? (
          <>
            <h3 className="text-lg font-semibold mb-4 text-text-primary">Partager un fichier</h3>
            
            <div className="grid grid-cols-3 gap-4 mb-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
              >
                <Image size={32} className="text-primary-500" />
                <span className="text-sm text-text-primary">Image</span>
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
              >
                <Video size={32} className="text-primary-500" />
                <span className="text-sm text-text-primary">Vidéo</span>
              </button>
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
              >
                <File size={32} className="text-primary-500" />
                <span className="text-sm text-text-primary">Fichier</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,application/zip,application/x-rar-compressed,application/x-7z-compressed"
              className="hidden"
            />

            <button
              onClick={handleCancel}
              className="w-full py-2 rounded-lg bg-bg-surface hover:bg-bg-hover transition-colors text-text-primary"
            >
              Annuler
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Aperçu</h3>
              <button
                onClick={handleCancel}
                className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
              >
                <X size={20} />
              </button>
            </div>

            {/* Preview */}
            <div className="mb-4 rounded-xl overflow-hidden bg-bg-surface">
              {preview && getFileType(selectedFile) === 'image' && (
                <img src={preview} alt="Preview" className="w-full h-auto max-h-96 object-contain" />
              )}
              {preview && getFileType(selectedFile) === 'video' && (
                <video src={preview} controls className="w-full h-auto max-h-96" />
              )}
              {getFileType(selectedFile) === 'file' && (
                <div className="p-8 text-center">
                  <File size={48} className="mx-auto mb-2 text-text-tertiary" />
                  <p className="text-sm text-text-secondary">{selectedFile.name}</p>
                  <p className="text-xs text-text-tertiary mt-1">{formatFileSize(selectedFile.size)}</p>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2 text-text-primary">
                  <span>Upload en cours...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={uploading}
                className="flex-1 py-2 rounded-lg bg-bg-surface hover:bg-bg-hover transition-colors disabled:opacity-50 text-text-primary"
              >
                Annuler
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex-1 py-2 rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 text-white hover:shadow-glow-primary transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Upload...
                  </>
                ) : (
                  'Envoyer'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};