// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  RotateCcw,
  Crop,
  Pencil,
  Download,
  Send,
  Undo2,
  Check,
  Circle,
  Triangle,
  Square,
  Star,
  Heart,
  FlipHorizontal,
} from 'lucide-react';

interface ImageEditorProps {
  imageUrl: string;
  fileName: string;
  onSave: (editedImageBlob: Blob, fileName: string) => void;
  onCancel: () => void;
  onSend?: (editedImageBlob: Blob, fileName: string, caption: string) => void;
}

type Tool = 'none' | 'crop' | 'draw' | 'text' | 'shape' | 'blur';
type Shape = 'rectangle' | 'circle' | 'triangle' | 'star' | 'heart' | 'arrow';

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

const COLORS = [
  '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#00ff88', '#ff0088', '#0088ff', '#88ff00', '#ff8888',
];

const BRUSH_SIZES = [2, 4, 8, 12, 16, 24, 32];

const FONT_SIZES = [16, 20, 24, 32, 40, 48, 64, 80];

const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Impact',
  'Comic Sans MS',
];

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
  const [brushSize, setBrushSize] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [selectedShape, setSelectedShape] = useState<Shape>('rectangle');
  const [shapeFilled, setShapeFilled] = useState(true);
  const [blurIntensity, setBlurIntensity] = useState(10);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hdQuality, setHdQuality] = useState(true);
  const [caption, setCaption] = useState('');
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBrushSize, setShowBrushSize] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [showQualitySettings, setShowQualitySettings] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [newTextInput, setNewTextInput] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [blurStart, setBlurStart] = useState<{ x: number; y: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [draggingItem, setDraggingItem] = useState<{ type: 'text' | 'emoji' | 'shape'; id: string } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      // Calculate canvas size to fit container while maintaining aspect ratio
      const maxWidth = window.innerWidth * 0.95;
      const maxHeight = window.innerHeight * 0.8;
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width;
        height = maxHeight;
      }
      
      setCanvasSize({ width, height });
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

  // Helper functions for drawing shapes
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

  const applyPixelateEffect = (imageData: ImageData, blockSize: number): ImageData => {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    for (let y = 0; y < height; y += blockSize) {
      for (let x = 0; x < width; x += blockSize) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;

        for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
            const i = ((y + dy) * width + (x + dx)) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            a += data[i + 3];
            count++;
          }
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        a = Math.floor(a / count);

        for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
            const i = ((y + dy) * width + (x + dx)) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
          }
        }
      }
    }

    return imageData;
  };

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

  // Mouse/Touch handlers with useCallback to prevent unnecessary re-renders
  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Prevent default to stop scrolling and other browser behaviors
    if ('touches' in e) {
      e.preventDefault();
    }
    
    const coords = getCanvasCoords(e);
    if (!coords) return;

    if (activeTool === 'draw') {
      setIsDrawing(true);
      setCurrentPath({
        points: [coords],
        color: selectedColor,
        width: brushSize,
      });
    } else if (activeTool === 'crop' || cropMode) {
      isCroppingRef.current = true;
      setCropStart(coords);
      setCropEnd(coords);
      lastCropEndRef.current = coords;
    } else if (activeTool === 'blur') {
      setBlurStart(coords);
    } else if (activeTool === 'text') {
      // Add new text at click position
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
    } else if (activeTool === 'shape') {
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
    }
  }, [activeTool, cropMode, selectedColor, brushSize, fontSize, fontFamily, selectedShape, shapeFilled, getCanvasCoords]);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Prevent default to stop scrolling during drag
    if ('touches' in e) {
      e.preventDefault();
    }
    
    const coords = getCanvasCoords(e);
    if (!coords) return;

    if (isDrawing && activeTool === 'draw') {
      setCurrentPath(prev => {
        if (!prev) return null;
        return {
          ...prev,
          points: [...prev.points, coords],
        };
      });
    } else if ((activeTool === 'crop' || cropMode) && isCroppingRef.current) {
      // Use ref to track last position for smoother updates
      lastCropEndRef.current = coords;
      setCropEnd(coords);
    } else if (activeTool === 'blur' && blurStart) {
      // Preview blur region - could add visual feedback here
    }
  }, [activeTool, cropMode, isDrawing, blurStart, getCanvasCoords]);

  const handlePointerUp = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const coords = getCanvasCoords(e) || lastCropEndRef.current;

    if (isDrawing && currentPath) {
      setDrawPaths(prev => [...prev, currentPath]);
      setCurrentPath(null);
      setIsDrawing(false);
    } else if ((activeTool === 'crop' || cropMode) && isCroppingRef.current) {
      isCroppingRef.current = false;
      // Keep the crop selection visible - don't reset cropStart/cropEnd here
    } else if (activeTool === 'blur' && blurStart && coords) {
      const x = Math.min(blurStart.x, coords.x);
      const y = Math.min(blurStart.y, coords.y);
      const width = Math.abs(coords.x - blurStart.x);
      const height = Math.abs(coords.y - blurStart.y);
      
      if (width > 10 && height > 10) {
        setBlurRegions(prev => [...prev, { x, y, width, height, intensity: blurIntensity }]);
      }
      setBlurStart(null);
    }
  }, [activeTool, cropMode, isDrawing, currentPath, blurStart, blurIntensity, getCanvasCoords]);

  // Handle pointer leave - important for when mouse leaves canvas during drag
  const handlePointerLeave = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Don't end crop operation on leave - user might come back
    if (isDrawing && currentPath) {
      setDrawPaths(prev => [...prev, currentPath]);
      setCurrentPath(null);
      setIsDrawing(false);
    }
  }, [isDrawing, currentPath]);

  // Rotation handlers
  const rotateLeft = () => setRotation((r) => (r - 90) % 360);
  const rotateRight = () => setRotation((r) => (r + 90) % 360);

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

  // Clear all edits - wrapped in useCallback
  const clearAll = useCallback(() => {
    setDrawPaths([]);
    setTextOverlays([]);
    setShapeOverlays([]);
    setEmojiOverlays([]);
    setBlurRegions([]);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
  }, []);

  // Download image - wrapped in useCallback
  const downloadImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `edited_${fileName}`;
    link.href = canvas.toDataURL('image/png', hdQuality ? 1 : 0.8);
    link.click();
  }, [fileName, hdQuality]);

  // Save/Send image - wrapped in useCallback
  const handleSave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onSave(blob, `edited_${fileName}`);
        }
      },
      'image/png',
      hdQuality ? 1 : 0.8
    );
  }, [onSave, fileName, hdQuality]);

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
      {/* Header with tools */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-b border-bg-hover safe-area-top">
        {/* Close button */}
        <button
          onClick={onCancel}
          className="p-2 rounded-full hover:bg-bg-hover transition-colors text-text-primary"
        >
          <X size={24} />
        </button>

        {/* Main toolbar */}
        <div className="flex items-center gap-4 overflow-x-auto">
          {/* Crop/Rotate */}
          <button
            onClick={() => {
              setActiveTool(activeTool === 'crop' ? 'none' : 'crop');
              setCropMode(activeTool !== 'crop');
            }}
            className={`p-2 rounded-lg transition-colors ${activeTool === 'crop' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            title="Recadrer"
          >
            <Crop size={20} />
          </button>

          {/* Rotate buttons */}
          <button
            onClick={rotateLeft}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors text-text-primary"
            title="Rotation gauche"
          >
            <RotateCcw size={20} />
          </button>

          {/* Draw */}
          <button
            onClick={() => {
              setActiveTool(activeTool === 'draw' ? 'none' : 'draw');
              setShowBrushSize(activeTool !== 'draw');
            }}
            className={`p-2 rounded-lg transition-colors ${activeTool === 'draw' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            title="Dessiner"
          >
            <Pencil size={20} />
          </button>

          {/* Flip */}
          <button
            onClick={toggleFlipH}
            className={`p-2 rounded-lg transition-colors ${flipH ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            title="Retourner horizontalement"
          >
            <FlipHorizontal size={20} />
          </button>

          {/* HD Quality */}
          <button
            onClick={() => setShowQualitySettings(!showQualitySettings)}
            className={`p-2 rounded-lg transition-colors ${hdQuality ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
            title="Qualité HD"
          >
            <span className="text-xs font-bold">HD</span>
          </button>

          {/* Download button */}
          <button
            onClick={downloadImage}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors text-text-primary"
            title="Télécharger"
          >
            <Download size={20} />
          </button>
        </div>
      </div>

      {/* Secondary toolbar - context sensitive */}
      {(activeTool === 'draw' || activeTool === 'text' || activeTool === 'shape') && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface border-b border-bg-hover overflow-x-auto">
          {/* Color picker */}
          <div className="flex items-center gap-1">
            {COLORS.slice(0, 8).map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${selectedColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: color }}
              />
            ))}
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 border-2 border-transparent"
            />
          </div>

          {/* Brush size (for draw tool) */}
          {activeTool === 'draw' && (
            <div className="flex items-center gap-1 ml-2 border-l border-bg-hover pl-2">
              {BRUSH_SIZES.slice(0, 4).map((size) => (
                <button
                  key={size}
                  onClick={() => setBrushSize(size)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${brushSize === size ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: size, height: size }}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Font size (for text tool) */}
          {activeTool === 'text' && (
            <div className="flex items-center gap-1 ml-2 border-l border-bg-hover pl-2">
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="bg-bg-hover text-text-primary rounded-lg px-2 py-1 text-sm"
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="bg-bg-hover text-text-primary rounded-lg px-2 py-1 text-sm"
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </div>
          )}

          {/* Shape options */}
          {activeTool === 'shape' && (
            <div className="flex items-center gap-1 ml-2 border-l border-bg-hover pl-2">
              <button
                onClick={() => setSelectedShape('rectangle')}
                className={`p-1.5 rounded-lg ${selectedShape === 'rectangle' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
              >
                <Square size={18} />
              </button>
              <button
                onClick={() => setSelectedShape('circle')}
                className={`p-1.5 rounded-lg ${selectedShape === 'circle' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
              >
                <Circle size={18} />
              </button>
              <button
                onClick={() => setSelectedShape('triangle')}
                className={`p-1.5 rounded-lg ${selectedShape === 'triangle' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
              >
                <Triangle size={18} />
              </button>
              <button
                onClick={() => setSelectedShape('star')}
                className={`p-1.5 rounded-lg ${selectedShape === 'star' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
              >
                <Star size={18} />
              </button>
              <button
                onClick={() => setSelectedShape('heart')}
                className={`p-1.5 rounded-lg ${selectedShape === 'heart' ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
              >
                <Heart size={18} />
              </button>
              <button
                onClick={() => setShapeFilled(!shapeFilled)}
                className={`p-1.5 rounded-lg ml-1 ${shapeFilled ? 'bg-accent text-white' : 'hover:bg-bg-hover text-text-primary'}`}
                title={shapeFilled ? 'Rempli' : 'Contour'}
              >
                {shapeFilled ? <Square size={18} className="fill-current" /> : <Square size={18} />}
              </button>
            </div>
          )}

          {/* Undo button */}
          <button
            onClick={undo}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-primary ml-auto"
            title="Annuler"
          >
            <Undo2 size={18} />
          </button>
        </div>
      )}

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
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerLeave}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          onTouchCancel={handlePointerUp}
        >
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full rounded-lg shadow-lg"
            style={{
              cursor: activeTool === 'draw' ? 'crosshair' : activeTool === 'crop' || cropMode ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            }}
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

      {/* Bottom bar with caption and send */}
      <div className="px-4 py-3 border-t border-bg-hover bg-bg-surface safe-area-bottom">
        <div className="flex items-center gap-4">
          {/* Caption input */}
          <div className="flex-1">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Entrez un message"
              className="w-full px-4 h-11 rounded-full bg-bg-hover text-text-primary placeholder:text-text-secondary outline-none"
            />
          </div>

          {/* Send button */}
          {onSend && (
            <button
              onClick={handleSend}
              className="w-11 h-11 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors flex-shrink-0"
            >
              <Send size={20} className="text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};