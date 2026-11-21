export type AvailabilityStatus = 'Belum Dicatat' | 'Tersedia' | 'Stok Menipis' | 'Tidak Tersedia';

export type AppMode = 'PERSONAL' | 'IMPERSONATE' | 'CSA' | 'PSA';
export type ImpersonateRole = 'Clerk' | 'Foreman' | 'Spv.' | 'Dept. Manager' | 'KTT/Proj. Manager' | 'CEO/Direktur' | 'Viewer/Pengamat';
export type StatusDokumenWorkflow = 'DRAFT' | 'DITERBITKAN' | 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI' | 'BATAL' | 'DIGANTI';

export interface ItemBarang {
  parent_section_id?: string | null;
  source_excel_row?: number | null;
  source_qty?: number | null;
  source_uom?: string | null;
  id: string;
  kode_boq: string;
  source_sheet?: string;
  source_row?: number;
  nama_barang: string;
  kategori: string;
  satuan: string;
  qty_boq: number;
  is_stock_item: boolean;
  has_stock_history: boolean;
  qty_tambahan_disetujui: number;
  target_kebutuhan_total: number;
  qty_masuk_total: number;
  qty_keluar_total: number;
  qty_pemenuhan_sisa: number;
  total_boq_material_gabungan?: number;
  jumlah_pos_material_gabungan?: number;
  sisa_belum_tiba_gudang?: number;
  progress_pemenuhan: number;
  status_pemenuhan: 'Belum dipenuhi' | 'Dalam pemenuhan' | 'Terpenuhi' | 'Melebihi BOQ';
  harga_satuan: number;
  stok_saat_ini: number;
  stok_minimum: number;
  status: AvailabilityStatus;
  terakhir_mutasi?: string;
  keterangan?: string;
}

export interface PhysicalBudgetLine {
  id: string;
  kode_boq: string;
  kategori: string;
  qty_boq: number;
  qty_keluar_total: number;
  sisa_anggaran: number;
  keterangan?: string;
}

export interface PhysicalMaterialItem {
  id: string; // ID item primer (untuk referensi transaksi masuk)
  nama_barang: string;
  satuan: string;
  stok_fisik: number;
  total_qty_boq: number;
  total_qty_masuk: number;
  total_qty_keluar: number;
  is_stock_item: boolean;
  budget_lines: PhysicalBudgetLine[];
}

export type JenisMutasiBarang = 'MASUK' | 'KELUAR';
export type BebanBiaya = 'PROYEK_BOQ' | 'OPERASIONAL' | 'KLIEN' | 'BONUS_KLIEN' | 'KONTRAKTOR';
export type AsalBarang = 'KONTRAKTOR' | 'KLIEN' | 'TOKO_BEBAS';
export type TujuanPengeluaran = 'PROYEK_BOQ' | 'OPERASIONAL' | 'PERMINTAAN_KLIEN' | 'BONUS_KLIEN';

export interface MutasiBarang {
  id: string;
  barang_id: string;
  nama_barang: string;
  jenis: JenisMutasiBarang;
  jumlah: number;
  satuan: string;
  tujuan_keperluan: string; // misal: "Pengecoran sloof 6x8", "Pemasangan kabel ruang rapat"
  pic_penerima_penyerah: string;
  nomor_surat_jalan?: string;
  tanggal: string; // ISO String
  stok_sebelum: number;
  stok_sesudah: number;
  catatan?: string;
  source_name?: string;
  destination_name?: string;
  recipient_name?: string;
  owner_type?: 'KONTRAKTOR'|'IMK'|'KLIEN';
  purpose?: string;
  beban_biaya?: BebanBiaya;
  asal_barang?: AsalBarang;
  is_custom_item?: boolean;
  addition_id?: string;
  created_by_name?: string;
  status_dokumen?: StatusDokumenWorkflow;
  diperiksa_oleh?: string;
  disetujui_oleh?: string;
  mengetahui_oleh?: string;
  tte_qr_code?: string;
  is_batal?: boolean;
  is_ganti?: boolean;
  referensi_ganti_id?: string;
  alasan_batal_ganti?: string;
  harga_satuan_beli?: number;
  status_harga?: 'TERCATAT' | 'BELUM_DIKETAHUI' | 'NOTA_MENYUSUL' | 'JATAH_KLIEN';
}

export type JenisMutasiKas = 'MASUK' | 'KELUAR';

export interface MutasiKas {
  id: string;
  jenis: JenisMutasiKas; // IN / OUT
  jumlah_rp: number;
  untuk_apa: string; // Uraian peruntukan / alasan kas
  kategori_keperluan: 'Material' | 'Upah & Konsumsi' | 'Operasional' | 'Sewa Alat & Angkut' | 'Dana Termin Proyek' | 'Lainnya';
  pic: string;
  nomor_kuitansi?: string;
  tanggal: string; // ISO String
  saldo_setelah: number; // Running balance
  catatan?: string;
  status_dokumen?: StatusDokumenWorkflow;
  diperiksa_oleh?: string;
  disetujui_oleh?: string;
  mengetahui_oleh?: string;
  tte_qr_code?: string;
  is_batal?: boolean;
  is_ganti?: boolean;
  referensi_ganti_id?: string;
  alasan_batal_ganti?: string;
  harga_satuan_beli?: number;
  status_harga?: 'TERCATAT' | 'BELUM_DIKETAHUI' | 'NOTA_MENYUSUL' | 'JATAH_KLIEN';
}

export interface DokumenLaporan {
  id: string; // document_no legacy key used by the internal checksum route
  judul: string;
  jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'GABUNGAN_PROYEK';
  status: string;
  periode_awal: string;
  periode_akhir: string;
  dibuat_pada: string;
  penandatangan_nama: string;
  penandatangan_jabatan: string;
  penandatangan_email: string;
  hash_keamanan: string;
  total_transaksi: number;
  ringkasan_nilai_rp: number;
  qr_payload: string;
  verification_token?: string;
  snapshot_json?: string;
  // Raw scoped documents fields retained for ReportsView and lifecycle-aware verification.
  document_no?: string;
  title?: string;
  document_type?: string;
  created_at?: string;
  issued_at?: string | null;
  revision_number?: number;
  lifecycle_status?: string;
  revoked_at?: string | null;
  replaces_document_id?: string | null;
  replaced_by_document_id?: string | null;
  content_sha256?: string | null;
  signer_name?: string | null;
  signer_role?: string | null;
  approval_level?: string | null;
  workspace_id?: string;
  project_id?: string;
  db_id?: string;
  status_dokumen?: StatusDokumenWorkflow;
  diperiksa_oleh?: string;
  disetujui_oleh?: string;
  mengetahui_oleh?: string;
  tte_qr_code?: string;
  is_batal?: boolean;
  is_ganti?: boolean;
  referensi_ganti_id?: string;
  alasan_batal_ganti?: string;
  harga_satuan_beli?: number;
  status_harga?: 'TERCATAT' | 'BELUM_DIKETAHUI' | 'NOTA_MENYUSUL' | 'JATAH_KLIEN';
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  role: string;
  provider: 'google' | 'guest';
  personalWorkspaceId?: string;
  workspaceType?: 'PERSONAL' | 'COMPANY';
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
  lastSynced?: string;
}

export interface BoqSection {
  id:string; source_sheet:string; source_row:number; node_code:string; description:string; level:1|2|3; parent_id:string|null; sort_order:number; source_color:string; source_qty:number|null; source_uom:string|null; source_total_price:number|null; calculated_total_price:number; quantities_by_uom:Record<string,number>; item_count:number; source_total_variance:number; imk_total_price?:number;
}

export interface TenantBranding {
  contractorName: string;
  contractorNpwp: string;
  contractorAddress?: string;
  contractorContact?: string;
  contractorLogoUrl?: string;
  clientName: string;
  clientLogoUrl?: string;
  projectName: string;
  projectCode: string;
  directorName: string;
  directorEmail: string;
}
