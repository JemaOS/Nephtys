// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState, useEffect } from 'react';
import { Image, Video, File as FileIcon, X, Loader2, Camera, Sticker, FileImage, Search, Plus, Send, FileText, FileSpreadsheet, FileArchive, Music } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ImageEditor } from './ImageEditor';
import { processImageForUpload, ProcessedImage } from '@/lib/imageUtils';
import { compressVideo } from '@/lib/videoCompression';
import { DocumentPreviewModal, generatePDFThumbnail } from './DocumentPreview';
import { AudioPreviewPlayer, EmojiPicker, StickerPicker } from './MediaUploaderComponents';

// Helper function to get file extension
const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() || '' : '';
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

// Type for media file types
export type MediaFileType = 'image' | 'video' | 'file' | 'audio';

// Type alias for file type categories (used in getFileType return type)
type FileTypeCategory = 'image' | 'video' | 'file' | 'audio';

// Helper function to get folder name based on file type - extracted to avoid ternary nest
const getFolderForFileType = (type: MediaFileType): string => {
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
  type: MediaFileType;
  fileName: string;
  fileSize: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  duration?: number;
}

// Interface for upload complete parameters - kept for backwards compatibility
export interface UploadCompleteParams {
  url: string;
  type: MediaFileType;
  fileName: string;
  fileSize: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  duration?: number;
}

interface MediaUploaderProps {
  onMediaSelect: (selectedFile: globalThis.File, type: MediaFileType) => void;
  onUploadComplete: (url: string, type: MediaFileType, fileName: string, fileSize: number, width?: number, height?: number, thumbnail?: string, duration?: number) => void;
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
  type FileSelection = { file: File; preview: string; type: MediaFileType };
  const [selectedFiles, setSelectedFiles] = useState<FileSelection[]>([]);
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getFileType = (file: File): FileTypeCategory => {
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
    
    for (const file of files) {
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
  interface ProcessSingleFileParams {
    fileItem: { file: File; preview: string; type: 'image' | 'video' | 'file' | 'audio' };
    userId: string;
    totalFiles: number;
    uploadedFiles: UploadedFileData[];
    index: number;
  }

  const processSingleFile = async (params: ProcessSingleFileParams): Promise<UploadedFileData | null> => {
    const { fileItem, userId, totalFiles, index } = params;
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
        const uploadedFile = await processSingleFile({
          fileItem: selectedFiles[i],
          userId: user.id,
          totalFiles,
          uploadedFiles,
          index: i
        });
        
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

  // Note: startCamera and capturePhoto are available for future camera integration
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setCameraMode(null);
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
      let endpoint = '';
      
      // Determine endpoint based on API key availability
      if (TENOR_API_KEY) {
        endpoint = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&searchfilter=sticker&limit=20`;
      } else {
        endpoint = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${FALLBACK_TENOR_KEY}&searchfilter=sticker&limit=20`;
      }
      
      const response = await fetch(endpoint);
      const data = await response.json();
      
      if (data.results) {
        setStickers(data.results.map(normalizeTenorResult));
      }
    } catch (err) {
      console.warn('Failed to fetch stickers:', err);
      setStickers([]);
    } finally {
      setLoadingStickers(false);
    }
  };

  // Fetch GIFs from Tenor API
  const fetchGifs = async (query: string = 'trending') => {
    setLoadingGifs(true);
    try {
      let endpoint = '';
      
      // Determine endpoint based on API key availability
      if (TENOR_API_KEY) {
        endpoint = query === 'trending'
          ? `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20`
          : `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20`;
      } else {
        endpoint = query === 'trending'
          ? `https://g.tenor.com/v1/trending?key=${FALLBACK_TENOR_KEY}&limit=20`
          : `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${FALLBACK_TENOR_KEY}&limit=20`;
      }
      
      const response = await fetch(endpoint);
      const data = await response.json();
      
      if (data.results) {
        setGifs(data.results.map(normalizeTenorResult));
      }
    } catch (err) {
      console.warn('Failed to fetch GIFs:', err);
      setGifs([]);
    } finally {
      setLoadingGifs(false);
    }
  };

  // Handle GIF/sticker selection
  const handleGifStickerSelect = (item: any, type: 'gif' | 'sticker') => {
    const formats = item.media_formats;
    let url = '';
    let previewUrl = '';
    
    if (type === 'sticker') {
      // For stickers, prefer webp formats
      url = formats.webp?.url || formats.gif?.url || formats.tinygif?.url || '';
      previewUrl = formats.tinywebp?.url || formats.nanogif?.url || formats.tinygif?.url || url;
    } else {
      // For GIFs, prefer smaller formats for preview
      url = formats.gif?.url || formats.mediumgif?.url || formats.tinygif?.url || '';
      previewUrl = formats.tinygif?.url || formats.nanogif?.url || url;
    }
    
    if (url) {
      setSelectedGifSticker({ url, previewUrl, type });
    }
  };

  // Note: openImageEditor is available for direct image editing integration
  // Handle send GIF/sticker with caption
  const handleGifStickerSend = () => {
    if (selectedGifSticker && onGifStickerSend) {
      onGifStickerSend(selectedGifSticker.url, selectedGifSticker.type, gifStickerCaption);
      setSelectedGifSticker(null);
      setGifStickerCaption('');
      onCancel();
    }
  };

  // Handle GIF/sticker cancel
  const handleGifStickerCancel = () => {
    setSelectedGifSticker(null);
    setGifStickerCaption('');
  };

  // Load initial GIFs on mount
  useEffect(() => {
    if (activeTab !== 'gif') return;
    fetchGifs('trending');
  }, [activeTab]);

  // Load stickers when category changes
  useEffect(() => {
    if (activeTab === 'sticker') {
      fetchStickers(selectedStickerCategory);
    }
  }, [activeTab, selectedStickerCategory]);

  // Handle GIF search
  const handleGifSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (gifSearchQuery.trim()) {
      fetchGifs(gifSearchQuery.trim());
    }
  };

// Handle sticker search - placeholder for future text search functionality
  // Currently stickers are fetched by category selection (see handleStickerSelect in StickerPicker)

  // Render the component
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-surface w-full sm:w-[480px] sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-bg-hover">
          <h3 className="text-lg font-semibold text-text-primary">
            {activeTab === 'attach' && 'Joindre un fichier'}
            {activeTab === 'emoji' && 'Emoji'}
            {activeTab === 'sticker' && 'Stickers'}
            {activeTab === 'gif' && 'GIFs'}
          </h3>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-bg-hover rounded-full transition-colors"
          >
            <X size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-bg-hover">
          <button
            onClick={() => setActiveTab('attach')}
            className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
              activeTab === 'attach' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Plus size={18} />
            Fichier
          </button>
          <button
            onClick={() => setActiveTab('emoji')}
            className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
              activeTab === 'emoji' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Sticker size={18} />
            Emoji
          </button>
          <button
            onClick={() => setActiveTab('sticker')}
            className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
              activeTab === 'sticker' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FileImage size={18} />
            Stickers
          </button>
          <button
            onClick={() => setActiveTab('gif')}
            className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
              activeTab === 'gif' ? 'text-accent border-b-2 border-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Video size={18} />
            GIFs
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Attach Tab */}
          {activeTab === 'attach' && !selectedFile && !multipleSelectionMode && !showImageEditor && !showDocumentPreview && !cameraMode && (
            <div className="grid grid-cols-3 gap-4">
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-hover hover:bg-bg-primary transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-[#7578db]/20 flex items-center justify-center">
                  <Image size={24} className="text-[#7578db]" />
                </div>
                <span className="text-sm text-text-secondary">Galerie</span>
              </button>
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-hover hover:bg-bg-primary transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-[#7578db]/20 flex items-center justify-center">
                  <Camera size={24} className="text-[#7578db]" />
                </div>
                <span className="text-sm text-text-secondary">Caméra</span>
              </button>
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-hover hover:bg-bg-primary transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-[#7578db]/20 flex items-center justify-center">
                  <Video size={24} className="text-[#7578db]" />
                </div>
                <span className="text-sm text-text-secondary">Vidéo</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-hover hover:bg-bg-primary transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-[#7578db]/20 flex items-center justify-center">
                  <FileIcon size={24} className="text-[#7578db]" />
                </div>
                <span className="text-sm text-text-secondary">Document</span>
              </button>
              <button
                onClick={() => audioInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-hover hover:bg-bg-primary transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-[#7578db]/20 flex items-center justify-center">
                  <Music size={24} className="text-[#7578db]" />
                </div>
                <span className="text-sm text-text-secondary">Audio</span>
              </button>
            </div>
          )}

          {/* Hidden Inputs */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            onChange={handleCameraCapture}
            className="hidden"
          />

          {/* Emoji Tab */}
          {activeTab === 'emoji' && (
            <EmojiPicker onEmojiSelect={handleEmojiClick} onCancel={handleCancel} />
          )}

          {/* Sticker Tab */}
          {activeTab === 'sticker' && (
            <StickerPicker
              stickerCategories={stickerCategories}
              selectedStickerCategory={selectedStickerCategory}
              setSelectedStickerCategory={setSelectedStickerCategory}
              stickerSearchQuery={stickerSearchQuery}
              setStickerSearchQuery={setStickerSearchQuery}
              loadingStickers={loadingStickers}
              stickers={stickers}
              handleStickerSelect={(sticker) => handleGifStickerSelect(sticker, 'sticker')}
            />
          )}

          {/* GIF Tab */}
          {activeTab === 'gif' && (
            <div className="space-y-4">
              {/* Search */}
              <form onSubmit={handleGifSearch} className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    value={gifSearchQuery}
                    onChange={(e) => setGifSearchQuery(e.target.value)}
                    placeholder="Rechercher des GIFs..."
                    className="w-full pl-9 pr-4 py-2 bg-bg-hover text-text-primary rounded-xl text-sm outline-none placeholder:text-text-secondary"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-[#5a5ec9] transition-colors"
                >
                  <Search size={16} />
                </button>
              </form>

              {/* GIF Grid */}
              {loadingGifs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={32} className="text-accent animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {gifs.map((gif) => (
                    <button
                      key={gif.id}
                      onClick={() => handleGifStickerSelect(gif, 'gif')}
                      className="relative aspect-video rounded-lg overflow-hidden bg-bg-hover hover:ring-2 hover:ring-accent transition-all"
                    >
                      <img
                        src={gif.media_formats?.nanogif?.url || gif.media_formats?.tinygif?.url}
                        alt={gif.content_description || 'GIF'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected File Preview */}
          {selectedFile && !showImageEditor && !showDocumentPreview && (
            <div className="space-y-4">
              <div className="relative aspect-video bg-bg-hover rounded-xl overflow-hidden">
                {selectedFileType === 'image' && preview && (
                  <img src={preview} alt="Preview" className="w-full h-full object-contain" />
                )}
                {selectedFileType === 'video' && preview && (
                  <video src={preview} className="w-full h-full object-contain" controls>
                    <track kind="captions" src="" label="No captions" />
                  </video>
                )}
                {selectedFileType === 'audio' && (
                  <AudioPreviewPlayer file={selectedFile} preview={preview} />
                )}
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setSelectedFileType(null);
                    setPreview(null);
                  }}
                  className="absolute top-2 right-2 p-1 bg-black/50 rounded-full hover:bg-black/70 transition-colors"
                >
                  <X size={16} className="text-white" />
                </button>
              </div>

              {/* Upload Progress */}
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">
                      {uploadPhase === 'compressing' && 'Compression...'}
                      {uploadPhase === 'uploading' && 'Upload...'}
                    </span>
                    <span className="text-accent font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={uploading}
                  className="flex-1 py-2 px-4 bg-bg-hover text-text-secondary rounded-xl font-medium hover:bg-bg-primary transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 py-2 px-4 bg-accent text-white rounded-xl font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                  Envoyer
                </button>
              </div>
            </div>
          )}

          {/* Multiple Files Selection */}
          {multipleSelectionMode && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div key={`${file.file.name}-${index}`} className="relative aspect-square bg-bg-hover rounded-lg overflow-hidden">
                    {file.type === 'image' && file.preview && (
                      <img src={file.preview} alt={file.file.name} className="w-full h-full object-cover" />
                    )}
                    {file.type === 'video' && file.preview && (
                      <video src={file.preview} className="w-full h-full object-cover">
                        <track kind="captions" src="" label="No captions" />
                      </video>
                    )}
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="absolute top-1 right-1 p-1 bg-black/50 rounded-full hover:bg-black/70 transition-colors"
                    >
                      <X size={12} className="text-white" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={handleAddMoreFiles}
                  className="aspect-square bg-bg-hover rounded-lg flex items-center justify-center hover:bg-bg-primary transition-colors"
                >
                  <Plus size={24} className="text-text-secondary" />
                </button>
              </div>

              {/* Caption Input */}
              <input
                type="text"
                value={multipleCaption}
                onChange={(e) => setMultipleCaption(e.target.value)}
                placeholder="Ajouter une légende..."
                className="w-full px-4 py-2 bg-bg-hover text-text-primary rounded-xl text-sm outline-none placeholder:text-text-secondary"
              />

              {/* Upload Progress */}
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Upload...</span>
                    <span className="text-accent font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={uploading}
                  className="flex-1 py-2 px-4 bg-bg-hover text-text-secondary rounded-xl font-medium hover:bg-bg-primary transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleMultipleUpload}
                  disabled={uploading}
                  className="flex-1 py-2 px-4 bg-accent text-white rounded-xl font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                  Envoyer ({selectedFiles.length})
                </button>
              </div>
            </div>
          )}

          {/* Image Editor */}
          {showImageEditor && imageToEdit && (
            <ImageEditor
              imageUrl={imageToEdit.url}
              fileName={imageToEdit.fileName}
              onSave={handleImageEditorSave}
              onSend={handleImageEditorSend}
              onCancel={() => {
                setShowImageEditor(false);
                setImageToEdit(null);
              }}
            />
          )}

          {/* Document Preview */}
          {showDocumentPreview && documentFile && (
            <DocumentPreviewModal
              file={documentFile}
              onSend={handleDocumentSend}
              onClose={() => {
                setShowDocumentPreview(false);
                setDocumentFile(null);
              }}
              uploading={documentUploading}
              uploadPhase={documentUploadPhase}
              uploadProgress={documentUploadProgress}
            />
          )}

          {/* GIF/Sticker Preview */}
          {selectedGifSticker && (
            <div className="space-y-4">
              <div className="relative aspect-video bg-bg-hover rounded-xl overflow-hidden flex items-center justify-center">
                {selectedGifSticker.type === 'gif' ? (
                  <img
                    src={selectedGifSticker.previewUrl}
                    alt="GIF Preview"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <img
                    src={selectedGifSticker.previewUrl}
                    alt="Sticker Preview"
                    className="max-w-full max-h-full object-contain"
                  />
                )}
              </div>

              {/* Caption Input */}
              <input
                type="text"
                value={gifStickerCaption}
                onChange={(e) => setGifStickerCaption(e.target.value)}
                placeholder="Ajouter une légende..."
                className="w-full px-4 py-2 bg-bg-hover text-text-primary rounded-xl text-sm outline-none placeholder:text-text-secondary"
              />

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleGifStickerCancel}
                  className="flex-1 py-2 px-4 bg-bg-hover text-text-secondary rounded-xl font-medium hover:bg-bg-primary transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleGifStickerSend}
                  className="flex-1 py-2 px-4 bg-accent text-white rounded-xl font-medium hover:bg-[#5a5ec9] transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={18} />
                  Envoyer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Canvas for camera capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
