// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Image, Video, File as FileIcon, X, Loader2, Camera, Sticker, FileImage, Search, Plus, Send, Edit3, FileText, FileSpreadsheet, FileArchive, Download, Music, Play, Pause } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ImageEditor } from './ImageEditor';
import { processImageForUpload, ProcessedImage } from '@/lib/imageUtils';
import { compressVideo } from '@/lib/videoCompression';
import { DocumentPreviewModal, generatePDFThumbnail } from './DocumentPreview';
import { AudioPreviewPlayer, EmojiPicker, StickerPicker, formatFileSizeDisplay } from './MediaUploaderComponents';

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

// Helper function to get folder name based on file type - extracted to avoid ternary nest
const getFolderForFileType = (type: 'image' | 'video' | 'file' | 'audio'): string => {
  if (type === 'image') return 'images';
  if (type === 'video') return 'videos';
  return 'documents';
}

// Module-level helper: Check if video needs compression
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



// Tenor GIF API - use environment variable for security
const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY || '';
const FALLBACK_TENOR_KEY = 'LIVDSRZULELA'; // Public test key (V1 API)
const TENOR_CLIENT_KEY = 'nephtys_app';

// Helper to normalize Tenor API response (V1 -> V2 format)
const normalizeTenorResult = (result: any) => {
  if (result.media_formats) {
    // V2 format
    return result;
  } else if (result.media && result.media.length > 0) {
    // V1 format -> convert to V2-like structure for compatibility
    const media = result.media[0];
    return {
      ...result,
      media_formats: {
        gif: media.gif,
        tinygif: media.tinygif,
        mediumgif: media.mediumgif,
        nanogif: media.nanogif,
        webp: media.webp,
        tinywebp: media.tinywebp,
      }
    };
  }
  return result;
};

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
      const shouldCompress = await checkVideoNeedsCompression(preview);
      if (shouldCompress) {
        console.log(`Compressing video ${file.name}...`);
        const compressedBlob = await compressVideo(file);
        fileToUpload = compressedBlob;
      }
    }
    
    const folder = getFolderForFileType(type);
    const fileName = `${userId}/${folder}/${Date.now()}_${file.name.replaceAll(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { error } = await supabase.storage
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

    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);
    const publicUrl = urlData?.publicUrl ?? '';

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

  // Handle multiple file upload (WhatsApp-like)
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
        const uploadedFile = await processSingleFile(
          selectedFiles[i],
          user.id,
          totalFiles,
          uploadedFiles,
          i
        );
        
        if (uploadedFile) {
          uploadedFiles.push(uploadedFile);
        }
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
    
    const folder = getFolderForFileType(type);
    const fileName = `${userId}/${folder}/${Date.now()}_${file.name.replaceAll(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { error } = await supabase.storage
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

    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(fileName);
    const publicUrl = urlData?.publicUrl ?? '';

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
    setUploadProgress(Math.round(((index + 1)) * 100));
    
    return uploadedFile;
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

      const uploadedFile = await processFileForUpload(
        { file: selectedFile, preview: preview || '', type: fileType },
        user.id,
        0
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (uploadedFile) {
        // Call completion callback
        onUploadComplete(
          uploadedFile.url,
          uploadedFile.type,
          uploadedFile.fileName,
          uploadedFile.fileSize,
          uploadedFile.width,
          uploadedFile.height,
          uploadedFile.thumbnail,
          audioDuration
        );
      }
      
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
          const thumbnailFileName = `${user.id}/thumbnails/${Date.now()}_${documentFile.name.replaceAll(/\.[^/.]+$/, '')}_thumb.jpg`;

          const { error: thumbError } = await supabase.storage
            .from('media')
            .upload(thumbnailFileName, thumbnailBlob, {
              cacheControl: '3600',
              upsert: false,
              contentType: 'image/jpeg',
            });

          if (!thumbError) {
            const { data: thumbData } = supabase.storage
              .from('media')
              .getPublicUrl(thumbnailFileName);
            thumbnailUrl = thumbData?.publicUrl;
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
      const fileName = `${user.id}/${folder}/${Date.now()}_${documentFile.name.replaceAll(/[^a-zA-Z0-9.-]/g, '_')}`;

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

      const { error } = await supabase.storage
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
      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName);
      const publicUrl = urlData?.publicUrl ?? '';

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
      const uploadFileName = `${user.id}/${folder}/${Date.now()}_${fileName.replaceAll(/[^a-zA-Z0-9.-]/g, '_')}`;

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

      const { error } = await supabase.storage
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

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(uploadFileName);
      const publicUrl = urlData?.publicUrl ?? '';

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
      let endpoint;
