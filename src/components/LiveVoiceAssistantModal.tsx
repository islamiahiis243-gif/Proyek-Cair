import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  VolumeX,
  Send,
  X,
  CheckCircle2,
  AlertCircle,
  Boxes,
  Wallet,
  ArrowRight,
  TrendingUp,
  MessageSquare,
  Camera,
  Paperclip,
  Image as ImageIcon,
  Building2,
  Clock,
  ShieldCheck,
  Receipt,
  RefreshCw
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  parseAgentQuery,
  AgentIntentResult,
  AgentContextSnapshot
} from '../lib/agentEngine';
import {
  processWithGemini,
  analyzeReceiptWithGemini,
  isGeminiAiAvailable
} from '../lib/geminiService';
import { formatRupiah } from '../lib/pdfGenerator';
import { uploadReceiptFile } from '../lib/receiptStorage';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actionCard?: AgentIntentResult;
}

export const LiveVoiceAssistantModal: React.FC = () => {
  const {
    user,
    activeRole,
    activeProject,
    currentCashBalance,
    totalStockAssetValue,
    items,
    stockMutations,
    cashMutations,
    addStockMutation,
    addCashMutation,
    pendingApprovalCount,
    setCurrentView,
    canViewFinancials
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [inputText, setInputText] = useState('');
  const [pendingAction, setPendingAction] = useState<AgentIntentResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State & Ref Kamera Interaktif Langsung
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // State & Ref Suara & Speech Recognition
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [liveInterimText, setLiveInterimText] = useState<string>('');
  const [audioVolume, setAudioVolume] = useState<number>(0); // 0 - 100
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const startAudioVisualizer = async () => {
    try {
      if (!navigator?.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const renderFrame = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const level = Math.min(100, Math.round((avg / 75) * 100));
        setAudioVolume(level);

        animFrameRef.current = requestAnimationFrame(renderFrame);
      };

      renderFrame();
    } catch (e) {
      console.warn('Audio stream visualizer tidak dapat diakses:', e);
    }
  };

  const stopAudioVisualizer = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioVolume(0);
  }, []);

  const stopCameraStream = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const openLiveCamera = async () => {
    stopListening();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    setIsSpeaking(false);

    if (!navigator?.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }

    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      cameraStreamRef.current = stream;
      setIsCameraActive(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.warn('Video play error:', e));
        }
      }, 100);
    } catch (err: any) {
      console.warn('Gagal membuka webcam langsung, beralih ke input kamera file:', err);
      stopCameraStream();
      cameraInputRef.current?.click();
    }
  };

  const toggleCameraFacing = async () => {
    const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextMode);
    if (isCameraActive) {
      stopCameraStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: nextMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });
        cameraStreamRef.current = stream;
        setIsCameraActive(true);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        }, 100);
      } catch {
        openLiveCamera();
      }
    }
  };

  const captureLivePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) {
        const capturedFile = new File([blob], `nota_lapangan_${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCameraStream();
        handleFileSelect(capturedFile);
      }
    }, 'image/jpeg', 0.92);
  };

  const handleFileSelect = async (file: File) => {
    setAttachedFile(file);
    const previewUrl = URL.createObjectURL(file);
    setAttachedPreview(previewUrl);

    // Jika berkas berupa gambar/foto nota fisik, langsung picu analisis cerdas Vision AI
    if (file.type.startsWith('image/')) {
      setIsScanningReceipt(true);
      const scanNotice: ChatMessage = {
        id: `scan-${Date.now()}`,
        sender: 'assistant',
        text: `📸 Foto nota "${file.name}" diterima. Sedang menganalisis teks, toko & rincian belanja dengan Vision AI...`,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, scanNotice]);

      try {
        const context = buildContextSnapshot();
        const visionResult = await analyzeReceiptWithGemini(file, context);
        setIsScanningReceipt(false);
        setPendingAction(visionResult);
        setMessages(prev => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            text: visionResult.spokenResponse,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            actionCard: visionResult.actionRequired ? visionResult : undefined
          }
        ]);
        speakResponse(visionResult.spokenResponse);
      } catch (err: any) {
        setIsScanningReceipt(false);
        console.warn('Vision scan error:', err);
      }
    }
  };

  const clearAttachment = () => {
    setAttachedFile(null);
    if (attachedPreview) {
      URL.revokeObjectURL(attachedPreview);
      setAttachedPreview(null);
    }
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome-1',
      sender: 'assistant',
      text: `Halo ${user?.name || 'Rekan Lapangan'}! Saya Asisten AI Proyek Cair. Anda tidak perlu repot mencari menu, cukup bicara atau ketik santai apa yang ingin Anda catat atau ketahui.`,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Gulir otomatis ke pesan terkini
  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, pendingAction]);

  // Cleanup saat unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
      stopListening();
      stopAudioVisualizer();
    };
  }, [stopCameraStream, stopAudioVisualizer]);

  // Fungsi Text-to-Speech (TTS) Suara Asisten Bahasa Indonesia
  const speakResponse = useCallback((text: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch {}
  }, [ttsEnabled]);

  const startListening = async () => {
    setSpeechError(null);
    setLiveInterimText('');

    // Hentikan suara TTS asisten agar tidak terjadi feedback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    setIsSpeaking(false);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError('Peramban Anda belum mendukung Speech Recognition. Gunakan Google Chrome, Microsoft Edge, atau ketik langsung di kotak pesan.');
      return;
    }

    // Bersihkan instance lama jika ada
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    // Aktifkan visualisasi amplitudo suara live
    startAudioVisualizer().catch(() => {});

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'id-ID';
      recognition.continuous = false;
      recognition.interimResults = true; // Menampilkan kata secara real-time saat berbicara

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        if (interim) {
          setLiveInterimText(interim);
          setInputText(interim);
        }

        if (finalTranscript && finalTranscript.trim()) {
          setIsListening(false);
          stopAudioVisualizer();
          setLiveInterimText('');
          setInputText('');
          handleProcessInput(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error event:', event.error);
        setIsListening(false);
        stopAudioVisualizer();
        setLiveInterimText('');

        if (event.error === 'not-allowed') {
          setSpeechError('Izin akses mikrofon belum diizinkan oleh peramban. Silakan klik ikon gembok di sebelah alamat URL (atau tombol "Minta Izin Ulang" di bawah) untuk mengizinkan mikrofon.');
        } else if (event.error === 'no-speech') {
          // Hening, tidak perlu error keras
        } else if (event.error === 'network') {
          setSpeechError('Koneksi suara terganggu. Periksa koneksi internet Anda atau ketik langsung di kotak pesan.');
        } else if (event.error !== 'aborted') {
          setSpeechError(`Perekaman suara terhenti (${event.error}). Klik tombol mic untuk mencoba kembali.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        stopAudioVisualizer();
        setLiveInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Gagal mengaktifkan SpeechRecognition:', err);
      setIsListening(false);
      stopAudioVisualizer();
      setSpeechError('Gagal mengaktifkan mikrofon. Pastikan perangkat mikrofon terpasang dan izin aktif.');
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    stopAudioVisualizer();
    setIsListening(false);
    setLiveInterimText('');
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Bangun snapshot konteks saat ini
  const buildContextSnapshot = (): AgentContextSnapshot => ({
    userRole: activeRole,
    userName: user?.name || 'Pengguna',
    projectName: activeProject?.name || 'Proyek Aktif',
    currentCashBalance: currentCashBalance,
    items: items,
    totalStockAssetValue: totalStockAssetValue,
    stockMutationsCount: stockMutations.length,
    cashMutationsCount: cashMutations.length,
    pendingApprovalCount: pendingApprovalCount,
    canViewFinancials: activeRole !== 'Viewer/Pengamat' && Boolean(canViewFinancials)
  });

  // Rekomendasi Cerdas Dinamis sesuai Kondisi Nyata Lapangan (Aturan AGENTS.md Poin 4)
  const dynamicChips = React.useMemo(() => {
    const list: { label: string; query: string }[] = [];

    // 1. Prioritas Smart Suggestion: Barang yang habis atau kritis di lapangan
    const criticalItem = items.find(it => (it.stok_saat_ini ?? 0) <= 0 || it.status === 'Tidak Tersedia' || it.status === 'Stok Menipis');
    if (criticalItem) {
      list.push({
        label: `Stok ${criticalItem.nama_barang} Habis: Catat Masuk`,
        query: `Catat barang masuk ${criticalItem.nama_barang} 20 ${criticalItem.satuan} dari toko rekanan bayar kas`
      });
    }

    // 2. Barang yang siap pakai (stok surplus)
    const availableItem = items.find(it => (it.stok_saat_ini ?? 0) > 10 && it.id !== criticalItem?.id);
    if (availableItem) {
      list.push({
        label: `Pakai ${availableItem.nama_barang} Lapangan`,
        query: `Keluarkan 5 ${availableItem.satuan} ${availableItem.nama_barang} untuk pemakaian lapangan`
      });
    }

    // 3. Antrean dokumen persetujuan
    if ((pendingApprovalCount || 0) > 0) {
      list.push({
        label: `Periksa ${pendingApprovalCount} Antrean Dokumen`,
        query: `Apakah ada antrean persetujuan dokumen?`
      });
    }

    // 4. Saldo Kas & Skenario Finansial
    if (activeRole !== 'Viewer/Pengamat' && canViewFinancials) {
      list.push({
        label: 'Cek Saldo Kas',
        query: 'Berapa sisa uang kas proyek sekarang?'
      });
    }

    // 5. Skenario Lapangan Khusus
    list.push({
      label: 'Transfer Kantor Pusat',
      query: 'Beli keramik 30 dus lunas transfer kantor pusat'
    });
    list.push({
      label: 'Tempo / Hutang Toko',
      query: 'Catat pasir 1 truk dari TB Sumber Rejeki tempo toko'
    });

    return list;
  }, [items, pendingApprovalCount, activeRole, canViewFinancials]);

  // Eksekusi Tindakan yang Diusulkan (Konfirmasi Aman)
  const handleExecuteAction = async (action: AgentIntentResult) => {
    if (isExecuting) return;
    setIsExecuting(true);

    try {
      const { type, data } = action;

      // Unggah foto nota jika ada lampiran berkas / kamera
      let uploadedReceiptUrl: string | undefined = undefined;
      if (attachedFile) {
        try {
          uploadedReceiptUrl = await uploadReceiptFile(
            attachedFile,
            activeProject?.id || 'proyek_cair',
            data.storeName || 'nota_ai'
          );
        } catch (uploadErr) {
          console.warn('Gagal unggah foto nota ke Supabase Storage, menggunakan offline data fallback:', uploadErr);
        }
      }
      const receiptUrls = uploadedReceiptUrl ? [uploadedReceiptUrl] : [];

      // Skenario Pembayaran Lapangan: KAS_PROYEK | KANTOR_PUSAT | TEMPO_TOKO | PANJAR_LAPANGAN
      const scenario = data.paymentScenario || (type === 'STOCK_IN_AND_CASH' ? 'KAS_PROYEK' : undefined);

      // 1. Eksekusi Barang Masuk + Kas Keluar
      if (type === 'STOCK_IN_AND_CASH' || type === 'STOCK_IN_ONLY') {
        const itemToMutate = items.find(it => it.id === data.matchedItemId);

        if (!itemToMutate) {
          throw new Error(`Item material "${data.itemCandidate || data.matchedItemName || 'yang dimaksud'}" tidak ditemukan dalam master BOQ proyek.`);
        }

        const qty = data.quantity || 1;
        const total = data.totalAmount || (itemToMutate ? itemToMutate.harga_satuan * qty : 0);
        const store = data.storeName || 'Toko Rekanan';
        const unit = data.unit || (itemToMutate ? itemToMutate.satuan : 'unit');
        const invoiceNo = `INV-AI-${Date.now().toString().slice(-6)}`;

        // Tentukan status harga dan catatan sesuai skenario pembayaran (Skenario A-D)
        let statusHarga: 'TERCATAT' | 'NOTA_MENYUSUL' = 'TERCATAT';
        let stockNotes = `Dicatat via Live AI: ${data.notes || ''}`;

        if (scenario === 'KANTOR_PUSAT') {
          stockNotes += ' [Lunas via Transfer Kantor Pusat - Kas Proyek Aman]';
        } else if (scenario === 'TEMPO_TOKO') {
          statusHarga = 'NOTA_MENYUSUL';
          stockNotes += ' [Hutang Toko/Tempo - Menunggu Tagihan Kasir]';
        } else if (scenario === 'PANJAR_LAPANGAN') {
          stockNotes += ' [Dibayar via Panjar Lapangan - Menunggu LPJ]';
        } else if (scenario === 'KAS_PROYEK') {
          stockNotes += ' [Lunas Kas Proyek]';
        }

        if (receiptUrls.length > 0) {
          stockNotes += ' (Foto Nota Fisik Terlampir)';
        }

        // Tambah mutasi gudang
        const stockRes = await addStockMutation({
          barang_id: itemToMutate.id,
          nama_barang: itemToMutate.nama_barang,
          jenis: 'MASUK',
          jumlah: qty,
          satuan: unit,
          tujuan_keperluan: 'Penyediaan Stok Gudang Proyek',
          pic_penerima_penyerah: user?.name || 'Petugas Lapangan',
          harga_satuan_beli: data.pricePerUnit || (total && qty ? Math.round(total / qty) : itemToMutate.harga_satuan),
          total_nota_fisik: total,
          tanggal: new Date().toISOString().split('T')[0],
          nomor_nota: invoiceNo,
          nama_toko: store,
          nama_item_aktual: itemToMutate.nama_barang,
          status_harga: statusHarga,
          beban_biaya: 'KONTRAKTOR',
          catatan: stockNotes,
          lampiran_nota_urls: receiptUrls.length > 0 ? receiptUrls : undefined
        });

        if (!stockRes.success) {
          throw new Error(stockRes.message);
        }

        // Efek Domino ke Pembukuan Kas berdasarkan Skenario:
        // Skenario A: KAS_PROYEK -> Potong kas langsung (status REKONSILIASI_NOTA)
        if (scenario === 'KAS_PROYEK' && total > 0) {
          await addCashMutation({
            jenis: 'KELUAR',
            jumlah_rp: total,
            kategori_keperluan: 'Material',
            untuk_apa: `Pelunasan belanja ${qty} ${unit} ${itemToMutate.nama_barang} dari ${store}`,
            pic: user?.name || 'Kasir Proyek',
            tanggal: new Date().toISOString().split('T')[0],
            nomor_kuitansi: invoiceNo,
            nama_toko: store,
            source_module: 'MUTASI_BARANG',
            source_entity_id: stockRes.id,
            source_entity_no: invoiceNo,
            beban_biaya: 'KONTRAKTOR',
            status_bukti: receiptUrls.length > 0 ? 'TERLAMPIR' : 'REKONSILIASI_NOTA',
            catatan: `Dibayar via Live AI: ${data.notes || ''}`,
            lampiran_nota_urls: receiptUrls.length > 0 ? receiptUrls : undefined
          });
        }
        // Skenario D: PANJAR_LAPANGAN -> Potong kas sebagai Panjar/Kasbon terbuka (is_kasbon = true)
        else if (scenario === 'PANJAR_LAPANGAN' && total > 0) {
          await addCashMutation({
            jenis: 'KELUAR',
            jumlah_rp: total,
            kategori_keperluan: 'Panjar / Kasbon',
            untuk_apa: `Panjar pembelian ${qty} ${unit} ${itemToMutate.nama_barang} dari ${store}`,
            pic: user?.name || 'Petugas Lapangan',
            tanggal: new Date().toISOString().split('T')[0],
            nomor_kuitansi: invoiceNo,
            nama_toko: store,
            source_module: 'MUTASI_BARANG',
            source_entity_id: stockRes.id,
            source_entity_no: invoiceNo,
            beban_biaya: 'KONTRAKTOR',
            is_kasbon: true,
            status_kasbon: 'TERBUKA',
            status_bukti: receiptUrls.length > 0 ? 'TERLAMPIR' : 'BUKTI_MENYUSUL',
            catatan: `Panjar Lapangan via Live AI: ${data.notes || ''}`,
            lampiran_nota_urls: receiptUrls.length > 0 ? receiptUrls : undefined
          });
        }
        // Skenario B & C: KANTOR_PUSAT & TEMPO_TOKO -> TIDAK memotong kas proyek (mencegah double-payment & defisit fiktif)

        // Respon suara & teks informatif native Indonesia
        let successMsg = `Berhasil dibukukan! ${qty} ${unit} ${itemToMutate.nama_barang} telah masuk gudang.`;
        if (scenario === 'KANTOR_PUSAT') {
          successMsg += ` Pelunasan ${formatRupiah(total)} dibayarkan via Transfer Kantor Pusat (kas proyek tetap utuh).`;
        } else if (scenario === 'TEMPO_TOKO') {
          successMsg += ` Pembayaran ${formatRupiah(total)} dicatat Tempo/Hutang Toko (tidak ada potongan kas saat ini).`;
        } else if (scenario === 'PANJAR_LAPANGAN') {
          successMsg += ` Kasbon panjar ${formatRupiah(total)} dicatat terbuka untuk dipertanggungjawabkan (LPJ).`;
        } else if (scenario === 'KAS_PROYEK' && total > 0) {
          successMsg += ` Pelunasan tunai ${formatRupiah(total)} telah dipotong dari buku kas proyek.`;
        }

        if (receiptUrls.length > 0) {
          successMsg += ' Foto nota fisik berhasil diarsipkan ke album.';
        }

        setMessages(prev => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            sender: 'assistant',
            text: successMsg,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse(successMsg);
        setPendingAction(null);
        clearAttachment();
      }

      // 2. Eksekusi Barang Keluar (Pakai Lapangan)
      else if (type === 'STOCK_OUT') {
        const itemToMutate = items.find(it => it.id === data.matchedItemId);
        const qty = data.quantity || 1;

        if (!itemToMutate) {
          throw new Error(`Item material "${data.itemCandidate || data.matchedItemName || 'yang dimaksud'}" tidak ditemukan dalam master BOQ proyek.`);
        }

        const stockRes = await addStockMutation({
          barang_id: itemToMutate.id,
          nama_barang: itemToMutate.nama_barang,
          jenis: 'KELUAR',
          jumlah: qty,
          satuan: data.unit || itemToMutate.satuan,
          tujuan_keperluan: data.notes || 'Pemakaian Pekerjaan Lapangan',
          pic_penerima_penyerah: user?.name || 'Mandor Lapangan',
          harga_satuan_beli: itemToMutate.harga_satuan,
          total_nota_fisik: itemToMutate.harga_satuan * qty,
          tanggal: new Date().toISOString().split('T')[0],
          nama_item_aktual: itemToMutate.nama_barang,
          status_harga: 'TERCATAT',
          beban_biaya: 'PROYEK_BOQ',
          catatan: `Pengeluaran via Live AI: ${data.notes || ''}`
        });

        if (!stockRes.success) {
          throw new Error(stockRes.message);
        }

        const successMsg = `Pengeluaran ${qty} ${data.unit || itemToMutate.satuan} ${itemToMutate.nama_barang} berhasil dicatat. Sisa stok fisik di gudang telah diperbarui.`;
        setMessages(prev => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            sender: 'assistant',
            text: successMsg,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse(successMsg);
        setPendingAction(null);
        clearAttachment();
      }

      // 3. Eksekusi Pengeluaran Kas Murni
      else if (type === 'CASH_EXPENSE') {
        const amount = data.totalAmount || 0;
        if (amount <= 0) throw new Error('Nominal pengeluaran tidak valid.');

        const catKeperluan = data.category === 'Operasional Kantor & Lapangan' ? 'Operasional' : (data.category || 'Material');

        const cashRes = await addCashMutation({
          jenis: 'KELUAR',
          jumlah_rp: amount,
          kategori_keperluan: catKeperluan as any,
          untuk_apa: data.notes || `Pengeluaran ${catKeperluan} via Live AI`,
          pic: user?.name || 'Kasir Proyek',
          tanggal: new Date().toISOString().split('T')[0],
          nomor_kuitansi: `KAS-AI-${Date.now().toString().slice(-6)}`,
          beban_biaya: 'KONTRAKTOR',
          status_bukti: receiptUrls.length > 0 ? 'TERLAMPIR' : 'BUKTI_MENYUSUL',
          catatan: data.storeName ? `Penerima/Toko: ${data.storeName}` : undefined,
          lampiran_nota_urls: receiptUrls.length > 0 ? receiptUrls : undefined
        });

        if (!cashRes.success) {
          throw new Error(cashRes.message);
        }

        let successMsg = `Pengeluaran kas ${data.category || ''} sebesar ${formatRupiah(amount)} telah berhasil dibukukan ke jurnal kas.`;
        if (receiptUrls.length > 0) {
          successMsg += ' Foto bukti nota berhasil diarsipkan ke album.';
        }
        setMessages(prev => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            sender: 'assistant',
            text: successMsg,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse(successMsg);
        setPendingAction(null);
        clearAttachment();
      }
    } catch (err: any) {
      const errMsg = `Gagal mengeksekusi: ${err.message || 'Terjadi kesalahan sistem'}`;
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: errMsg,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      speakResponse(errMsg);
    } finally {
      setIsExecuting(false);
    }
  };

  // Proses Input Pengguna (Suara atau Teks)
  const handleProcessInput = async (query: string) => {
    if (!query || !query.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsAiThinking(true);

    try {
      const context = buildContextSnapshot();
      // Menggunakan penalaran LLM Gemini asli dengan fallback ke mesin parser lokal
      const result = await processWithGemini(query, context);

      // Jika pengguna memberi perintah konfirmasi langsung ("ya, eksekusi")
      if (result.type === 'CONFIRM_ACTION') {
        if (pendingAction) {
          handleExecuteAction(pendingAction);
          return;
        } else {
          const reply = 'Tidak ada transaksi yang sedang menunggu konfirmasi. Apa yang ingin Anda catat?';
          setMessages(prev => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              sender: 'assistant',
              text: reply,
              timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            }
          ]);
          speakResponse(reply);
          return;
        }
      }

      // Jika pengguna membatalkan ("batal")
      if (result.type === 'CANCEL_ACTION') {
        setPendingAction(null);
        setMessages(prev => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            text: 'Tindakan dibatalkan. Tidak ada perubahan yang dilakukan.',
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse('Tindakan dibatalkan.');
        return;
      }

      // Jika periksa antrean persetujuan
      if (result.type === 'CHECK_APPROVAL_QUEUE') {
        if (result.data?.targetView) {
          setCurrentView(result.data.targetView);
        }
        setMessages(prev => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            text: result.spokenResponse,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse(result.spokenResponse);
        return;
      }

      // Jika navigasi halaman
      if (result.type === 'NAVIGATE' && result.data?.targetView) {
        setCurrentView(result.data.targetView);
        setMessages(prev => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            text: result.spokenResponse,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        speakResponse(result.spokenResponse);
        return;
      }

      // Jika membutuhkan tindakan konfirmasi aman (mutasi barang/kas)
      if (result.actionRequired) {
        setPendingAction(result);
      } else {
        setPendingAction(null);
      }

      // Tambah pesan balasan asisten
      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: 'assistant',
          text: result.spokenResponse,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
          actionCard: result.actionRequired ? result : undefined
        }
      ]);
      speakResponse(result.spokenResponse);
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      handleProcessInput(inputText.trim());
    }
  };

  return (
    <>
      {/* =========================================================================
          1. WIDGET TOMBOL MENGAMBANG (FLOATING LIVE TRIGGER)
          ========================================================================= */}
      <div className="fixed bottom-5 right-5 z-40 sm:bottom-6 sm:right-6 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center gap-2 px-4 py-3 rounded-2xl bg-linear-to-r from-blue-600 via-indigo-600 to-emerald-600 text-white font-bold text-xs shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer border border-white/20"
          title="Buka Asisten Percakapan Langsung (Zero-Menu Live AI)"
        >
          {/* Animasi Gelombang Cahaya */}
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-slate-900"></span>
          </span>

          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          </div>

          <span className="tracking-wide hidden sm:inline">Live AI Assistant</span>
          <span className="text-[10px] font-medium bg-black/20 px-2 py-0.5 rounded-full border border-white/10 hidden sm:inline">
            Bicara / Ketik
          </span>
        </button>
      </div>

      {/* =========================================================================
          2. MODAL DIALOG PERCAKAPAN LANGSUNG (LIVE ASSISTANT DIALOG)
          ========================================================================= */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full sm:max-w-xl h-[88vh] sm:h-[620px] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden transition-colors">
            {/* =========================================================================
                KAMERA PEMINDAI NOTA INTERAKTIF LANGSUNG (LIVE VIEWFINDER OVERLAY)
                ========================================================================= */}
            {isCameraActive && (
              <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in fade-in zoom-in-95">
                {/* Header Viewfinder */}
                <div className="p-3.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-10">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-white tracking-wide">Kamera Pemindai Nota Fisik</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopCameraStream}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Tutup Kamera"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Video Stream & Aiming Guide Frame */}
                <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                  <video
                    ref={videoRef}
                    playsInline
                    autoPlay
                    muted
                    className="w-full h-full object-cover"
                  />

                  {/* Frame Panduan Bidik Nota Fisik */}
                  <div className="absolute inset-5 sm:inset-8 border-2 border-dashed border-blue-400/80 rounded-2xl pointer-events-none flex flex-col items-center justify-between p-3 sm:p-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
                    <span className="text-[11px] font-semibold text-white/95 bg-blue-600/80 px-3 py-1 rounded-full backdrop-blur-xs shadow-md">
                      Posisikan nota fisik di dalam kotak ini
                    </span>
                    <span className="text-[10px] text-white/80 bg-black/60 px-2.5 py-0.5 rounded-full backdrop-blur-xs">
                      Pastikan nama toko & total rupiah terlihat tajam
                    </span>
                  </div>
                </div>

                {/* Viewfinder Controls */}
                <div className="p-4 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around z-10">
                  {/* Switch Camera */}
                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    className="p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors flex flex-col items-center gap-1 cursor-pointer active:scale-95"
                    title="Putar Kamera"
                  >
                    <RefreshCw className="w-5 h-5" />
                    <span className="text-[9px] text-slate-400">Putar</span>
                  </button>

                  {/* Shutter Button (Jepret Foto) */}
                  <button
                    type="button"
                    onClick={captureLivePhoto}
                    className="w-16 h-16 rounded-full bg-white hover:bg-slate-100 p-1.5 shadow-xl ring-4 ring-blue-500/50 hover:ring-blue-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
                    title="Jepret Foto Nota"
                  >
                    <div className="w-full h-full rounded-full border-2 border-slate-900 bg-blue-600 flex items-center justify-center text-white">
                      <Camera className="w-6 h-6" />
                    </div>
                  </button>

                  {/* Upload file fallback */}
                  <button
                    type="button"
                    onClick={() => {
                      stopCameraStream();
                      cameraInputRef.current?.click();
                    }}
                    className="p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors flex flex-col items-center gap-1 cursor-pointer active:scale-95"
                    title="Pilih Berkas Dari Galeri / Komputer"
                  >
                    <ImageIcon className="w-5 h-5" />
                    <span className="text-[9px] text-slate-400">Berkas</span>
                  </button>
                </div>
              </div>
            )}

            {/* Header Modal */}
            <div className="p-4 sm:p-4.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xs">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-md shadow-blue-500/20">
                    <img
                      src="/mascot_3d.png"
                      alt="Live AI"
                      className="w-7 h-7 object-contain drop-shadow-sm"
                    />
                  </div>
                  {isSpeaking && (
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900 animate-bounce"></span>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Live AI Proyek Cair
                    </h3>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                        isGeminiAiAvailable()
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                      }`}
                      title={
                        isGeminiAiAvailable()
                          ? 'Terhubung dengan Google Gemini AI Cloud & Vision OCR'
                          : 'Beroperasi menggunakan Mesin Pintar Heuristik Lapangan'
                      }
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {isGeminiAiAvailable() ? 'Gemini AI Aktif' : 'Mesin Lapangan Bawaan'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Paham niat, operasikan mutasi stok & kas tanpa menu.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTtsEnabled(!ttsEnabled)}
                  className={`p-2 rounded-xl border text-xs transition-colors cursor-pointer ${
                    ttsEnabled
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-800 text-slate-400'
                  }`}
                  title={ttsEnabled ? 'Suara Asisten Aktif' : 'Suara Asisten Dibisukan'}
                >
                  {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    stopCameraStream();
                    stopListening();
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Area Pesan Chat & Tindakan Konfirmasi */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 text-xs">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-blue-600 text-white shadow-sm rounded-tr-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 rounded-tl-xs'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 px-1">
                    {msg.timestamp}
                  </span>
                </div>
              ))}

              {/* KARTU KONFIRMASI TINDAKAN OTOMATIS (SAFE CONFIRMATION CARD) */}
              {pendingAction && (
                <div className="rounded-2xl border-2 border-blue-500/80 bg-blue-50/50 dark:bg-blue-950/30 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {pendingAction.proposedActionTitle}
                      </h4>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {pendingAction.proposedActionSubtitle}
                      </p>

                      {/* Badge Skenario Pembayaran Nyata (Skenario A-D) */}
                      {pendingAction.data.paymentScenario && (
                        <div className="flex items-center gap-1.5 pt-2">
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Skema:</span>
                          {pendingAction.data.paymentScenario === 'KANTOR_PUSAT' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              <Building2 className="w-3 h-3" /> Kantor Pusat (Kas Proyek Utuh)
                            </span>
                          )}
                          {pendingAction.data.paymentScenario === 'TEMPO_TOKO' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              <Clock className="w-3 h-3" /> Tempo / Hutang Toko
                            </span>
                          )}
                          {pendingAction.data.paymentScenario === 'PANJAR_LAPANGAN' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              <Receipt className="w-3 h-3" /> Panjar Lapangan (Kasbon Terbuka)
                            </span>
                          )}
                          {pendingAction.data.paymentScenario === 'KAS_PROYEK' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                              <Wallet className="w-3 h-3" /> Kas Proyek / Tunai
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thumbnail Foto Nota Terlampir di Kartu Konfirmasi */}
                  {attachedPreview && (
                    <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-blue-200 dark:border-blue-900/50">
                      <img
                        src={attachedPreview}
                        alt="Bukti Nota Terlampir"
                        className="w-11 h-11 object-cover rounded-lg border border-blue-300 dark:border-blue-700 shadow-xs shrink-0"
                      />
                      <div className="text-[11px] min-w-0">
                        <p className="font-bold text-slate-800 dark:text-slate-200 truncate">Foto Nota Terlampir</p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Akan diarsipkan ke Album & ditautkan ke mutasi
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-blue-200 dark:border-blue-900/60 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isExecuting}
                      onClick={() => handleExecuteAction(pendingAction)}
                      className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs shadow-md shadow-blue-600/25 transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isExecuting ? 'Membukukan...' : 'Ya, Eksekusi Sekarang'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isExecuting}
                      onClick={() => {
                        setPendingAction(null);
                        speakResponse('Dibatalkan.');
                      }}
                      className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Batalkan
                    </button>
                  </div>
                </div>
              )}

              {/* Indikator Pemrosesan Cerdas AI / Vision Scan */}
              {(isAiThinking || isScanningReceipt) && (
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-blue-50/80 dark:bg-blue-950/50 border border-blue-200/80 dark:border-blue-800/80 w-fit text-blue-700 dark:text-blue-300 animate-pulse shadow-xs">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
                  <span className="text-xs font-semibold">
                    {isScanningReceipt
                      ? 'Vision AI sedang membaca nota fisik & menghitung total...'
                      : 'Live AI sedang menganalisis niat Anda...'}
                  </span>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chips Rekomendasi Cepat & Skenario Lapangan Dinamis (Aturan AGENTS.md Poin 4) */}
            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-1.5 overflow-x-auto text-[11px] whitespace-nowrap scrollbar-none">
              <span className="text-slate-400 dark:text-slate-500 font-semibold text-[10px]">Coba:</span>
              {dynamicChips.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleProcessInput(chip.query)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer shadow-2xs font-medium"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Chip Pratinjau Foto Nota Terlampir */}
            {attachedPreview && (
              <div className="mx-3 my-2 p-2 rounded-xl bg-blue-50/90 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-center justify-between animate-in fade-in slide-in-from-bottom-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={attachedPreview}
                    alt="Pratinjau Nota"
                    className="w-10 h-10 object-cover rounded-lg border border-blue-300 dark:border-blue-700 shadow-xs shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-blue-900 dark:text-blue-100 truncate">1 Foto Nota Terlampir</span>
                      <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded-full shrink-0">
                        Siap Diunggah
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      Otomatis diarsipkan ke album nota & ditautkan ke mutasi
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 ml-2"
                  title="Hapus foto nota"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Banner Error Mikrofon & Panduan Izin Interaktif */}
            {speechError && (
              <div className="mx-3 my-2 p-3 rounded-2xl bg-rose-50/95 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs shadow-md animate-in fade-in slide-in-from-top-1">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <p className="font-bold text-rose-900 dark:text-rose-100">
                      Izin Akses Mikrofon Diperlukan
                    </p>
                    <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
                      {speechError}
                    </p>
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSpeechError(null);
                          if (navigator?.mediaDevices?.getUserMedia) {
                            navigator.mediaDevices.getUserMedia({ audio: true })
                              .then(() => startListening())
                              .catch(() => {
                                setSpeechError('Peramban masih memblokir mikrofon. Klik ikon gembok 🔒 di samping URL dan pilih "Izinkan" untuk Mikrofon.');
                              });
                          } else {
                            startListening();
                          }
                        }}
                        className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer shadow-xs transition-colors"
                      >
                        Minta Izin Ulang / Coba Lagi
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpeechError(null)}
                        className="px-2.5 py-1 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[10px] font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer transition-colors"
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Banner Transkrip Suara Langsung & Visualizer Indikator Suara Masuk */}
            {isListening && (
              <div className="mx-3 my-2 p-3 rounded-2xl bg-blue-50/95 dark:bg-blue-950/75 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 text-[11px] space-y-2 shadow-sm animate-in slide-in-from-bottom-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Visualizer Gelombang Suara (Volume Bar Level Dinamis) */}
                    <div className="flex items-center gap-1 h-5 px-2 py-0.5 bg-white/80 dark:bg-slate-900/80 rounded-lg border border-blue-200 dark:border-blue-800/80 shadow-2xs">
                      {[0.5, 0.9, 1.3, 1.0, 0.8, 1.2].map((mult, idx) => {
                        const h = Math.max(4, Math.min(18, Math.round((audioVolume * mult * 0.18) + 4)));
                        const isVocal = audioVolume > 12;
                        return (
                          <span
                            key={idx}
                            className={`w-1 rounded-full transition-all duration-75 ${
                              isVocal
                                ? 'bg-emerald-500 dark:bg-emerald-400 shadow-xs shadow-emerald-500/50'
                                : 'bg-blue-400/50 dark:bg-blue-500/40'
                            }`}
                            style={{ height: `${h}px` }}
                          />
                        );
                      })}
                    </div>

                    {/* Status Deteksi Suara Masuk */}
                    {audioVolume > 12 ? (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 shrink-0 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        Suara Masuk: {audioVolume}%
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Menunggu suara Anda...
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={stopListening}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold cursor-pointer shrink-0 shadow-xs active:scale-95 transition-all"
                  >
                    Selesai Bicara
                  </button>
                </div>

                {/* Teks Ucapan yang Terbaca Secara Real-Time */}
                <div className="px-2.5 py-1.5 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-blue-100 dark:border-blue-900/40 min-w-0">
                  <p className="text-[11px] leading-relaxed italic text-slate-800 dark:text-slate-200 break-words">
                    {liveInterimText ? (
                      <span>&ldquo;{liveInterimText}&rdquo;</span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">
                        Bicaralah sekarang dalam bahasa Indonesia, misalnya: &ldquo;Catat semen masuk 20 sak...&rdquo;
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Input Tersembunyi untuk Berkas Foto/Dokumen */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelect(e.target.files[0]);
                }
                e.target.value = '';
              }}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelect(e.target.files[0]);
                }
                e.target.value = '';
              }}
              className="hidden"
            />

            {/* Input Bar, Tombol Kamera Langsung & Tombol Mic Suara */}
            <form
              onSubmit={handleFormSubmit}
              className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
            >
              {/* Tombol Kamera Langsung (Live Viewfinder / Foto Nota) */}
              <button
                type="button"
                onClick={openLiveCamera}
                className="w-10 h-10 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Buka Kamera untuk Foto Nota Fisik"
              >
                <Camera className="w-4.5 h-4.5" />
              </button>

              {/* Tombol Lampiran Galeri / Dokumen */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Pilih Berkas Nota / Galeri / PDF"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Tombol Mic Suara Indonesia Real-Time dengan Dynamic Audio Level Glow */}
              <button
                type="button"
                onClick={toggleListening}
                className={`relative w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-md ${
                  isListening
                    ? audioVolume > 12
                      ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/40 shadow-emerald-600/40 scale-105'
                      : 'bg-rose-600 text-white ring-4 ring-rose-500/30 shadow-rose-600/30'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/25 active:scale-95'
                }`}
                style={isListening && audioVolume > 10 ? { transform: `scale(${1 + Math.min(0.18, audioVolume / 450)})` } : undefined}
                title={isListening ? 'Klik untuk berhenti mendengarkan' : 'Klik untuk bicara bahasa Indonesia'}
              >
                {/* Gelombang Ripple Lingkaran saat Suara Terdeteksi Masuk */}
                {isListening && audioVolume > 15 && (
                  <span className="absolute inset-0 rounded-2xl bg-emerald-400 opacity-40 animate-ping pointer-events-none" />
                )}
                {isListening ? <MicOff className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5" />}
              </button>

              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={isListening ? 'Mendengarkan ucapan Anda...' : 'Bicara lewat mic atau ketik niat Anda di sini...'}
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-blue-500"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
