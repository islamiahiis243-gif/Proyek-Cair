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
  MessageSquare
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  parseAgentQuery,
  AgentIntentResult,
  AgentContextSnapshot
} from '../lib/agentEngine';
import { formatRupiah } from '../lib/pdfGenerator';

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
    setCurrentView
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [inputText, setInputText] = useState('');
  const [pendingAction, setPendingAction] = useState<AgentIntentResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
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

  // Setup Web Speech API (Speech Recognition)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'id-ID';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setIsListening(false);
        if (transcript && transcript.trim()) {
          handleProcessInput(transcript.trim());
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          setIsListening(false);
        }
      } else {
        alert('Browser Anda belum mendukung input suara langsung. Anda dapat menggunakan kotak ketik teks.');
      }
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
    cashMutationsCount: cashMutations.length
  });

  // Eksekusi Tindakan yang Diusulkan (Konfirmasi Aman)
  const handleExecuteAction = async (action: AgentIntentResult) => {
    if (isExecuting) return;
    setIsExecuting(true);

    try {
      const { type, data } = action;

      // 1. Eksekusi Barang Masuk + Kas Keluar
      if (type === 'STOCK_IN_AND_CASH' || type === 'STOCK_IN_ONLY') {
        const itemToMutate = items.find(it => it.id === data.matchedItemId) || items[0];
        const qty = data.quantity || 1;
        const total = data.totalAmount || (itemToMutate ? itemToMutate.harga_satuan * qty : 0);
        const store = data.storeName || 'Toko Rekanan';

        if (!itemToMutate) {
          throw new Error('Item material tidak ditemukan dalam daftar inventaris.');
        }

        // Tambah mutasi gudang
        const stockRes = await addStockMutation({
          barang_id: itemToMutate.id,
          nama_barang: itemToMutate.nama_barang,
          jenis: 'MASUK',
          jumlah: qty,
          satuan: data.unit || itemToMutate.satuan,
          tujuan_keperluan: 'Penyediaan Stok Gudang Proyek',
          pic_penerima_penyerah: user?.name || 'Petugas Lapangan',
          harga_satuan_beli: data.pricePerUnit || itemToMutate.harga_satuan,
          total_nota_fisik: total,
          tanggal: new Date().toISOString().split('T')[0],
          nomor_nota: `INV-AI-${Date.now().toString().slice(-6)}`,
          nama_toko: store,
          nama_item_aktual: itemToMutate.nama_barang,
          status_harga: 'TERCATAT',
          beban_biaya: 'KONTRAKTOR',
          catatan: `Dicatat via Live AI Assistant: ${data.notes || ''}`
        });

        if (!stockRes.success) {
          throw new Error(stockRes.message);
        }

        // Jika terhubung kas keluar
        if (type === 'STOCK_IN_AND_CASH' && total > 0) {
          await addCashMutation({
            jenis: 'KELUAR',
            jumlah_rp: total,
            kategori_keperluan: 'Material',
            untuk_apa: `Pelunasan belanja ${qty} ${data.unit || itemToMutate.satuan} ${itemToMutate.nama_barang} dari ${store}`,
            pic: user?.name || 'Kasir Proyek',
            tanggal: new Date().toISOString().split('T')[0],
            nomor_kuitansi: `KAS-AI-${Date.now().toString().slice(-6)}`,
            beban_biaya: 'KONTRAKTOR',
            status_bukti: 'REKONSILIASI_NOTA',
            catatan: `Dibayar via Live AI: ${data.notes || ''}`
          });
        }

        const successMsg = `Berhasil dibukukan! ${qty} ${data.unit || itemToMutate.satuan} ${itemToMutate.nama_barang} telah masuk gudang${type === 'STOCK_IN_AND_CASH' ? ` dan pembayaran ${formatRupiah(total)} telah dicatat di buku kas.` : '.'}`;
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
      }

      // 2. Eksekusi Barang Keluar (Pakai Lapangan)
      else if (type === 'STOCK_OUT') {
        const itemToMutate = items.find(it => it.id === data.matchedItemId) || items[0];
        const qty = data.quantity || 1;

        if (!itemToMutate) {
          throw new Error('Item material tidak ditemukan.');
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
          status_bukti: 'TERLAMPIR',
          catatan: data.storeName ? `Penerima/Toko: ${data.storeName}` : undefined
        });

        if (!cashRes.success) {
          throw new Error(cashRes.message);
        }

        const successMsg = `Pengeluaran kas ${data.category || ''} sebesar ${formatRupiah(amount)} telah berhasil dibukukan ke jurnal kas.`;
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
  const handleProcessInput = (query: string) => {
    if (!query || !query.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    const context = buildContextSnapshot();
    const result = parseAgentQuery(query, context);

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

    // Jika navigasi halaman
    if (result.type === 'NAVIGATE' && result.data.targetView) {
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
          <div className="w-full sm:max-w-xl h-[88vh] sm:h-[620px] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden transition-colors">
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
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      Aktif
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
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {pendingAction.proposedActionTitle}
                      </h4>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {pendingAction.proposedActionSubtitle}
                      </p>
                    </div>
                  </div>

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

              <div ref={chatBottomRef} />
            </div>

            {/* Chips Rekomendasi Cepat */}
            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-1.5 overflow-x-auto text-[11px] whitespace-nowrap scrollbar-none">
              <span className="text-slate-400 dark:text-slate-500 font-semibold text-[10px]">Coba:</span>
              <button
                type="button"
                onClick={() => handleProcessInput('Berapa sisa uang kas sekarang?')}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors cursor-pointer"
              >
                Cek Saldo Kas
              </button>
              <button
                type="button"
                onClick={() => handleProcessInput('Catat semen masuk 50 sak dari TB Maju Jaya total dua juta lima ratus bayar kas')}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors cursor-pointer"
              >
                Masuk Semen & Bayar
              </button>
              <button
                type="button"
                onClick={() => handleProcessInput('Keluarkan 20 sak semen untuk lantai 2')}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors cursor-pointer"
              >
                Pakai Semen
              </button>
              <button
                type="button"
                onClick={() => handleProcessInput('Gimana posisi untung rugi sekarang?')}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400 transition-colors cursor-pointer"
              >
                Untung Rugi
              </button>
            </div>

            {/* Input Bar & Mic Trigger */}
            <form
              onSubmit={handleFormSubmit}
              className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
            >
              <button
                type="button"
                onClick={toggleListening}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-md ${
                  isListening
                    ? 'bg-rose-600 text-white animate-pulse ring-4 ring-rose-500/30 shadow-rose-600/30'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/25'
                }`}
                title={isListening ? 'Klik untuk berhenti mendengarkan' : 'Klik untuk bicara bahasa Indonesia'}
              >
                {isListening ? <MicOff className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
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
