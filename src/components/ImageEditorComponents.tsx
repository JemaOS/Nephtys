import React from 'react';
import {
  X, RotateCcw, Crop, Pencil, Download, Send, Undo2, Check,
  Circle, Triangle, Square, Star, Heart, FlipHorizontal
} from 'lucide-react';

export type Tool = 'none' | 'crop' | 'draw' | 'text' | 'shape' | 'blur';
export type Shape = 'rectangle' | 'circle' | 'triangle' | 'star' | 'heart' | 'arrow';

export const COLORS = [
  '#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#00ff88', '#ff0088', '#0088ff', '#88ff00', '#ff8888',
];

export const BRUSH_SIZES = [2, 4, 8, 12, 16, 24, 32];
export const FONT_SIZES = [16, 20, 24, 32, 40, 48, 64, 80];
export const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'Times New Roman', 'Georgia',
  'Courier New', 'Impact', 'Comic Sans MS',
];

interface ImageEditorToolbarProps {
  onCancel: () => void;
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;
  setCropMode: (mode: boolean) => void;
  rotateLeft: () => void;
  setShowBrushSize: (show: boolean) => void;
  toggleFlipH: () => void;
  flipH: boolean;
  hdQuality: boolean;
  setShowQualitySettings: (show: boolean) => void;
  showQualitySettings: boolean;
  downloadImage: () => void;
}

export const ImageEditorToolbar: React.FC<ImageEditorToolbarProps> = ({
  onCancel,
  activeTool,
  setActiveTool,
  setCropMode,
  rotateLeft,
  setShowBrushSize,
  toggleFlipH,
  flipH,
  hdQuality,
  setShowQualitySettings,
  showQualitySettings,
  downloadImage,
}) => (
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
        <div className="w-5 h-5 flex items-center justify-center">
          <span className="text-[10px] font-bold leading-none">HD</span>
        </div>
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
);

interface ImageEditorSecondaryToolbarProps {
  activeTool: Tool;
  selectedColor: string;
  setSelectedColor: (color: string) => void;
  showColorPicker: boolean;
  setShowColorPicker: (show: boolean) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  fontFamily: string;
  setFontFamily: (font: string) => void;
  selectedShape: Shape;
  setSelectedShape: (shape: Shape) => void;
  shapeFilled: boolean;
  setShapeFilled: (filled: boolean) => void;
  undo: () => void;
}

export const ImageEditorSecondaryToolbar: React.FC<ImageEditorSecondaryToolbarProps> = ({
  activeTool,
  selectedColor,
  setSelectedColor,
  showColorPicker,
  setShowColorPicker,
  brushSize,
  setBrushSize,
  fontSize,
  setFontSize,
  fontFamily,
  setFontFamily,
  selectedShape,
  setSelectedShape,
  shapeFilled,
  setShapeFilled,
  undo,
}) => {
  if (activeTool !== 'draw' && activeTool !== 'text' && activeTool !== 'shape') return null;

  return (
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
  );
};

interface ImageEditorFooterProps {
  caption: string;
  setCaption: (caption: string) => void;
  onSend?: (editedImageBlob: Blob, fileName: string, caption: string) => void;
  handleSend: () => void;
}

export const ImageEditorFooter: React.FC<ImageEditorFooterProps> = ({
  caption,
  setCaption,
  onSend,
  handleSend,
}) => (
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
);
