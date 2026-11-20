import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Check,
  X,
  RefreshCw,
  Sliders,
  Image as ImageIcon,
  AlertCircle
} from 'lucide-react';

interface AvatarCropperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (croppedDataUrl: string) => Promise<void> | void;
  currentAvatarUrl?: string;
  title?: string;
  subtitle?: string;
  cropShape?: 'round' | 'rect';
}

export const AvatarCropperModal: React.FC<AvatarCropperModalProps> = ({
  isOpen,
  onClose,
  onSave,
  currentAvatarUrl,
  title,
  subtitle,
  cropShape = 'round'
}) => {
  const [mode, setMode] = useState<'SELECT' | 'CAMERA' | 'CROP'>('SELECT');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setMode('SELECT');
      setImageSrc(null);
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setCameraError(null);
    } else {
      stopCamera();
    }
  }, [isOpen]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // 1. Handling File Upload from Device
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Mohon pilih file gambar yang valid (JPG, PNG, atau WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        loadImage(event.target.result);
      }
    };
    reader.readAsDataURL(file);
    // Reset file input so same file can be chosen again if needed
    e.target.value = '';
  };

  // 2. Handling Live Camera Stream
  const startCamera = async () => {
    setCameraError(null);
    setMode('CAMERA');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError(
        'Kamera tidak dapat diakses. Pastikan izin kamera aktif pada peramban Anda, atau unggah foto langsung dari file galeri.'
      );
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally for front camera mirroring like a mirror/FB
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    stopCamera();
    loadImage(dataUrl);
  };

  // 3. Load Image into Canvas State
  const loadImage = (src: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageObjRef.current = img;
      setImageSrc(src);
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setMode('CROP');
    };
    img.src = src;
  };

  // Render crop canvas preview
  const drawCropPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width; // 360x360 internal canvas
    ctx.clearRect(0, 0, size, size);

    // Save context
    ctx.save();

    // Move to center of canvas for rotation and scaling
    ctx.translate(size / 2 + pan.x, size / 2 + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);

    // Compute aspect-fit dimensions
    let drawWidth = size;
    let drawHeight = size;
    const imgAspect = img.width / img.height;

    if (imgAspect > 1) {
      drawWidth = size * imgAspect;
      drawHeight = size;
    } else {
      drawWidth = size;
      drawHeight = size / imgAspect;
    }

    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

    ctx.restore();

    // Draw circular or rounded rectangular overlay mask
    const cropRadius = (size * 0.86) / 2;
    const centerX = size / 2;
    const centerY = size / 2;
    const x0 = centerX - cropRadius;
    const y0 = centerY - cropRadius;
    const d = cropRadius * 2;
    const r = 16;

    // Dark semi-transparent vignette outside crop boundary
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);

    if (cropShape === 'rect') {
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x0 + d - r, y0);
      ctx.arcTo(x0 + d, y0, x0 + d, y0 + r, r);
      ctx.lineTo(x0 + d, y0 + d - r);
      ctx.arcTo(x0 + d, y0 + d, x0 + d - r, y0 + d, r);
      ctx.lineTo(x0 + r, y0 + d);
      ctx.arcTo(x0, y0 + d, x0, y0 + d - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
    } else {
      ctx.arc(centerX, centerY, cropRadius, 0, Math.PI * 2, true);
    }

    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fill('evenodd');

    // Crop guide border line
    ctx.beginPath();
    if (cropShape === 'rect') {
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x0 + d - r, y0);
      ctx.arcTo(x0 + d, y0, x0 + d, y0 + r, r);
      ctx.lineTo(x0 + d, y0 + d - r);
      ctx.arcTo(x0 + d, y0 + d, x0 + d - r, y0 + d, r);
      ctx.lineTo(x0 + r, y0 + d);
      ctx.arcTo(x0, y0 + d, x0, y0 + d - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
    } else {
      ctx.arc(centerX, centerY, cropRadius, 0, Math.PI * 2);
    }
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 1:1 grid lines inside crop area (rule of thirds)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    // vertical
    ctx.moveTo(x0 + d / 3, y0 + 4);
    ctx.lineTo(x0 + d / 3, y0 + d - 4);
    ctx.moveTo(x0 + (2 * d) / 3, y0 + 4);
    ctx.lineTo(x0 + (2 * d) / 3, y0 + d - 4);
    // horizontal
    ctx.moveTo(x0 + 4, y0 + d / 3);
    ctx.lineTo(x0 + d - 4, y0 + d / 3);
    ctx.moveTo(x0 + 4, y0 + (2 * d) / 3);
    ctx.lineTo(x0 + d - 4, y0 + (2 * d) / 3);
    ctx.stroke();

    ctx.restore();
  }, [pan, zoom, rotation, cropShape]);

  useEffect(() => {
    if (mode === 'CROP') {
      drawCropPreview();
    }
  }, [mode, drawCropPreview]);

  // Dragging / Pan listeners
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch support for mobile / tablet
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setPan({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Rotate 90 degrees clockwise
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Reset adjustments
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  // 4. Export Final 1:1 512x512 Avatar
  const handleApplyCrop = async () => {
    const img = imageObjRef.current;
    if (!img) return;

    setIsProcessing(true);
    try {
      // Create high-res 512x512 output canvas
      const outputCanvas = document.createElement('canvas');
      const outSize = 512;
      outputCanvas.width = outSize;
      outputCanvas.height = outSize;
      const ctx = outputCanvas.getContext('2d');
      if (!ctx) return;

      // Scale factor from preview canvas (360px with cropRadius 0.86) to 512px
      const previewSize = 360;
      const previewCropDiameter = previewSize * 0.86;
      const scaleMultiplier = outSize / previewCropDiameter;

      ctx.save();
      // Center of output canvas
      ctx.translate(outSize / 2, outSize / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(zoom * scaleMultiplier, zoom * scaleMultiplier);

      // Translate pan proportional to scaling
      ctx.translate(pan.x / (previewCropDiameter / outSize), pan.y / (previewCropDiameter / outSize));

      let drawWidth = previewSize;
      let drawHeight = previewSize;
      const imgAspect = img.width / img.height;

      if (imgAspect > 1) {
        drawWidth = previewSize * imgAspect;
        drawHeight = previewSize;
      } else {
        drawWidth = previewSize;
        drawHeight = previewSize / imgAspect;
      }

      ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();

      // Export as optimized JPEG
      const finalDataUrl = outputCanvas.toDataURL('image/jpeg', 0.9);
      await onSave(finalDataUrl);
      onClose();
    } catch (err) {
      console.error('Failed to crop and save avatar:', err);
      alert('Terjadi kesalahan saat memproses foto.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {mode === 'SELECT'
                  ? (title || (cropShape === 'rect' ? 'Unggah Logo Perusahaan' : 'Unggah Foto Profil'))
                  : mode === 'CAMERA'
                  ? (cropShape === 'rect' ? 'Ambil Foto Stempel / Logo' : 'Ambil Foto dengan Kamera')
                  : (cropShape === 'rect' ? 'Atur & Potong Logo (1:1)' : 'Atur & Potong Foto (1:1)')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {mode === 'SELECT'
                  ? (subtitle || (cropShape === 'rect' ? 'Pilih file logo resmi tenant atau jepret langsung dari kamera' : 'Pilih metode untuk mengambil atau mengunggah foto profil'))
                  : mode === 'CAMERA'
                  ? (cropShape === 'rect' ? 'Posisikan logo atau berkas tepat di tengah bingkai' : 'Posisikan wajah Anda tepat di tengah bingkai')
                  : (cropShape === 'rect' ? 'Geser dan perbesar logo agar pas di dalam bingkai' : 'Geser dan perbesar foto agar pas di dalam lingkaran profil')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto flex flex-col items-center justify-center">
          {/* TAMPILAN 1: PILIH METODE (FILE ATAU KAMERA) */}
          {mode === 'SELECT' && (
            <div className="w-full space-y-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Opsi 1: Dari File / Galeri */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all cursor-pointer group text-center"
                >
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                    <Upload className="w-7 h-7" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white block">
                      Unggah dari Perangkat
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">
                      Pilih dari file galeri atau folder foto (JPG, PNG, WebP)
                    </span>
                  </div>
                </button>

                {/* Opsi 2: Ambil Foto Kamera Langsung */}
                <button
                  type="button"
                  onClick={startCamera}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-all cursor-pointer group text-center"
                >
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                    <Camera className="w-7 h-7" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white block">
                      Buka Kamera Perangkat
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">
                      Jepret foto langsung menggunakan webcam atau kamera ponsel
                    </span>
                  </div>
                </button>
              </div>

              {currentAvatarUrl && (
                <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{cropShape === 'rect' ? 'Logo saat ini:' : 'Foto profil saat ini:'}</span>
                  <img
                    src={currentAvatarUrl}
                    alt={cropShape === 'rect' ? 'Current Logo' : 'Current Avatar'}
                    className={`w-7 h-7 object-contain ${cropShape === 'rect' ? 'rounded-lg p-0.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700' : 'rounded-full border border-slate-300 dark:border-slate-700'}`}
                  />
                </div>
              )}
            </div>
          )}

          {/* TAMPILAN 2: LIVE KAMERA */}
          {mode === 'CAMERA' && (
            <div className="w-full flex flex-col items-center space-y-4">
              {cameraError ? (
                <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 text-left">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Izin Kamera Diperlukan</div>
                    <div className="mt-1">{cameraError}</div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs transition-colors"
                      >
                        Pilih File dari Perangkat Saja
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-2xl overflow-hidden bg-black border-2 border-blue-500 shadow-lg">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    {/* Viewfinder Overlay */}
                    <div className={`absolute inset-0 border-4 border-white/60 pointer-events-none ${cropShape === 'rect' ? 'rounded-2xl m-3' : 'rounded-full'}`} />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-full h-0.5 bg-white/20" />
                      <div className="h-full w-0.5 bg-white/20 absolute" />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        setMode('SELECT');
                      }}
                      className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white shadow-md transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Jepret Foto Sekarang</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAMPILAN 3: MANIPULASI CROP 1:1 (FACEBOOK STYLE) */}
          {mode === 'CROP' && (
            <div className="w-full flex flex-col items-center space-y-4">
              {/* Canvas Interactive Viewport */}
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  width={360}
                  height={360}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`w-72 h-72 sm:w-80 sm:h-80 rounded-2xl bg-slate-950 border-2 border-slate-300 dark:border-slate-700 shadow-md ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                />
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900/80 backdrop-blur-xs text-[10px] text-white font-medium pointer-events-none">
                  Geser untuk mengatur posisi
                </div>
              </div>

              {/* Toolbar Manipulasi (Zoom, Rotate, Reset) */}
              <div className="w-full max-w-sm space-y-3 pt-1">
                {/* Slider Zoom */}
                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <ZoomOut className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                  <ZoomIn className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 w-9 text-right">
                    {zoom.toFixed(1)}x
                  </span>
                </div>

                {/* Tombol Rotasi & Reset */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRotate}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                      title="Putar 90 Derajat"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Putar 90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                      title="Reset Posisi"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reset</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMode('SELECT')}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                  >
                    Ganti Foto Lain
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-5 py-3.5 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            Tutup
          </button>

          {mode === 'CROP' && (
            <button
              type="button"
              onClick={handleApplyCrop}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isProcessing ? 'Memotong...' : 'Potong & Simpan Foto'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
