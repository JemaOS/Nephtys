import { 
  Conversion, 
  BlobSource, 
  BufferTarget, 
  Mp4OutputFormat, 
  Input, 
  Output,
  ALL_FORMATS
} from 'mediabunny';

/**
 * Compresses a video file to 720p using Mediabunny.
 * 
 * @param file The input video file
 * @param onProgress Optional callback for progress (0-100)
 * @returns A Promise resolving to the compressed video Blob
 */
export const compressVideo = async (
  file: File,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  console.log('[VideoCompression] Starting compression for:', file.name);

  try {
    // Create Input
    const source = new BlobSource(file);
    const input = new Input({ source, formats: ALL_FORMATS });

    // Create Output
    const target = new BufferTarget();
    const format = new Mp4OutputFormat();
    const output = new Output({ target, format });

    // Configure Conversion
    // Target 720p (1280x720)
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        height: 720,
        fit: 'contain', // Maintain aspect ratio
        codec: 'avc',   // H.264
        bitrate: 2_500_000, // 2.5 Mbps
      },
    });

    conversion.onProgress = (progress) => {
      if (onProgress) {
        onProgress(Math.round(progress * 100));
      }
    };

    // Execute
    await conversion.execute();

    // Get Result
    if (!target.buffer) {
      throw new Error('Compression failed: No output buffer');
    }

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    console.log('[VideoCompression] Compression complete. New size:', blob.size);
    
    return blob;
  } catch (error) {
    console.error('[VideoCompression] Error:', error);
    throw error;
  }
};
