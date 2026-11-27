import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  isGeminiAiAvailable,
  testGeminiConnection,
  processWithGemini
} from './geminiService';
import { AgentContextSnapshot } from './agentEngine';

const MOCK_CONTEXT: AgentContextSnapshot = {
  userRole: 'Clerk',
  userName: 'Islamiah',
  projectName: 'Proyek UDU Office',
  currentCashBalance: 15000000,
  totalStockAssetValue: 45000000,
  stockMutationsCount: 12,
  cashMutationsCount: 8,
  pendingApprovalCount: 2,
  canViewFinancials: true,
  items: [
    {
      id: 'item-1',
      kode_boq: 'M-01',
      nama_barang: 'Semen Gresik 50kg',
      kategori: 'Material Fisik',
      satuan: 'sak',
      qty_boq: 100,
      is_stock_item: true,
      has_stock_history: true,
      qty_tambahan_disetujui: 0,
      target_kebutuhan_total: 100,
      qty_masuk_total: 25,
      qty_keluar_total: 0,
      qty_pemenuhan_sisa: 75,
      progress_pemenuhan: 25,
      status_pemenuhan: 'Dalam pemenuhan',
      harga_satuan: 70000,
      stok_saat_ini: 25,
      stok_minimum: 10,
      status: 'Tersedia'
    },
    {
      id: 'item-2',
      kode_boq: 'M-02',
      nama_barang: 'Pasir Pasang',
      kategori: 'Material Fisik',
      satuan: 'rit',
      qty_boq: 10,
      is_stock_item: true,
      has_stock_history: true,
      qty_tambahan_disetujui: 0,
      target_kebutuhan_total: 10,
      qty_masuk_total: 0,
      qty_keluar_total: 0,
      qty_pemenuhan_sisa: 10,
      progress_pemenuhan: 0,
      status_pemenuhan: 'Belum dipenuhi',
      harga_satuan: 850000,
      stok_saat_ini: 0,
      stok_minimum: 2,
      status: 'Tidak Tersedia'
    }
  ]
};

test('1. geminiService key management and availability detection', () => {
  // Test fallback/empty state
  const initialAvail = isGeminiAiAvailable();
  assert.equal(typeof initialAvail, 'boolean');

  // Test set key
  setGeminiApiKey('AIzaSyTestValidKeyLengthMoreThanTwentyCharacters');
  assert.equal(getGeminiApiKey(), 'AIzaSyTestValidKeyLengthMoreThanTwentyCharacters');
  assert.equal(isGeminiAiAvailable(), true);

  // Clear key
  setGeminiApiKey('');
  assert.equal(isGeminiAiAvailable(), false);
});

test('2. testGeminiConnection rejects empty key with Indonesian guidance', async () => {
  const result = await testGeminiConnection('');
  assert.equal(result.success, false);
  assert.ok(result.message.includes('API Key Google Gemini belum dimasukkan'));
});

test('3. processWithGemini falls back seamlessly to local agent engine without error', async () => {
  // Tanpa key, harus tetap mengembalikan hasil terstruktur dari engine lokal
  setGeminiApiKey('');
  const res = await processWithGemini('cek saldo kas proyek', MOCK_CONTEXT);
  assert.equal(res.type, 'CHECK_CASH_BALANCE');
  assert.ok(/15\.000\.000/.test(res.spokenResponse));
});

test('4. processWithGemini protects Viewer from write intent even under Gemini processing', async () => {
  const viewerCtx = { ...MOCK_CONTEXT, userRole: 'Viewer/Pengamat', canViewFinancials: false };
  setGeminiApiKey('');
  const res = await processWithGemini('catat barang masuk semen 20 sak', viewerCtx);
  assert.equal(res.actionRequired, false);
  assert.ok(res.spokenResponse.toLowerCase().includes('baca-saja'));
});
