// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Check,
} from 'lucide-react';
import {
  ImageEditorToolbar,
  ImageEditorSecondaryToolbar,
  ImageEditorFooter,
  Tool,
  Shape,
  COLORS,
  BRUSH_SIZES,
  FONT_SIZES,
  FONT_FAMILIES
} from './ImageEditorComponents';

interface ImageEditorProps {
  imageUrl: string;
  fileName: string;
  onSave: (editedImageBlob: Blob, fileName: string) => void;
  onCancel: () => void;
  onSend?: (editedImageBlob: Blob, fileName: string, caption: string) => void;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  rotation: number;
}

interface DrawPath {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface ShapeOverlay {
  id: string;
  type: Shape;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  filled: boolean;
  rotation: number;
}

interface EmojiOverlay {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
}

interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
}

interface HistoryState {
  imageData: ImageData;
  textOverlays: TextOverlay[];
  shapeOverlays: ShapeOverlay[];
  emojiOverlays: EmojiOverlay[];
  blurRegions: BlurRegion[];
}

// Module-level helper functions for drawing shapes - extracted to reduce component complexity
const drawStar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number, filled: boolean) => {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  if (filled) ctx.fill();
  else ctx.stroke();
};

const drawHeart = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, filled: boolean) => {
  const topCurveHeight = height * 0.3;
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y + topCurveHeight);
  // Left curve
  ctx.bezierCurveTo(
    x + width / 2, y,
    x, y,
    x, y + topCurveHeight
  );
  // Left bottom
  ctx.bezierCurveTo(
    x, y + (height + topCurveHeight) / 2,
    x + width / 2, y + (height + topCurveHeight) / 2,
    x + width / 2, y + height
  );
  // Right bottom
  ctx.bezierCurveTo(
    x + width / 2, y + (height + topCurveHeight) / 2,
    x + width, y + (height + topCurveHeight) / 2,
    x + width, y + topCurveHeight
  );
  // Right curve
  ctx.bezierCurveTo(
    x + width, y,
    x + width / 2, y,
    x + width / 2, y + topCurveHeight
  );
  ctx.closePath();
  if (filled) ctx.fill();
  else ctx.stroke();
};

// Helper function to calculate average color for a block - extracted to reduce complexity
const calculateBlockAverage = (data: Uint8ClampedArray, imgWidth: number, startX: number, startY: number, blockSize: number, imgHeight: number): { r: number; g: number; b: number; a: number; count: number } => {
  let r = 0, g = 0, b = 0, a = 0, count = 0;
  const maxDy = Math.min(blockSize, imgHeight - startY);
  const maxDx = Math.min(blockSize, imgWidth - startX);
  const rowOffset = startY * imgWidth;
  
  for (let dy = 0; dy < maxDy; dy++) {
    const rowIndex = (rowOffset + dy * imgWidth + startX) * 4;
    for (let dx = 0; dx < maxDx; dx++) {
      const i = rowIndex + dx * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      a += data[i + 3];
      count++;
    }
  }
  return { r, g, b, a, count };
};

// Helper function to apply pixelate effect - extracted to reduce complexity
const applyPixelateEffect = (imageData: ImageData, blockSize: number): ImageData => {
  const { data, width, height } = imageData;

  // Process each block
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      // Calculate average color for this block
      const { r, g, b, a, count } = calculateBlockAverage(data, width, x, y, blockSize, height);

      // Calculate average
      const avgR = Math.floor(r / count);
      const avgG = Math.floor(g / count);
      const avgB = Math.floor(b / count);
      const avgA = Math.floor(a / count);

      // Apply average to all pixels in block
      const maxDy = Math.min(blockSize, height - y);
      const maxDx = Math.min(blockSize, width - x);
      for (let dy = 0; dy < maxDy; dy++) {
        for (let dx = 0; dx < maxDx; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          data[i] = avgR;
          data[i + 1] = avgG;
          data[i + 2] = avgB;
          data[i + 3] = avgA;
        }
      }
    }
  }

  return imageData;
};

export const ImageEditor: React.FC<ImageEditorProps> = ({
  imageUrl,
  fileName,
  onSave,
  onCancel,
  onSend,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('none');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawPath | null>(null);
  const [drawPaths, setDrawPaths] = useState<DrawPath[]>([]);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [shapeOverlays, setShapeOverlays] = useState<ShapeOverlay[]>([]);
  const [emojiOverlays, setEmojiOverlays] = useState<EmojiOverlay[]>([]);
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([]);
  const [selectedColor, setSelectedColor] = useState('#ff0000');
  const [brushSize] = useState(4);
  const [fontSize] = useState(32);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [selectedShape, setSelectedShape] = useState<Shape>('rectangle');
  const [shapeFilled, setShapeFilled] = useState(true);
  const [blurIntensity] = useState(10);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hdQuality, setHdQuality] = useState(true);
  const [caption, setCaption] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showQualitySettings, setShowQualitySettings] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [newTextInput, setNewTextInput] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [blurStart, setBlurStart] = useState<{ x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Calculate canvas size to fit container while maintaining aspect ratio
  const calculateCanvasSize = (imgWidth: number, imgHeight: number): { width: number; height: number } => {
    const maxWidth = window.innerWidth * 0.95;
    const maxHeight = window.innerHeight * 0.8;
    let width = imgWidth;
    let height = imgHeight;
    
    if (width > maxWidth) {
      height = (maxWidth / width) * height;
      width = maxWidth;
    }
    if (height > maxHeight) {
      width = (maxHeight / height) * width;
      height = maxHeight;
    }
    
    return { width, height };
  };

  // Load image - extracted to reduce component complexity
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      setCanvasSize(calculateCanvasSize(img.width, img.height));
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw image on canvas - this effect handles the main canvas rendering
  // IMPORTANT: cropMode, cropStart, cropEnd are NOT in dependencies to prevent re-renders during crop selection
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();

    // Apply transformations
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    // Draw image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Restore context state
    ctx.restore();

    // Draw paths
    drawPaths.forEach(path => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach((point, i) => {
        if (i > 0) ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    });

    // Draw current path
    if (currentPath && currentPath.points.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = currentPath.color;
      ctx.lineWidth = currentPath.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(currentPath.points[0].x, currentPath.points[0].y);
      currentPath.points.forEach((point, i) => {
        if (i > 0) ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }

    // Apply blur regions
    blurRegions.forEach(region => {
      const imageData = ctx.getImageData(region.x, region.y, region.width, region.height);
      const blurredData = applyPixelateEffect(imageData, region.intensity);
      ctx.putImageData(blurredData, region.x, region.y);
    });

    // Draw shapes
    shapeOverlays.forEach(shape => {
      ctx.save();
      ctx.translate(shape.x + shape.width / 2, shape.y + shape.height / 2);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.translate(-(shape.x + shape.width / 2), -(shape.y + shape.height / 2));
      
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = 3;

      switch (shape.type) {
        case 'rectangle':
          if (shape.filled) {
            ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
          } else {
            ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
          }
          break;
        case 'circle':
          ctx.beginPath();
          ctx.ellipse(
            shape.x + shape.width / 2,
            shape.y + shape.height / 2,
            shape.width / 2,
            shape.height / 2,
            0, 0, Math.PI * 2
          );
          if (shape.filled) ctx.fill();
          else ctx.stroke();
          break;
        case 'triangle':
          ctx.beginPath();
          ctx.moveTo(shape.x + shape.width / 2, shape.y);
          ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
          ctx.lineTo(shape.x, shape.y + shape.height);
          ctx.closePath();
          if (shape.filled) ctx.fill();
          else ctx.stroke();
          break;
        case 'star':
          drawStar(ctx, shape.x + shape.width / 2, shape.y + shape.height / 2, 5, shape.width / 2, shape.width / 4, shape.filled);
          break;
        case 'heart':
          drawHeart(ctx, shape.x, shape.y, shape.width, shape.height, shape.filled);
          break;
      }
      ctx.restore();
    });

    // Draw text overlays
    textOverlays.forEach(text => {
      ctx.save();
      ctx.translate(text.x, text.y);
      ctx.rotate((text.rotation * Math.PI) / 180);
      ctx.font = `${text.fontSize}px ${text.fontFamily}`;
      ctx.fillStyle = text.color;
      ctx.textBaseline = 'top';
      ctx.fillText(text.text, 0, 0);
      ctx.restore();
    });

    // Draw emoji overlays
    emojiOverlays.forEach(emoji => {
      ctx.save();
      ctx.translate(emoji.x, emoji.y);
      ctx.rotate((emoji.rotation * Math.PI) / 180);
      ctx.font = `${emoji.size}px Arial`;
      ctx.textBaseline = 'top';
      ctx.fillText(emoji.emoji, 0, 0);
      ctx.restore();
    });
  }, [image, canvasSize, rotation, flipH, flipV, zoom, drawPaths, currentPath, textOverlays, shapeOverlays, emojiOverlays, blurRegions]);

  // Separate effect for crop overlay - this only updates the overlay canvas without touching the main canvas
  // This prevents the image from re-rendering/zooming during crop selection
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!canvas || !overlayCanvas) return;

    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!overlayCtx) return;

    // Set overlay canvas size to match main canvas
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;

    // Clear the overlay
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Only draw crop overlay when in crop mode with valid selection
    if (cropMode && cropStart && cropEnd) {
      // Dark overlay
      overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      
      // Clear crop area
      const x = Math.min(cropStart.x, cropEnd.x);
      const y = Math.min(cropStart.y, cropEnd.y);
      const w = Math.abs(cropEnd.x - cropStart.x);
      const h = Math.abs(cropEnd.y - cropStart.y);
      overlayCtx.clearRect(x, y, w, h);
      
      // Crop border
      overlayCtx.strokeStyle = '#787add';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([5, 5]);
      overlayCtx.strokeRect(x, y, w, h);
    }
  }, [cropMode, cropStart, cropEnd, canvasSize]);

  // Get canvas coordinates from mouse/touch event
  const getCanvasCoords = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      // Handle touch events
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('changedTouches' in e && e.changedTouches.length > 0) {
        // For touchend events, use changedTouches
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        return null;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Clamp coordinates to canvas bounds
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));

    return { x, y };
  }, []);

  // Track if we're currently in a crop drag operation
  const isCroppingRef = useRef(false);
  const lastCropEndRef = useRef<{ x: number; y: number } | null>(null);

  // Handle draw tool start - extracted to reduce complexity
  const handleDrawStart = useCallback((coords: { x: number; y: number }) => {
    setIsDrawing(true);
    setCurrentPath({
      points: [coords],
      color: selectedColor,
      width: brushSize,
    });
  }, [selectedColor, brushSize]);

  // Handle crop tool start - extracted to reduce complexity
  const handleCropStart = useCallback((coords: { x: number; y: number }) => {
    isCroppingRef.current = true;
    setCropStart(coords);
    setCropEnd(coords);
    lastCropEndRef.current = coords;
  }, []);

  // Handle blur tool start - extracted to reduce complexity
  const handleBlurStart = useCallback((coords: { x: number; y: number }) => {
    setBlurStart(coords);
  }, []);

  // Handle text tool - add new text overlay - extracted to reduce complexity
  const handleTextTool = useCallback((coords: { x: number; y: number }) => {
    const newText: TextOverlay = {
      id: Date.now().toString(),
      text: 'Texte',
      x: coords.x,
      y: coords.y,
      fontSize,
      color: selectedColor,
      fontFamily,
      rotation: 0,
    };
    setTextOverlays(prev => [...prev, newText]);
    setEditingText(newText.id);
    setNewTextInput('Texte');
  }, [fontSize, selectedColor, fontFamily]);

  // Handle shape tool - add new shape overlay - extracted to reduce complexity
  const handleShapeTool = useCallback((coords: { x: number; y: number }) => {
    const newShape: ShapeOverlay = {
      id: Date.now().toString(),
      type: selectedShape,
      x: coords.x,
      y: coords.y,
      width: 100,
      height: 100,
      color: selectedColor,
      filled: shapeFilled,
      rotation: 0,
    };
    setShapeOverlays(prev => [...prev, newShape]);
  }, [selectedShape, selectedColor, shapeFilled]);

  // Route pointer event to appropriate tool handler - extracted to reduce complexity
  const routeToolHandler = useCallback((coords: { x: number; y: number }) => {
    if (activeTool === 'draw') {
      handleDrawStart(coords);
    } else if (activeTool === 'crop' || cropMode) {
      handleCropStart(coords);
    } else if (activeTool === 'blur') {
      handleBlurStart(coords);
    } else if (activeTool === 'text') {
      handleTextTool(coords);
    } else if (activeTool === 'shape') {
      handleShapeTool(coords);
    }
  }, [activeTool, cropMode, handleDrawStart, handleCropStart, handleBlurStart, handleTextTool, handleShapeTool]);

  // Rotation handlers
  const rotateLeft = () => setRotation((r) => (r - 90) % 360);

  // Flip handlers
  const toggleFlipH = () => setFlipH(!flipH);
  const toggleFlipV = () => setFlipV(!flipV);

  // Zoom handlers
  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.5));

  // Apply crop - wrapped in useCallback
  const applyCrop = useCallback(() => {
    if (!cropStart || !cropEnd || !canvasRef.current || !image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const x = Math.min(cropStart.x, cropEnd.x);
    const y = Math.min(cropStart.y, cropEnd.y);
    const width = Math.abs(cropEnd.x - cropStart.x);
    const height = Math.abs(cropEnd.y - cropStart.y);

    if (width < 10 || height < 10) {
      setCropMode(false);
      setCropStart(null);
      setCropEnd(null);
      isCroppingRef.current = false;
      return;
    }

    // Get the image data from the crop region on the current canvas
    const imageData = ctx.getImageData(x, y, width, height);
    
    // Create a temporary canvas to hold the cropped image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) return;
    
    // Put the cropped image data on the temp canvas
    tempCtx.putImageData(imageData, 0, 0);
    
    // Create a new image from the cropped canvas
    const croppedImage = new Image();
    croppedImage.onload = () => {
      // Update the image state with the cropped image
      setImage(croppedImage);
      
      // Update canvas size to match cropped dimensions
      setCanvasSize({ width, height });
      
      // Reset all transformations since they're now baked into the cropped image
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setZoom(1);
      
      // Clear all overlays since they're now part of the cropped image
      setDrawPaths([]);
      setTextOverlays([]);
      setShapeOverlays([]);
      setEmojiOverlays([]);
      setBlurRegions([]);
      
      // Clear the overlay canvas
      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
        if (overlayCtx) {
          overlayCanvas.width = width;
          overlayCanvas.height = height;
          overlayCtx.clearRect(0, 0, width, height);
        }
      }
      
      // Reset crop state
      setCropMode(false);
      setCropStart(null);
      setCropEnd(null);
      setActiveTool('none');
      isCroppingRef.current = false;
      lastCropEndRef.current = null;
    };
    
    // Convert the temp canvas to a data URL and load it as the new image
    croppedImage.src = tempCanvas.toDataURL('image/png');
  }, [cropStart, cropEnd, image]);

  // Cancel crop - wrapped in useCallback
  const cancelCrop = useCallback(() => {
    setCropMode(false);
    setCropStart(null);
    setCropEnd(null);
    setActiveTool('none');
    isCroppingRef.current = false;
    lastCropEndRef.current = null;
    
    // Clear the overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const overlayCtx = overlayCanvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
  }, []);

  // Undo/Redo - wrapped in useCallback
  const undo = useCallback(() => {
    if (drawPaths.length > 0) {
      setDrawPaths(drawPaths.slice(0, -1));
    } else if (textOverlays.length > 0) {
      setTextOverlays(textOverlays.slice(0, -1));
    } else if (shapeOverlays.length > 0) {
      setShapeOverlays(shapeOverlays.slice(0, -1));
    } else if (emojiOverlays.length > 0) {
      setEmojiOverlays(emojiOverlays.slice(0, -1));
    } else if (blurRegions.length > 0) {
      setBlurRegions(prev => prev.slice(0, -1));
    }
  }, [drawPaths.length, textOverlays.length, shapeOverlays.length, emojiOverlays.length, blurRegions.length]);

  // Download image - wrapped in useCallback
  const downloadImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `edited_${fileName}`;
    link.href = canvas.toDataURL('image/png', hdQuality ? 1 : 0.8);
    link.click();
  }, [fileName, hdQuality]);

  const handleSend = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onSend) return;

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onSend(blob, `edited_${fileName}`, caption);
        }
      },
      'image/png',
      hdQuality ? 1 : 0.8
    );
  }, [onSend, fileName, caption, hdQuality]);

  // Update text content - wrapped in useCallback
  const updateTextContent = useCallback((id: string, newText: string) => {
    setTextOverlays(prev => prev.map(t =>
      t.id === id ? { ...t, text: newText } : t
    ));
  }, []);

  return (
    <div className="fixed inset-0 bg-bg-primary z-[200] flex flex-col">
      <ImageEditorToolbar
        onCancel={onCancel}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        setCropMode={setCropMode}
        rotateLeft={rotateLeft}
        setShowBrushSize={() => {}}
        toggleFlipH={toggleFlipH}
        flipH={flipH}
        hdQuality={hdQuality}
        setShowQualitySettings={setShowQualitySettings}
        showQualitySettings={showQualitySettings}
        downloadImage={downloadImage}
      />

      <ImageEditorSecondaryToolbar
        activeTool={activeTool}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        showColorPicker={showColorPicker}
        setShowColorPicker={setShowColorPicker}
        brushSize={brushSize}
        setBrushSize={() => {}}
        fontSize={fontSize}
        setFontSize={() => {}}
        fontFamily={fontFamily}
        setFontFamily={setFontFamily}
        selectedShape={selectedShape}
        setSelectedShape={setSelectedShape}
        shapeFilled={shapeFilled}
        setShapeFilled={setShapeFilled}
        undo={undo}
      />

      {/* Crop toolbar */}
      {cropMode && (
        <div className="flex items-center justify-center gap-4 px-4 py-2 bg-bg-surface border-b border-bg-hover">
          <button
            onClick={cancelCrop}
            className="px-4 py-2 rounded-lg bg-bg-hover text-text-primary hover:bg-bg-surface transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={applyCrop}
            className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-[#5a5ec9] transition-colors flex items-center gap-2"
          >
            <Check size={18} />
            Appliquer
          </button>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-black/20"
      >
        <div
          className="relative select-none"
          style={{ touchAction: 'none' }}
        >
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full rounded-lg shadow-lg"
            style={{
              cursor: activeTool === 'draw' ? 'crosshair' : (activeTool === 'crop' || cropMode) ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            }}
            aria-label="Éditeur d'image"
          />
          <canvas
            ref={overlayCanvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ touchAction: 'none' }}
          />
        </div>
      </div>

      {/* Quality settings popup */}
      {showQualitySettings && (
        <div className="absolute top-20 right-4 bg-bg-surface rounded-2xl shadow-2xl p-4 z-50 min-w-[200px] border border-bg-hover">
          <h4 className="text-sm font-medium text-text-primary mb-3">Qualité d'image</h4>
          <div className="space-y-2">
            <button
              onClick={() => { setHdQuality(true); setShowQualitySettings(false); }}
              className={`w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${hdQuality ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            >
              HD (Haute qualité)
            </button>
            <button
              onClick={() => { setHdQuality(false); setShowQualitySettings(false); }}
              className={`w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${!hdQuality ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            >
              Standard (Fichier plus petit)
            </button>
          </div>
        </div>
      )}

      {/* Text editing modal */}
      {editingText && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-surface rounded-2xl p-4 w-[90%] max-w-md">
            <h4 className="text-lg font-medium text-text-primary mb-3">Modifier le texte</h4>
            <input
              type="text"
              value={newTextInput}
              onChange={(e) => setNewTextInput(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-bg-hover text-text-primary outline-none mb-4"
              autoFocus
              aria-label="Texte à modifier"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingText(null);
                  setTextOverlays(textOverlays.filter(t => t.id !== editingText));
                }}
                className="flex-1 py-2 rounded-lg bg-bg-hover text-text-primary"
              >
                Supprimer
              </button>
              <button
                onClick={() => {
                  updateTextContent(editingText, newTextInput);
                  setEditingText(null);
                }}
                className="flex-1 py-2 rounded-lg bg-accent text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageEditorFooter
        caption={caption}
        setCaption={setCaption}
        onSend={onSend}
        handleSend={handleSend}
      />
    </div>
  );
};