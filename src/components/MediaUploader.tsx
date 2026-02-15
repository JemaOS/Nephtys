// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Image, Video, File as FileIcon, X, Loader2, Camera, Smile, Sticker, FileImage, Search, Plus, Send, Edit3, FileText, FileSpreadsheet, FileArchive, Download, Music, Play, Pause } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ImageEditor } from './ImageEditor';
import { processImageForUpload, ProcessedImage } from '@/lib/imageUtils';
import { compressVideo } from '@/lib/videoCompression';
import { DocumentPreviewModal, generatePDFThumbnail } from './DocumentPreview';

// Helper function to format file size
const formatFileSizeDisplay = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
};

// Helper function to get file extension
const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

// Helper function to get icon and color based on file type
const getDocumentIconConfig = (extension: string): { bgColor: string; icon: React.ReactNode } => {
  const ext = extension.toLowerCase();
  
  // PDF files - Red
  if (ext === 'pdf') {
    return {
      bgColor: 'bg-red-500',
      icon: <FileText size={32} className="text-white" />
    };
  }
  
  // Word documents - Blue
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return {
      bgColor: 'bg-blue-500',
      icon: <FileText size={32} className="text-white" />
    };
  }
  
  // Excel/Spreadsheets - Green
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return {
      bgColor: 'bg-green-500',
      icon: <FileSpreadsheet size={32} className="text-white" />
    };
  }
  
  // PowerPoint - Orange
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return {
      bgColor: 'bg-orange-500',
      icon: <FileImage size={32} className="text-white" />
    };
  }
  
  // Archives - Purple
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return {
      bgColor: 'bg-purple-500',
      icon: <FileArchive size={32} className="text-white" />
    };
  }
  
  // Text files - Gray
  if (['txt', 'md', 'json', 'xml', 'html', 'css', 'js'].includes(ext)) {
    return {
      bgColor: 'bg-gray-500',
      icon: <FileText size={32} className="text-white" />
    };
  }
  
  // Default - Teal/Primary
  return {
    bgColor: 'bg-[#787add]',
    icon: <FileIcon size={32} className="text-white" />
  };
};

// Custom Audio Preview Player Component - Minimalist design
const AudioPreviewPlayer: React.FC<{ file: File; preview: string | null }> = ({ file, preview }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isDragging) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (progressRef.current && audioRef.current) {
      const rect = progressRef.current.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const newTime = percent * duration;
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleProgressDrag = useCallback((e: MouseEvent) => {
    if (progressRef.current && audioRef.current && isDragging) {
      const rect = progressRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = percent * duration;
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, [isDragging, duration]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleProgressDrag);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleProgressDrag);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleProgressDrag, handleMouseUp]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="p-6">
      <div className="flex flex-col items-center gap-5">
        {/* Album art / Music icon */}
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
          <Music size={48} className="text-accent" />
        </div>
        
        {/* File name */}
        <div className="text-center max-w-full px-4">
          <p className="text-text-primary font-medium truncate">
            {file.name.replace(/\.[^/.]+$/, '')}
          </p>
          <p className="text-text-tertiary text-sm mt-1">
            {formatFileSizeDisplay(file.size)}
          </p>
        </div>
        
        {/* Custom audio player */}
        <div className="w-full max-w-sm">
          {/* Progress bar */}
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            onMouseDown={() => setIsDragging(true)}
            className="relative h-1.5 bg-bg-hover rounded-full cursor-pointer group"
          >
            {/* Progress fill */}
            <div
              className="absolute left-0 top-0 h-full bg-accent rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            {/* Drag handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
          
          {/* Time display */}
          <div className="flex justify-between text-xs text-text-tertiary mt-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          
          {/* Play/Pause button */}
          <div className="flex justify-center mt-4">
            <button
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-accent hover:bg-[#6a6ec8] flex items-center justify-center transition-colors"
            >
              {isPlaying ? (
                <Pause size={24} className="text-white" fill="white" />
              ) : (
                <Play size={24} className="text-white ml-1" fill="white" />
              )}
            </button>
          </div>
        </div>
        
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={preview || URL.createObjectURL(file)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          className="hidden"
        />
      </div>
    </div>
  );
};

// Tenor GIF API - use environment variable for security
const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY || '';
const TENOR_CLIENT_KEY = 'nephtys_app';

interface UploadedFileData {
  url: string;
  type: 'image' | 'video' | 'file' | 'audio';
  fileName: string;
  fileSize: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  duration?: number;
}

interface MediaUploaderProps {
  onMediaSelect: (selectedFile: globalThis.File, type: 'image' | 'video' | 'file' | 'audio') => void;
  onUploadComplete: (url: string, type: 'image' | 'video' | 'file' | 'audio', fileName: string, fileSize: number, width?: number, height?: number, thumbnail?: string, duration?: number) => void;
  onMultipleUploadComplete?: (files: UploadedFileData[]) => void;
  onCancel: () => void;
  onEmojiSelect?: (emoji: string) => void;
  onGifStickerSend?: (url: string, type: 'gif' | 'sticker', caption?: string) => void;
}

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  onMediaSelect,
  onUploadComplete,
  onMultipleUploadComplete,
  onCancel,
  onEmojiSelect,
  onGifStickerSend,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<'image' | 'video' | 'file' | 'audio' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Multiple files selection state
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; preview: string; type: 'image' | 'video' | 'file' | 'audio' }>>([]);
  const [multipleSelectionMode, setMultipleSelectionMode] = useState(false);
  const [multipleCaption, setMultipleCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'compressing' | 'uploading'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'attach' | 'emoji' | 'sticker' | 'gif'>('attach');
  const [cameraMode, setCameraMode] = useState<'photo' | 'video' | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);
  const [stickerPack, setStickerPack] = useState<'love' | 'fun' | 'animals' | 'food'>('love');
  // GIF/Sticker preview state
  const [selectedGifSticker, setSelectedGifSticker] = useState<{
    url: string;
    previewUrl: string;
    type: 'gif' | 'sticker';
  } | null>(null);
  const [gifStickerCaption, setGifStickerCaption] = useState('');
  // Image editor state
  const [showImageEditor, setShowImageEditor] = useState(false);
  const [imageToEdit, setImageToEdit] = useState<{ url: string; fileName: string; file: File } | null>(null);
  // PDF document preview state
  const [showDocumentPreview, setShowDocumentPreview] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentUploadPhase, setDocumentUploadPhase] = useState<'idle' | 'compressing' | 'uploading'>('idle');
  const [documentUploadProgress, setDocumentUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getFileType = (file: File): 'image' | 'video' | 'file' | 'audio' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'file';
  };

  // Handle file selection - simplified with extracted helpers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const isDocumentUpload = e.target === fileInputRef.current;

    // Check if multiple files selected (for images)
    if (files.length > 1) {
      handleMultipleFileSelect(files, isDocumentUpload ? 'file' : undefined);
      return;
    }

    const file = files[0];
    const type = isDocumentUpload ? 'file' : getFileType(file);

    // Check file size limits
    if (!validateFileSize(file, type)) {
      return;
    }

    // Check if it's a document file
    if (type === 'file' && isDocumentFile(file)) {
      console.log('Opening document preview for:', file.name, 'type:', file.type);
      setDocumentFile(file);
      setShowDocumentPreview(true);
      return;
    }

    setSelectedFile(file);
    setSelectedFileType(type);
    onMediaSelect(file, type);

    // Create preview for images, videos, and audio
    if (type === 'image' || type === 'video' || type === 'audio') {
      createFilePreview(file, type, (preview) => {
        setPreview(preview);
        // For images, show the editor
        if (type === 'image') {
          setImageToEdit({
            url: preview,
            fileName: file.name,
            file: file,
          });
          setShowImageEditor(true);
        }
      });
    }
  };

  // Helper: Check if video needs compression - extracted to reduce complexity
  const checkIfVideoNeedsCompression = async (previewUrl: string | null, file: File): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const height = video.videoHeight;
        resolve(height > 720);
      };
      video.onerror = () => resolve(false);
      video.src = previewUrl || URL.createObjectURL(file);
    });
  };

  // Helper: Get audio duration - extracted to reduce complexity
  const getAudioDuration = async (previewUrl: string): Promise<number | undefined> => {
    try {
      return await new Promise<number>((resolve) => {
        const audio = new Audio(previewUrl);
        audio.addEventListener('loadedmetadata', () => {
          resolve(Math.round(audio.duration));
        });
        audio.addEventListener('error', () => {
          resolve(0);
        });
      });
    } catch (err) {
      console.warn('Could not get audio duration:', err);
      return undefined;
    }
  };

  // Helper: Compress video if needed - extracted to reduce complexity
  const compressVideoIfNeeded = async (file: File, previewUrl: string | null): Promise<Blob> => {
    const shouldCompress = await checkIfVideoNeedsCompression(previewUrl, file);
    if (shouldCompress) {
      console.log('Video is larger than 720p, compressing...');
      setUploadPhase('compressing');
      setUploadProgress(0);
      
      const compressedBlob = await compressVideo(file, (progress) => {
        setUploadProgress(progress);
      });
      console.log('Video compression complete');
      setUploadProgress(100);
      return compressedBlob;
    }
    return file;
  };

  // Helper: Simulate upload progress - extracted to reduce complexity
  const startUploadProgressSimulation = (): ReturnType<typeof setInterval> => {
    return setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          return 90;
        }
        return prev + 10;
      });
    }, 200);
  };

  // Handle multiple file selection (WhatsApp-like)
  const handleMultipleFileSelect = async (files: FileList, forcedType?: 'image' | 'video' | 'file' | 'audio') => {
    const newFiles: Array<{ file: File; preview: string; type: 'image' | 'video' | 'file' | 'audio' }> = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      const type = forcedType || getFileType(file);

      // WhatsApp Limits
      const VIDEO_SIZE_LIMIT = 200 * 1024 * 1024; // 200MB
      const DOC_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB

      if (type === 'video' && file.size > VIDEO_SIZE_LIMIT) {
        alert(`La vidéo "${file.name}" est trop volumineuse (max 200 Mo).`);
        continue;
      }

      if (type === 'file' && file.size > DOC_SIZE_LIMIT) {
        alert(`Le document "${file.name}" est trop volumineux (max 2 Go).`);
        continue;
      }

      // Vérifier la taille (max 2GB per file)
      if (file.size > 2 * 1024 * 1024 * 1024) {
        alert(`Le fichier "${file.name}" est trop volumineux (max 2GB)`);
        continue;
      }
      
      // Create preview
      const preview = await new Promise<string>((resolve) => {
        if (type === 'image' || type === 'video') {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        } else {
          resolve('');
        }
      });

      newFiles.push({ file, preview, type });
    }

    if (newFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...newFiles]);
      setMultipleSelectionMode(true);
    }
  };

  // Add more files to selection
  const handleAddMoreFiles = () => {
    imageInputRef.current?.click();
  };

  // Remove file from selection
  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index);
      if (newFiles.length === 0) {
        setMultipleSelectionMode(false);
      }
      return newFiles;
    });
  };

  // Helper: Validate file size based on type - extracted to reduce complexity
  const validateFileSize = (file: File, type: 'image' | 'video' | 'file' | 'audio'): boolean => {
    const VIDEO_SIZE_LIMIT = 200 * 1024 * 1024; // 200MB
    const DOC_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB
    const GLOBAL_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB

    // Check video size limit
    if (type === 'video' && file.size > VIDEO_SIZE_LIMIT) {
      alert('La vidéo est trop volumineuse (max 200 Mo).');
      return false;
    }

    // Check document size limit
    if (type === 'file' && file.size > DOC_SIZE_LIMIT) {
      alert('Le document est trop volumineux (max 2 Go).');
      return false;
    }

    // Check global size limit
    if (file.size > GLOBAL_LIMIT) {
      alert('Le fichier est trop volumineux (max 2GB)');
      return false;
    }

    return true;
  };

  // Helper: Check if file is a document type - extracted to reduce complexity
  const isDocumentFile = (file: File): boolean => {
    const documentMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/rtf',
    ];
    
    const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    
    return documentMimeTypes.includes(file.type) || documentExtensions.includes(fileExtension);
  };

  // Helper: Process single file preview - extracted to reduce complexity
  const createFilePreview = (file: File, type: 'image' | 'video' | 'file' | 'audio', onPreviewCreated: (preview: string) => void): void => {
    if (type === 'image' || type === 'video' || type === 'audio') {
      const reader = new FileReader();
      reader.onloadend = () => {
        onPreviewCreated(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper: Process a single file for upload - extracted to reduce complexity
  const processSingleFile = async (
    fileItem: { file: File; preview: string; type: 'image' | 'video' | 'file' | 'audio' },
    userId: string,
    totalFiles: number,
    uploadedFiles: UploadedFileData[],
    index: number
  ): Promise<UploadedFileData | null> => {
    const { file, type, preview } = fileItem;
    
    let fileToUpload: Blob = file;
    let processedImage: ProcessedImage | null = null;
    
    // Compress images before upload
    if (type === 'image') {
      try {
        processedImage = await processImageForUpload(file);
        fileToUpload = processedImage.blob;
      } catch (err) {
        console.warn('Image compression failed, using original:', err);
      }
    }

    // Compress video if needed
    if (type === 'video') {
      const shouldCompress = await checkVideoCompression(preview);
      if (shouldCompress) {
        console.log(`Compressing video ${file.name}...`);
        const compressedBlob = await compressVideo(file);
        fileToUpload = compressedBlob;
      }
    }
    
    const folder = type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents';
    const fileName = `${userId}/${folder}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    const { data, error } = await supabase.storage
      .from('media')
      .upload(fileName, fileToUpload, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);

    const uploadedFile: UploadedFileData = {
      url: publicUrl,
      type,
      fileName: file.name,
      fileSize: fileToUpload instanceof Blob ? fileToUpload.size : file.size,
    };
    
    // Add image dimensions if available
    if (processedImage) {
      uploadedFile.width = processedImage.dimensions.width;
      uploadedFile.height = processedImage.dimensions.height;
      uploadedFile.thumbnail = processedImage.thumbnailDataUrl;
    }
    
    // Update progress
    setUploadProgress(Math.round(((index + 1) / totalFiles) * 100));
    
    return uploadedFile;
  };

  // Process a single file for upload - extracted to reduce component complexity
  const processFileForUpload = async (
    fileItem: { file: File; preview: string; type: 'image' | 'video' | 'file' | 'audio' },
    userId: string,
    index: number
  ): Promise<UploadedFileData | null> => {
    const { file, type } = fileItem;
    
    let fileToUpload: Blob = file;
    let processedImage: ProcessedImage | null = null;
    
    // Compress images before upload
    if (type === 'image') {
      try {
        processedImage = await processImageForUpload(file);
        fileToUpload = processedImage.blob;
      } catch (err) {
        console.warn('Image compression failed, using original:', err);
      }
    }

    // Compress video if needed
    if (type === 'video') {
      const shouldCompress = await checkVideoNeedsCompression(fileItem.preview);
      if (shouldCompress) {
        console.log(`Compressing video ${file.name}...`);
        const compressedBlob = await compressVideo(file);
        fileToUpload = compressedBlob;
      }
    }
    
    const folder = type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents';
    const fileName = `${userId}/${folder}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    const { data, error } = await supabase.storage
      .from('media')
      .upload(fileName, fileToUpload, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);

    const uploadedFile: UploadedFileData = {
      url: publicUrl,
      type,
      fileName: file.name,
      fileSize: fileToUpload instanceof Blob ? fileToUpload.size : file.size,
    };
    
    // Add image dimensions if available
    if (processedImage) {
      uploadedFile.width = processedImage.dimensions.width;
      uploadedFile.height = processedImage.dimensions.height;
      uploadedFile.thumbnail = processedImage.thumbnailDataUrl;
    }
    
    return uploadedFile;
  };

  // Check if video needs compression - extracted to reduce complexity
  const checkVideoNeedsCompression = async (previewUrl: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const height = video.videoHeight;
        resolve(height > 720);
      };
      video.onerror = () => resolve(false);
      video.src = previewUrl;
    });
  };
  const handleMultipleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const uploadedFiles: UploadedFileData[] = [];
      const totalFiles = selectedFiles.length;

      for (let i = 0; i < selectedFiles.length; i++) {
        const { file, type } = selectedFiles[i];
        
        let fileToUpload: Blob = file;
        let processedImage: ProcessedImage | null = null;
        
        // Compress images before upload
        if (type === 'image') {
          try {
            processedImage = await processImageForUpload(file);
            fileToUpload = processedImage.blob;
          } catch (err) {
            console.warn('Image compression failed, using original:', err);
          }
        }

        // Compress video if needed
        if (type === 'video') {
          try {
            const shouldCompress = await new Promise<boolean>((resolve) => {
              const video = document.createElement('video');
              video.preload = 'metadata';
              video.onloadedmetadata = () => {
                const height = video.videoHeight;
                resolve(height > 720);
              };
              video.onerror = () => resolve(false);
              // Use the preview URL which is already generated
              video.src = selectedFiles[i].preview;
            });

            if (shouldCompress) {
              console.log(`Compressing video ${file.name}...`);
              // We don't have granular progress for individual files in multiple upload,
              // but we can log it or just wait.
              const compressedBlob = await compressVideo(file);
              fileToUpload = compressedBlob;
            }
          } catch (err) {
            console.warn('Video compression failed, using original:', err);
          }
        }
        
        const folder = type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents';
        const fileName = `${user.id}/${folder}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        const { data, error } = await supabase.storage
          .from('media')
          .upload(fileName, fileToUpload, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'application/octet-stream',
          });

        if (error) {
          console.error('Upload error:', error);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('media')
          .getPublicUrl(fileName);

        const uploadedFile: UploadedFileData = {
          url: publicUrl,
          type,
          fileName: file.name,
          fileSize: fileToUpload instanceof Blob ? fileToUpload.size : file.size,
        };
        
        // Add image dimensions if available
        if (processedImage) {
          uploadedFile.width = processedImage.dimensions.width;
          uploadedFile.height = processedImage.dimensions.height;
          uploadedFile.thumbnail = processedImage.thumbnailDataUrl;
        }
        
        uploadedFiles.push(uploadedFile);

        // Update progress
        setUploadProgress(Math.round(((i + 1) / totalFiles) * 100));
      }

      // If we have a callback for multiple uploads, use it
      if (onMultipleUploadComplete && uploadedFiles.length > 0) {
        onMultipleUploadComplete(uploadedFiles);
      } else {
        // Fallback: send files one by one
        for (const uploadedFile of uploadedFiles) {
          onUploadComplete(
            uploadedFile.url,
            uploadedFile.type,
            uploadedFile.fileName,
            uploadedFile.fileSize,
            uploadedFile.width,
            uploadedFile.height,
            uploadedFile.thumbnail
          );
        }
      }

      // Reset
      setSelectedFiles([]);
      setMultipleSelectionMode(false);
      setMultipleCaption('');
      onCancel();
    } catch (error: any) {
      console.error('Error uploading files:', error);
      alert(`Erreur lors de l'upload: ${error?.message || 'Erreur inconnue'}`);
    } finally {
      setUploading(false);
    }
  };

  // Camera functions
  const startCamera = async (mode: 'photo' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: mode === 'video'
      });
      setCameraStream(stream);
      setCameraMode(mode);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setCameraMode(null);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
            setSelectedFile(file);
            setSelectedFileType('image');
            setPreview(canvas.toDataURL('image/jpeg'));
            onMediaSelect(file, 'image');
            stopCamera();
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    const type = getFileType(file);
    setSelectedFileType(type);
    onMediaSelect(file, type);
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadPhase('idle');
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const fileType = selectedFileType || getFileType(selectedFile);
      let fileToUpload: Blob = selectedFile;
      let processedImage: ProcessedImage | null = null;
      
      // Compress images before upload
      if (fileType === 'image') {
        try {
          setUploadPhase('compressing');
          setUploadProgress(0);
          processedImage = await processImageForUpload(selectedFile);
          fileToUpload = processedImage.blob;
          setUploadProgress(100);
        } catch (err) {
          console.warn('Image compression failed, using original:', err);
        }
      }

      // Compress video if needed (1080p/4K -> 720p)
      if (fileType === 'video') {
        try {
          const shouldCompress = await checkIfVideoNeedsCompression(preview, selectedFile);
          if (shouldCompress) {
            console.log('Video is larger than 720p, compressing...');
            setUploadPhase('compressing');
            setUploadProgress(0);
            
            const compressedBlob = await compressVideo(selectedFile, (progress) => {
              setUploadProgress(progress);
            });
            fileToUpload = compressedBlob;
            console.log('Video compression complete');
            setUploadProgress(100);
          }
        } catch (err) {
          console.warn('Video compression failed, using original:', err);
        }
      }
      
      const fileExt = selectedFile.name.split('.').pop() || 'bin';
      const bucket = 'media';
      const folder = fileType === 'image' ? 'images' : fileType === 'video' ? 'videos' : fileType === 'audio' ? 'audio' : 'documents';
      const fileName = `${user.id}/${folder}/${Date.now()}_${selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      // Get audio duration if it's an audio file
      let audioDuration: number | undefined;
      if (fileType === 'audio' && preview) {
        audioDuration = await getAudioDuration(preview);
      }

      // Start Upload Phase
      setUploadPhase('uploading');
      setUploadProgress(0);

      // Simulate progress for better UX
      const progressInterval = startUploadProgressSimulation();

      // Upload to Supabase Storage
      console.log(`[MediaUploader] Starting upload: ${fileName}, size: ${fileToUpload.size}, type: ${selectedFile.type}`);
      const uploadStartTime = Date.now();

      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, fileToUpload, {
          cacheControl: '3600',
          upsert: false,
          contentType: selectedFile.type || 'application/octet-stream',
        });

      const uploadDuration = Date.now() - uploadStartTime;
      console.log(`[MediaUploader] Upload finished in ${uploadDuration}ms`);

      clearInterval(progressInterval);

      if (error) {
        console.error('[MediaUploader] Upload error details:', error);
        if ('statusCode' in error) console.error('[MediaUploader] Status code:', (error as any).statusCode);
        if ('error' in error) console.error('[MediaUploader] Inner error:', (error as any).error);
        
        throw new Error(error.message || 'Upload failed');
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      setUploadProgress(100);
      
      // Call completion callback
      onUploadComplete(
        publicUrl,
        fileType,
        selectedFile.name,
        fileToUpload instanceof Blob ? fileToUpload.size : selectedFile.size,
        processedImage?.dimensions.width,
        processedImage?.dimensions.height,
        processedImage?.thumbnailDataUrl,
        audioDuration
      );
      
      // Reset state
      setSelectedFile(null);
      setSelectedFileType(null);
      setPreview(null);
      setUploadPhase('idle');
    } catch (error: any) {
      console.error('Error uploading file:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      alert(`Erreur lors de l'upload du fichier: ${errorMessage}`);
    } finally {
      setUploading(false);
      setUploadPhase('idle');
    }
  };

  const handleCancel = () => {
    stopCamera();
    setSelectedFile(null);
    setSelectedFileType(null);
    setPreview(null);
    setSelectedFiles([]);
    setMultipleSelectionMode(false);
    setMultipleCaption('');
    setActiveTab('attach');
    setShowImageEditor(false);
    setImageToEdit(null);
    setShowDocumentPreview(false);
    setDocumentFile(null);
    setDocumentUploading(false);
    setDocumentUploadPhase('idle');
    setDocumentUploadProgress(0);
    onCancel();
  };

  // Handle document send from preview modal (PDF, Word, Excel, etc.)
  const handleDocumentSend = async (caption: string) => {
    if (!documentFile) return;

    setDocumentUploading(true);
    setDocumentUploadPhase('idle');
    setDocumentUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Check if file is a PDF to generate thumbnail
      const isPDF = documentFile.type === 'application/pdf' || documentFile.name.toLowerCase().endsWith('.pdf');
      
      // Generate thumbnail from PDF first page (only for PDFs)
      let thumbnailUrl: string | undefined;
      if (isPDF) {
        try {
          setDocumentUploadPhase('compressing');
          setDocumentUploadProgress(5);
          const thumbnailDataUrl = await generatePDFThumbnail(documentFile, 300);
          setDocumentUploadProgress(15);

          // Upload thumbnail to storage
          const thumbnailResponse = await fetch(thumbnailDataUrl);
          const thumbnailBlob = await thumbnailResponse.blob();
          const thumbnailFileName = `${user.id}/thumbnails/${Date.now()}_${documentFile.name.replace(/\.[^/.]+$/, '')}_thumb.jpg`;

          const { error: thumbError } = await supabase.storage
            .from('media')
            .upload(thumbnailFileName, thumbnailBlob, {
              cacheControl: '3600',
              upsert: false,
              contentType: 'image/jpeg',
            });

          if (!thumbError) {
            const { data: { publicUrl } } = supabase.storage
              .from('media')
              .getPublicUrl(thumbnailFileName);
            thumbnailUrl = publicUrl;
          }
          setDocumentUploadProgress(30);
        } catch (err) {
          console.warn('PDF thumbnail generation failed, continuing without thumbnail:', err);
          setDocumentUploadProgress(30);
        }
      } else {
        // For non-PDF documents, skip thumbnail generation
        setDocumentUploadProgress(30);
      }

      // Upload the document
      setDocumentUploadPhase('uploading');
      const folder = 'documents';
      const fileName = `${user.id}/${folder}/${Date.now()}_${documentFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setDocumentUploadProgress(prev => {
          if (prev >= 90) {
            // Don't clear interval here, let it sit at 90 until done
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const { data, error } = await supabase.storage
        .from('media')
        .upload(fileName, documentFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: documentFile.type || 'application/octet-stream',
        });

      clearInterval(progressInterval);

      if (error) {
        console.error('Upload error details:', error);
        throw new Error(error.message || 'Upload failed');
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(fileName);

      setDocumentUploadProgress(100);

      // Call onUploadComplete with thumbnail URL
      onUploadComplete(
        publicUrl,
        'file',
        documentFile.name,
        documentFile.size,
        undefined, // width
        undefined, // height
        thumbnailUrl // thumbnail URL for PDF preview
      );

      // Reset state
      setShowDocumentPreview(false);
      setDocumentFile(null);
      setDocumentUploading(false);
      setDocumentUploadPhase('idle');
      setDocumentUploadProgress(0);
    } catch (error: any) {
      console.error('Error uploading document:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      alert(`Erreur lors de l'upload du document: ${errorMessage}`);
      setDocumentUploading(false);
      setDocumentUploadPhase('idle');
    }
  };

  // Handle edited image from ImageEditor
  const handleImageEditorSave = async (editedBlob: Blob, fileName: string) => {
    // Create a File from the Blob
    const editedFile = new File([editedBlob], fileName, { type: 'image/png' });
    setSelectedFile(editedFile);
    setSelectedFileType('image');
    
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(editedBlob);
    
    setShowImageEditor(false);
    setImageToEdit(null);
  };

  // Handle send from ImageEditor
  const handleImageEditorSend = async (editedBlob: Blob, fileName: string, caption: string) => {
    setUploading(true);
    setUploadPhase('idle');
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const editedFile = new File([editedBlob], fileName, { type: 'image/png' });
      
      // Process the edited image to get dimensions and thumbnail
      let processedImage: ProcessedImage | null = null;
      try {
        setUploadPhase('compressing');
        setUploadProgress(0);
        processedImage = await processImageForUpload(editedFile);
        setUploadProgress(100);
      } catch (err) {
        console.warn('Image processing failed:', err);
      }
      
      const fileToUpload = processedImage?.blob || editedFile;
      const folder = 'images';
      const uploadFileName = `${user.id}/${folder}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      setUploadPhase('uploading');
      setUploadProgress(0);

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            // Don't clear interval here, let it sit at 90 until done
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const { data, error } = await supabase.storage
        .from('media')
        .upload(uploadFileName, fileToUpload, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/png',
        });

      clearInterval(progressInterval);

      if (error) {
        console.error('Upload error details:', error);
        throw new Error(error.message || 'Upload failed');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(uploadFileName);

      setUploadProgress(100);
      onUploadComplete(
        publicUrl,
        'image',
        fileName,
        fileToUpload instanceof Blob ? fileToUpload.size : editedFile.size,
        processedImage?.dimensions.width,
        processedImage?.dimensions.height,
        processedImage?.thumbnailDataUrl
      );
      
      // Reset
      setSelectedFile(null);
      setSelectedFileType(null);
      setPreview(null);
      setShowImageEditor(false);
      setImageToEdit(null);
      setUploadPhase('idle');
    } catch (error: any) {
      console.error('Error uploading file:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      alert(`Erreur lors de l'upload du fichier: ${errorMessage}`);
    } finally {
      setUploading(false);
      setUploadPhase('idle');
    }
  };

  // Open image editor for existing preview
  const openImageEditor = () => {
    if (preview && selectedFile && (selectedFileType || getFileType(selectedFile)) === 'image') {
      setImageToEdit({
        url: preview,
        fileName: selectedFile.name,
        file: selectedFile,
      });
      setShowImageEditor(true);
    }
  };

  const handleEmojiClick = (emoji: string) => {
    if (onEmojiSelect) {
      onEmojiSelect(emoji);
      onCancel();
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Helper: Render emoji categories - extracted to reduce complexity
  const renderEmojiCategories = () => (
    <div className="space-y-4">
      {Object.entries(emojiCategories).map(([category, emojis]) => (
        <div key={category}>
          <h4 className="text-xs text-text-secondary uppercase mb-2">
            {getEmojiCategoryLabel(category)}
          </h4>
          <div className="grid grid-cols-8 gap-1">
            {emojis.map((emoji, idx) => (
              <button
                key={idx}
                onClick={() => handleEmojiClick(emoji)}
                className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-bg-hover rounded-lg transition-all hover:scale-110 active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // Helper: Get emoji category label - extracted to reduce complexity
  const getEmojiCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      recent: 'Récents',
      smileys: 'Smileys',
      gestures: 'Gestes',
      hearts: 'Cœurs',
      objects: 'Objets',
      nature: 'Nature',
      food: 'Nourriture',
    };
    return labels[category] || category;
  };

  // Helper: Render sticker category button - extracted to reduce complexity
  const renderStickerCategoryButton = (category: string) => (
    <button
      key={category}
      onClick={() => {
        setSelectedStickerCategory(category);
        setStickerSearchQuery('');
      }}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        selectedStickerCategory === category && !stickerSearchQuery
          ? 'bg-accent text-white'
          : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
      }`}
    >
      {getStickerCategoryLabel(category)}
    </button>
  );

  // Helper: Get sticker category label - extracted to reduce complexity
  const getStickerCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      love: '❤️ Amour',
      happy: '😊 Joyeux',
      sad: '😢 Triste',
      angry: '😠 Fâché',
      cute: '🥰 Mignon',
      funny: '😂 Drôle',
      hello: '👋 Salut',
      bye: '👋 Au revoir',
      thanks: '🙏 Merci',
      sorry: '😔 Désolé',
    };
    return labels[category] || category;
  };
  const emojiCategories = {
    recent: ['👍', '❤️', '😂', '😮', '😢', '🙏'],
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
    objects: ['🎉', '🎊', '🎁', '🎈', '🎀', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🎮', '🎯', '🎲', '🧩'],
    nature: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '💐', '🌿', '🍀', '🌴', '🌵', '🌲', '🌳', '🍁', '🍂', '🍃', '🌾', '🌱', '🌊', '🔥'],
    food: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🍕', '🍔', '🍟', '🌭'],
  };

  // Sticker search categories
  const stickerCategories = ['love', 'happy', 'sad', 'angry', 'cute', 'funny', 'hello', 'bye', 'thanks', 'sorry'];
  const [selectedStickerCategory, setSelectedStickerCategory] = useState('love');
  const [stickers, setStickers] = useState<any[]>([]);
  const [loadingStickers, setLoadingStickers] = useState(false);
  const [stickerSearchQuery, setStickerSearchQuery] = useState('');

  // Fetch stickers from Tenor API
  const fetchStickers = async (query: string = 'love') => {
    setLoadingStickers(true);
    try {
      const endpoint = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query + ' sticker')}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20&media_filter=tinywebp,webp`;
      
      const response = await fetch(endpoint);
      const data = await response.json();
      
      if (data.results) {
        setStickers(data.results);
      }
    } catch (error) {
      console.error('Error fetching stickers:', error);
      setStickers([]);
    } finally {
      setLoadingStickers(false);
    }
  };

  // Load stickers when sticker tab is opened
  useEffect(() => {
    if (activeTab === 'sticker' && stickers.length === 0) {
      fetchStickers(selectedStickerCategory);
    }
  }, [activeTab]);

  // Fetch stickers when category changes
  useEffect(() => {
    if (activeTab === 'sticker') {
      fetchStickers(stickerSearchQuery || selectedStickerCategory);
    }
  }, [selectedStickerCategory]);

  // Debounced sticker search
  useEffect(() => {
    if (activeTab === 'sticker' && stickerSearchQuery) {
      const timer = setTimeout(() => {
        fetchStickers(stickerSearchQuery);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [stickerSearchQuery]);

  const handleStickerSelect = async (sticker: any) => {
    const stickerUrl = sticker.media_formats?.webp?.url || sticker.media_formats?.tinywebp?.url || sticker.media_formats?.gif?.url || sticker.media_formats?.tinygif?.url;
    const previewUrl = sticker.media_formats?.tinywebp?.url || sticker.media_formats?.tinygif?.url || stickerUrl;
    
    if (stickerUrl) {
      // Show preview instead of sending immediately
      setSelectedGifSticker({
        url: stickerUrl,
        previewUrl: previewUrl,
        type: 'sticker'
      });
    }
  };

  // Fetch GIFs from Tenor API
  const fetchGifs = async (query: string = '') => {
    setLoadingGifs(true);
    try {
      const endpoint = query
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20`;
      
      const response = await fetch(endpoint);
      const data = await response.json();
      
      if (data.results) {
        setGifs(data.results);
      }
    } catch (error) {
      console.error('Error fetching GIFs:', error);
      // Fallback to placeholder GIFs if API fails
      setGifs([]);
    } finally {
      setLoadingGifs(false);
    }
  };

  // Load featured GIFs when GIF tab is opened
  useEffect(() => {
    if (activeTab === 'gif' && gifs.length === 0) {
      fetchGifs();
    }
  }, [activeTab]);

  // Debounced GIF search
  useEffect(() => {
    if (activeTab === 'gif') {
      const timer = setTimeout(() => {
        fetchGifs(gifSearchQuery);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [gifSearchQuery, activeTab]);

  const handleGifSelect = async (gif: any) => {
    // Get the GIF URL - use medium quality for sending
    const gifUrl = gif.media_formats?.gif?.url || gif.media_formats?.mediumgif?.url || gif.media_formats?.tinygif?.url || gif.url;
    const previewUrl = gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url || gifUrl;
    
    if (gifUrl) {
      // Show preview instead of sending immediately
      setSelectedGifSticker({
        url: gifUrl,
        previewUrl: previewUrl,
        type: 'gif'
      });
    }
  };

  const handleSendGifSticker = () => {
    if (!selectedGifSticker) return;
    
    if (onGifStickerSend) {
      onGifStickerSend(selectedGifSticker.url, selectedGifSticker.type, gifStickerCaption || undefined);
    } else if (onEmojiSelect) {
      // Fallback to old method
      const prefix = selectedGifSticker.type === 'gif' ? 'GIF' : 'STICKER';
      onEmojiSelect(`[${prefix}](${selectedGifSticker.url})`);
    }
    
    setSelectedGifSticker(null);
    setGifStickerCaption('');
    onCancel();
  };

  const handleCancelGifStickerPreview = () => {
    setSelectedGifSticker(null);
    setGifStickerCaption('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end md:items-center justify-center">
      {/* Image Editor */}
      {showImageEditor && imageToEdit && (
        <ImageEditor
          imageUrl={imageToEdit.url}
          fileName={imageToEdit.fileName}
          onSave={handleImageEditorSave}
          onCancel={() => {
            setShowImageEditor(false);
            setImageToEdit(null);
            // If no file was selected before, go back to attach tab
            if (!selectedFile) {
              setActiveTab('attach');
            }
          }}
          onSend={handleImageEditorSend}
        />
      )}

      {/* PDF Document Preview Modal */}
      {showDocumentPreview && documentFile && (
        <DocumentPreviewModal
          file={documentFile}
          onClose={() => {
            setShowDocumentPreview(false);
            setDocumentFile(null);
          }}
          onSend={handleDocumentSend}
          uploading={documentUploading}
          uploadProgress={documentUploadProgress}
          uploadPhase={documentUploadPhase}
        />
      )}

      {/* GIF/Sticker Preview Mode - Full screen overlay */}
      {selectedGifSticker && (
        <div className="fixed inset-0 bg-bg-primary z-[110] flex flex-col">
          {/* Header */}
          <div className="flex items-center p-4 safe-area-top">
            <button
              onClick={handleCancelGifStickerPreview}
              className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
            >
              <X size={24} />
            </button>
          </div>

          {/* Preview area - takes remaining space */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
            <div className="max-w-full max-h-full flex items-center justify-center">
              <img
                src={selectedGifSticker.url}
                alt={selectedGifSticker.type === 'gif' ? 'GIF' : 'Sticker'}
                className="max-w-[90%] max-h-[50vh] md:max-h-[60vh] object-contain rounded-lg"
              />
            </div>
          </div>

          {/* Bottom bar with input and send - Mobile optimized */}
          <div className="p-3 md:p-4 border-t border-bg-hover bg-bg-primary safe-area-bottom">
            {/* Mobile layout: thumbnails on top, input below */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
              {/* Thumbnails row */}
              <div className="flex items-center gap-2">
                {/* Thumbnail */}
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-lg overflow-hidden border-2 border-accent flex-shrink-0">
                  <img
                    src={selectedGifSticker.previewUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                
                {/* Add more button */}
                <button
                  onClick={handleCancelGifStickerPreview}
                  className="w-12 h-12 md:w-14 md:h-14 rounded-lg border-2 border-dashed border-bg-hover flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors flex-shrink-0"
                >
                  <Plus size={20} />
                </button>
              </div>

              {/* Input and send row */}
              <div className="flex items-center gap-2 flex-1">
                {/* Caption input */}
                <div className="flex-1">
                  <div className="relative">
                    <input
                      type="text"
                      value={gifStickerCaption}
                      onChange={(e) => setGifStickerCaption(e.target.value)}
                      placeholder="Entrez un message"
                      className="w-full px-4 py-2.5 md:py-3 rounded-full bg-bg-surface text-text-primary placeholder:text-text-secondary outline-none text-sm md:text-base"
                    />
                  </div>
                </div>

                {/* Send button */}
                <button
                  onClick={handleSendGifSticker}
                  className="w-11 h-11 md:w-12 md:h-12 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <Send size={18} className="text-white md:hidden" />
                  <Send size={20} className="text-white hidden md:block" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multiple Images Selection Mode - WhatsApp-like */}
      {multipleSelectionMode && selectedFiles.length > 0 && (
        <div className="fixed inset-0 bg-bg-primary z-[110] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 safe-area-top border-b border-bg-hover">
            <div className="flex items-center gap-3">
              <button
                onClick={handleCancel}
                className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
              >
                <X size={24} />
              </button>
              <span className="text-lg font-medium text-text-primary">
                {selectedFiles.length} sélectionné{selectedFiles.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Main preview area - shows the first/selected image large */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-black/20">
            <div className="max-w-full max-h-full flex items-center justify-center">
              {selectedFiles[0]?.type === 'image' && selectedFiles[0]?.preview && (
                <img
                  src={selectedFiles[0].preview}
                  alt="Preview"
                  className="max-w-[90%] max-h-[50vh] md:max-h-[60vh] object-contain rounded-lg"
                />
              )}
              {selectedFiles[0]?.type === 'video' && selectedFiles[0]?.preview && (
                <video
                  src={selectedFiles[0].preview}
                  controls
                  className="max-w-[90%] max-h-[50vh] md:max-h-[60vh] object-contain rounded-lg"
                />
              )}
            </div>
          </div>

          {/* Bottom bar with thumbnails, input and send */}
          <div className="p-3 md:p-4 border-t border-bg-hover bg-bg-primary safe-area-bottom">
            <div className="flex flex-col gap-3">
              {/* Thumbnails row - scrollable */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {selectedFiles.map((item, index) => (
                  <div key={index} className="relative flex-shrink-0">
                    <div className={`w-14 h-14 md:w-16 md:h-16 rounded-lg overflow-hidden border-2 ${index === 0 ? 'border-accent' : 'border-transparent'}`}>
                      {item.type === 'image' && item.preview && (
                        <img
                          src={item.preview}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                      {item.type === 'video' && item.preview && (
                        <div className="w-full h-full bg-bg-surface flex items-center justify-center">
                          <Video size={20} className="text-text-secondary" />
                        </div>
                      )}
                    </div>
                    {/* Remove button */}
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                
                {/* Add more button */}
                <button
                  onClick={handleAddMoreFiles}
                  className="w-14 h-14 md:w-16 md:h-16 rounded-lg border-2 border-dashed border-bg-hover flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors flex-shrink-0"
                >
                  <Plus size={24} />
                </button>
              </div>

              {/* Input and send row */}
              <div className="flex items-center gap-2">
                {/* Caption input */}
                <div className="flex-1">
                  <input
                    type="text"
                    value={multipleCaption}
                    onChange={(e) => setMultipleCaption(e.target.value)}
                    placeholder="Ajouter une légende..."
                    className="w-full px-4 py-2.5 md:py-3 rounded-full bg-bg-surface text-text-primary placeholder:text-text-secondary outline-none text-sm md:text-base"
                  />
                </div>

                {/* Send button with count badge */}
                <button
                  onClick={handleMultipleUpload}
                  disabled={uploading}
                  className="relative w-12 h-12 md:w-14 md:h-14 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={20} className="text-white animate-spin" />
                  ) : (
                    <>
                      <Send size={20} className="text-white" />
                      {selectedFiles.length > 1 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-accent text-xs font-bold flex items-center justify-center">
                          {selectedFiles.length}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>

              {/* Upload progress */}
              {uploading && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-sm mb-1 text-text-primary">
                    <span>Envoi en cours...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Hidden input for adding more files */}
          <input
            ref={imageInputRef}
            type="file"
            onChange={handleFileSelect}
            accept="image/*"
            multiple
            className="hidden"
          />
        </div>
      )}

      {/* Normal mode */}
      {!selectedGifSticker && !multipleSelectionMode && (
      <div className="bg-bg-secondary backdrop-blur-[30px] border border-glass-border rounded-t-3xl md:rounded-2xl w-full md:max-w-lg md:mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        {/* Camera mode */}
        {cameraMode && (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-bg-hover">
              <h3 className="text-lg font-semibold text-text-primary">
                {cameraMode === 'photo' ? 'Prendre une photo' : 'Enregistrer une vidéo'}
              </h3>
              <button onClick={stopCamera} className="p-2 rounded-full hover:bg-bg-hover text-text-primary">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 relative bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="p-4 flex justify-center">
              <button
                onClick={capturePhoto}
                className="w-16 h-16 rounded-full bg-white border-4 border-accent flex items-center justify-center"
              >
                <div className="w-12 h-12 rounded-full bg-accent" />
              </button>
            </div>
          </div>
        )}

        {/* Normal mode */}
        {!cameraMode && !selectedFile && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-bg-hover">
              <button
                onClick={() => setActiveTab('attach')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'attach' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'
                }`}
              >
                Fichiers
              </button>
              <button
                onClick={() => setActiveTab('emoji')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'emoji' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'
                }`}
              >
                Emojis
              </button>
              <button
                onClick={() => setActiveTab('sticker')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'sticker' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'
                }`}
              >
                Stickers
              </button>
              <button
                onClick={() => setActiveTab('gif')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'gif' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary'
                }`}
              >
                GIFs
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Attach tab */}
              {activeTab === 'attach' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-5 gap-2 sm:gap-3">
                    {/* Camera */}
                    <button
                      onClick={() => {
                        // On mobile, use native camera input
                        // On desktop, use getUserMedia
                        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        if (isMobile) {
                          cameraInputRef.current?.click();
                        } else {
                          startCamera('photo');
                        }
                      }}
                      className="flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
                    >
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center">
                        <Camera size={20} className="text-white sm:hidden" />
                        <Camera size={24} className="text-white hidden sm:block" />
                      </div>
                      <span className="text-[10px] sm:text-xs text-text-primary">Caméra</span>
                    </button>
                    
                    {/* Gallery */}
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
                    >
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center">
                        <Image size={20} className="text-white sm:hidden" />
                        <Image size={24} className="text-white hidden sm:block" />
                      </div>
                      <span className="text-[10px] sm:text-xs text-text-primary">Galerie</span>
                    </button>
                    
                    {/* Video */}
                    <button
                      onClick={() => videoInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
                    >
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center">
                        <Video size={20} className="text-white sm:hidden" />
                        <Video size={24} className="text-white hidden sm:block" />
                      </div>
                      <span className="text-[10px] sm:text-xs text-text-primary">Vidéo</span>
                    </button>
                    
                    {/* Audio */}
                    <button
                      onClick={() => audioInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
                    >
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center">
                        <Music size={20} className="text-white sm:hidden" />
                        <Music size={24} className="text-white hidden sm:block" />
                      </div>
                      <span className="text-[10px] sm:text-xs text-text-primary">Audio</span>
                    </button>
                    
                    {/* Document */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-2 sm:p-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors"
                    >
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center">
                        <FileIcon size={20} className="text-white sm:hidden" />
                        <FileIcon size={24} className="text-white hidden sm:block" />
                      </div>
                      <span className="text-[10px] sm:text-xs text-text-primary">Document</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Emoji tab */}
              {activeTab === 'emoji' && (
                renderEmojiCategories()
              )}

              {/* Sticker tab */}
              {activeTab === 'sticker' && (
                <div className="space-y-4">
                  {/* Search bar */}
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <input
                      type="text"
                      value={stickerSearchQuery}
                      onChange={(e) => setStickerSearchQuery(e.target.value)}
                      placeholder="Rechercher des stickers..."
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-bg-surface text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>

                  {/* Category selector */}
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
                    {stickerCategories.map(renderStickerCategoryButton)}
                  </div>
                  
                  {/* Stickers grid */}
                  {loadingStickers ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={32} className="animate-spin text-accent" />
                    </div>
                  ) : stickers.length > 0 ? (
                    <div className="grid grid-cols-3 gap-3">
                      {stickers.map((sticker) => (
                        <button
                          key={sticker.id}
                          onClick={() => handleStickerSelect(sticker)}
                          className="aspect-square rounded-xl overflow-hidden bg-transparent hover:bg-bg-hover transition-all p-2"
                        >
                          <img
                            src={sticker.media_formats?.tinywebp?.url || sticker.media_formats?.tinygif?.url}
                            alt={sticker.content_description || 'Sticker'}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-text-secondary">
                      <p>Aucun sticker trouvé</p>
                      <p className="text-xs mt-1">Essayez une autre recherche</p>
                    </div>
                  )}
                  
                  {/* Tenor attribution */}
                  <p className="text-xs text-text-secondary text-center">
                    Powered by Tenor
                  </p>
                </div>
              )}

              {/* GIF tab */}
              {activeTab === 'gif' && (
                <div className="space-y-4">
                  {/* Search bar */}
                  <div className="relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <input
                      type="text"
                      value={gifSearchQuery}
                      onChange={(e) => setGifSearchQuery(e.target.value)}
                      placeholder="Rechercher des GIFs..."
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-bg-surface text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  
                  {/* GIFs grid */}
                  {loadingGifs ? (
                    <div className="flex justify-center py-8">
                      <Loader2 size={32} className="animate-spin text-accent" />
                    </div>
                  ) : gifs.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {gifs.map((gif) => (
                        <button
                          key={gif.id}
                          onClick={() => handleGifSelect(gif)}
                          className="aspect-video rounded-xl overflow-hidden bg-bg-surface hover:opacity-80 transition-opacity"
                        >
                          <img
                            src={gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url}
                            alt={gif.content_description || 'GIF'}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-text-secondary">
                      <p>Aucun GIF trouvé</p>
                      <p className="text-xs mt-1">Essayez une autre recherche</p>
                    </div>
                  )}
                  
                  {/* Tenor attribution */}
                  <p className="text-xs text-text-secondary text-center">
                    Powered by Tenor
                  </p>
                </div>
              )}
            </div>

            {/* Hidden inputs */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="*"
              className="hidden"
            />
            <input
              ref={imageInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/*"
              multiple
              className="hidden"
            />
            <input
              ref={videoInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="video/*"
              className="hidden"
            />
            <input
              ref={audioInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="audio/*"
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              onChange={handleCameraCapture}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            {/* Cancel button */}
            <div className="p-4 border-t border-bg-hover">
              <button
                onClick={handleCancel}
                className="w-full py-3 rounded-xl bg-bg-surface hover:bg-bg-hover transition-colors text-text-primary font-medium"
              >
                Annuler
              </button>
            </div>
          </>
        )}

        {/* File preview */}
        {!cameraMode && selectedFile && !showImageEditor && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Aperçu</h3>
              <div className="flex items-center gap-2">
                {/* Edit button for images */}
                {preview && (selectedFileType || getFileType(selectedFile)) === 'image' && (
                  <button
                    onClick={openImageEditor}
                    className="p-2 rounded-full hover:bg-bg-hover transition-colors text-accent"
                    title="Modifier l'image"
                  >
                    <Edit3 size={20} />
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Preview */}
            <div className="mb-4 rounded-xl overflow-hidden bg-bg-surface relative group">
              {preview && (selectedFileType || getFileType(selectedFile)) === 'image' && (
                <>
                  <img src={preview} alt="Preview" className="w-full h-auto max-h-96 object-contain" />
                  {/* Edit overlay on hover */}
                  <div
                    onClick={openImageEditor}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  >
                    <div className="flex flex-col items-center gap-2 text-white">
                      <Edit3 size={32} />
                      <span className="text-sm font-medium">Modifier</span>
                    </div>
                  </div>
                </>
              )}
              {preview && (selectedFileType || getFileType(selectedFile)) === 'video' && (
                <video src={preview} controls className="w-full h-auto max-h-96" />
              )}
              {(selectedFileType || getFileType(selectedFile)) === 'audio' && (
                <AudioPreviewPlayer
                  file={selectedFile}
                  preview={preview}
                />
              )}
              {(selectedFileType || getFileType(selectedFile)) === 'file' && (
                <div className="p-4">
                  {/* WhatsApp-style document preview card */}
                  <div className="bg-bg-hover rounded-xl border border-bg-hover overflow-hidden">
                    <div className="flex items-center gap-4 p-4">
                      {/* Document type icon with colored background */}
                      {(() => {
                        const extension = getFileExtension(selectedFile.name);
                        const { bgColor, icon } = getDocumentIconConfig(extension);
                        return (
                          <div className={`w-16 h-16 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}>
                            {icon}
                          </div>
                        );
                      })()}
                      
                      {/* File details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium text-text-primary truncate">
                          {selectedFile.name}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-text-tertiary mt-1">
                          <span>{formatFileSizeDisplay(selectedFile.size)}</span>
                          <span>•</span>
                          <span className="uppercase">{getFileExtension(selectedFile.name)}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Extension badge at bottom */}
                    <div className="px-4 pb-4">
                      <div className="inline-flex items-center gap-1 px-2 py-1 rounded bg-bg-surface text-xs text-text-secondary">
                        <FileIcon size={12} />
                        <span className="uppercase font-medium">{getFileExtension(selectedFile.name)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {uploading && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2 text-text-primary">
                  <span>
                    {uploadPhase === 'compressing' ? 'Compression en cours...' : 'Envoi en cours...'}
                  </span>
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
                className="flex-1 py-2 rounded-lg bg-accent hover:bg-[#6a6ec8] text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
          </div>
        )}
      </div>
      )}
    </div>
  );
};