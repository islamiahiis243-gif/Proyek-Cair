import React from 'react';

const guideLines = "# Panduan Workspace Center — Proyek Cair\n\n**Pengguna:** akun yang sudah login ke Proyek Cair.\n**Batas status:** panduan ini menjelaskan fitur yang tersedia. Dokumen ini bukan bukti Company CV Menara Megah atau Project UDU telah diprovisioning.\n\n## 1. Membuka Workspace Center\n1. Login ke Proyek Cair menggunakan akun Google atau email yang sudah terdaftar.\n2. Pada sidebar pilih **Workspace & Personal Projects**.\n3. Halaman Workspace Center memuat pemilihan workspace, project operasional, Personal Projects, pendaftaran perusahaan, dan penebusan RFIN.\n4. Panel administrasi hanya tampil jika otoritas atau akses workspace dikonfirmasi server.\n\nWorkspace Center tidak otomatis memberi akses operasional. Hak akses tetap bergantung pada Company Membership, Project Membership, permission, authority, dan project scope yang ditentukan server.\n\n## 2. Workspace aktif\nDropdown **Workspace aktif** memilih konteks yang sedang digunakan:\n- **Personal Workspace** adalah ruang kerja pribadi milik identitas login.\n- **Company Workspace** adalah ruang kerja milik satu Company/Tenant dan hanya tersedia setelah akun memiliki akses sah.\n\nPergantian konteks dicatat ke audit log. Mengganti workspace tidak membuat membership, menaikkan role, memindahkan data, atau membuka akses modul dengan sendirinya.\nJika onboarding CV Menara Megah belum selesai, pengguna mungkin hanya melihat Personal Workspace. Ini kondisi yang wajar.\n\n## 3. Project operasional aktif\nDropdown **Project operasional aktif** hanya berisi Project yang dikembalikan resolver dan memiliki Project Membership aktif bagi pengguna di workspace terpilih.\n\nJika tampil pesan bahwa belum ada Project Membership aktif, akun belum ditugaskan pada Project aktif. Jangan membuat Personal Project sebagai pengganti Project operasional. Project operasional harus berada di Company Workspace dan memerlukan membership serta permission yang sesuai.\nPersonal Project tidak memberikan akses ke BOQ, stok, kas, dokumen, maupun data perusahaan.\n\n## 4. Personal Projects\nBagian ini muncul saat Personal Workspace dipilih. Fitur yang tersedia:\n- Membuat Personal Project dengan nama dan deskripsi opsional.\n- Mengubah nama Personal Project.\n- Mengarsipkan atau mengaktifkan kembali statusnya.\n- Menghapus Personal Project setelah konfirmasi.\n\nData Personal Project menggunakan RLS owner-only. Jangan menyimpan dataset operasional CV Menara Megah atau UDU di sini.\n\n## 5. Daftarkan perusahaan\nForm **Daftarkan perusahaan** adalah permohonan onboarding. Mengirim form tidak langsung membuat Company Workspace.\n\n| Field | Cara mengisi |\n|---|---|\n| Nama legal perusahaan | Isi sesuai dokumen legal. Untuk proses ini: **CV Menara Megah**. |\n| NPWP | Masukkan NPWP asli perusahaan, 15/16 digit sesuai dokumen resmi. Jangan gunakan NPWP pribadi, perkiraan, atau data uji. |\n| Email calon Company Super Admin | Gunakan email calon administrator yang ditetapkan SSOT: **menara.megah.cv@gmail.com**. |\n| Email perusahaan (opsional) | Gunakan email bisnis yang benar dan dapat diakses. Kosongkan bila belum tersedia. |\n| Deklarasi | Baca dan centang hanya jika pemohon berwenang, data legal/NPWP benar, email calon admin tepat, dan pemohon memahami bahwa pengajuan bukan verifikasi legal atau aktivasi tenant. |\n\nSetelah mengisi:\n1. Periksa kembali nama legal, NPWP, dan kedua email.\n2. Centang deklarasi hanya bila semua pernyataannya benar.\n3. Tekan **Kirim permohonan verifikasi** satu kali.\n4. Tunggu pesan bahwa permohonan telah dikirim. Jika jaringan lambat, periksa status bersama Platform Super Admin sebelum mengirim ulang.\n\n**Keamanan:** masukkan NPWP hanya melalui formulir resmi aplikasi setelah login. Jangan kirim NPWP melalui chat, email biasa, GitHub issue, screenshot, atau dokumen panduan.\n\n### Setelah permohonan dikirim\n- Status permohonan menunggu review Platform Super Admin.\n- Persetujuan menyiapkan Company, Company Workspace berstatus menunggu klaim, dan kursi Company Super Admin yang terikat ke email calon admin.\n- Persetujuan aplikasi bukan verifikasi legal oleh otoritas pemerintah atau pihak independen.\n- Platform Super Admin menerbitkan RFIN-A. Penerima harus login sendiri dan menebusnya.\n- Jangan membuat membership atau mengubah role secara manual untuk melewati proses claim.\n\n## 6. Menebus undangan RFIN\n- **RFIN-A** digunakan calon Company Super Admin untuk mengklaim kursi administrator yang dipesan bagi emailnya.\n- **RFIN-B** digunakan pengguna yang diundang untuk mengaktifkan Company Membership biasa sesuai penugasan.\n\nLangkah:\n1. Login menggunakan akun dengan email yang cocok dengan penerima undangan.\n2. Masukkan kode RFIN yang diberikan langsung oleh penerbit berwenang.\n3. Tekan **Tebus kode** satu kali.\n4. Jika sukses, aplikasi memperbarui konteks. Pilih Company Workspace yang tersedia.\n\nRFIN adalah credential rahasia. Jangan membagikannya, memasukkannya ke screenshot/tiket, atau menebus kode atas nama orang lain. UI menyebut batas 10 percobaan per 15 menit per akun; jika gagal, hindari percobaan berulang dan minta penerbit memeriksa statusnya.\n\n## 7. Tindakan Platform Super Admin\nPanel **Platform Super Admin · Verifikasi** hanya terlihat jika server mengonfirmasi otoritas Platform Super Admin.\n1. Periksa nama legal, empat digit terakhir NPWP, email calon Company Super Admin, dan bukti pendukung yang diwajibkan prosedur.\n2. Pilih terima setelah pemeriksaan selesai; atau tolak bila tidak memenuhi syarat.\n3. Setelah Company berstatus CLAIM_PENDING, terbitkan RFIN-A hanya untuk email penerima kursi yang benar.\n4. Salin kode yang ditampilkan dan sampaikan secara aman. Plaintext code tidak disimpan untuk dilihat ulang.\n\nPenerimaan aplikasi tidak menggantikan verifikasi legal independen. Keputusan harus mengikuti prosedur dan audit trail platform.\n\n## 8. Mengundang anggota Company dengan RFIN-B\n1. Masukkan email identitas orang yang memang berhak bergabung ke Company.\n2. Tekan **Terbitkan RFIN-B**.\n3. Sampaikan kode hanya kepada penerima yang benar melalui kanal aman.\n4. Penerima login sendiri dan menebus RFIN-B.\n\nRFIN-B tidak otomatis memberi akses lintas tenant/project. Company Super Admin tetap harus menetapkan persona, role, permission, authority, dan Project Membership sesuai least privilege serta separation of duties. Roster bukan pengganti User Identity atau Membership.\n\n## 9. Urutan onboarding CV Menara Megah → UDU → PT IMK\n1. Wakil berwenang mengajukan CV Menara Megah dengan NPWP asli dan email calon Company Super Admin yang telah ditetapkan.\n2. Platform Super Admin meninjau dan memutuskan permohonan.\n3. Penerima `menara.megah.cv@gmail.com` login sendiri dan menebus RFIN-A.\n4. Setelah Company Workspace aktif, Company Super Admin membuat canonical Project **UDU** di Company Workspace tersebut.\n5. Catat **PT IMK sebagai CLIENT relationship** pada Project UDU. PT IMK adalah client/pemberi kerja, bukan tenant kedua. Jangan membuat Company Workspace atau Company Membership PT IMK hanya karena status client.\n6. Tetapkan Project Membership dan permission untuk orang yang benar-benar ditugaskan.\n7. Lanjutkan pemeriksaan ledger, backfill terkontrol, RPC, RLS, dan pengujian isolasi sebelum operational scope gate dipertimbangkan.\n\nJangan membuat Project UDU di Personal Workspace. Jangan memetakan 1.440 baris ledger sebelum canonical IDs dan rencana rekonsiliasi disetujui.\n\n## 10. Pesan/kondisi umum\n| Kondisi | Makna/tindakan |\n|---|---|\n| Hanya Personal Workspace terlihat | Belum ada Company Workspace yang dapat diakses akun. Lanjutkan onboarding resmi bila berwenang. |\n| Tidak ada Project Membership aktif | Akun belum ditugaskan ke Project. Minta Company Super Admin meninjau assignment. |\n| Permohonan dikirim untuk verifikasi | Request menunggu review; Company belum aktif. |\n| Deklarasi wajib disetujui | Baca dan setujui hanya bila benar. |\n| NPWP pernah digunakan | Jangan mengubah digit untuk mengakali pemeriksaan; hubungi Platform Super Admin. |\n| RFIN gagal ditebus | Pastikan akun penerima benar dan minta penerbit memeriksa status kode. Hindari percobaan berulang. |\n| Workspace/Project tidak muncul | Refresh konteks atau login kembali; jika tetap tidak muncul, minta admin memeriksa membership/resolver. |\n\n## 11. Batasan fitur dan status provisioning\nWorkspace Center saat ini menyediakan pemilihan workspace, Personal Project CRUD, permohonan Company, review dan klaim RFIN, serta penerbitan undangan. Halaman ini belum menjadi UI lengkap untuk semua konfigurasi Company, Project, role, permission, workflow, dan authority.\n\nPanduan ini tidak menyatakan CV Menara Megah sudah aktif, Project UDU sudah dibuat, PT IMK sudah tercatat, ledger telah di-backfill, offline synchronization siap, atau operational scope gate aktif. Status aktual harus diperiksa dari database Production dan dokumen readiness.\n\n## 12. Referensi\n- [USERS_SSOT.md](../USERS_SSOT.md) — aturan identitas, tenant, workspace, membership, persona, role, permission, dan project scope.\n- [UDU Tenant / Project Cutover Readiness](../UDU_TENANT_PROJECT_CUTOVER_READINESS.md) — status cutover dan prasyarat operasional.\n- [Aplikasi Proyek Cair](https://proyekcair.vercel.app/) — akses aplikasi.\n\nJangan menaruh NPWP, RFIN, recovery share, password, access token, atau kredensial Supabase di dokumentasi, chat, issue, commit, atau screenshot.".split('\n');

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 text-sm dark:bg-slate-800">{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const external = /^https?:\/\//.test(link[2]);
      return <a key={index} href={link[2]} className="text-blue-600 underline dark:text-blue-400" {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{link[1]}</a>;
    }
    return part;
  });
}

export const WorkspaceCenterGuide: React.FC = () => {
  const content: React.ReactNode[] = [];
  let index = 0;

  while (index < guideLines.length) {
    const line = guideLines[index];

    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (index < guideLines.length && guideLines[index].startsWith('|')) {
        const cells = guideLines[index].split('|').slice(1, -1).map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      if (rows.length > 0) {
        const [header, ...body] = rows;
        content.push(
          <div key={index} className="my-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800"><tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">{renderInline(cell)}</th>)}</tr></thead>
              <tbody>{body.map((row, rowIndex) => <tr key={rowIndex} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-950 dark:even:bg-slate-900">{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">{renderInline(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith('# ')) { index += 1; continue; }
    if (line.startsWith('## ')) {
      content.push(<h2 key={index} className="mt-9 border-b border-slate-200 pb-2 text-xl font-bold dark:border-slate-800">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('### ')) {
      content.push(<h3 key={index} className="mt-6 text-lg font-semibold">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('- ')) {
      content.push(<li key={index} className="ml-5 list-disc py-1 leading-7">{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      content.push(<li key={index} className="ml-5 list-decimal py-1 leading-7">{renderInline(line.replace(/^\d+\. /, ''))}</li>);
    } else {
      content.push(<p key={index} className="my-3 leading-7">{renderInline(line)}</p>);
    }
    index += 1;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <article className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-8">
        <header className="mb-8 border-b border-slate-200 pb-5 dark:border-slate-800">
          <p className="text-xs font-semibold tracking-widest text-blue-500">PUSAT BANTUAN</p>
          <h1 className="mt-1 text-3xl font-bold">Panduan Workspace Center</h1>
          <p className="mt-2 text-sm text-slate-500">Panduan penggunaan identitas, workspace, project, registrasi perusahaan, dan undangan RFIN.</p>
        </header>
        <div className="max-w-none">{content}</div>
        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">Panduan Proyek Cair · Mengikuti USERS_SSOT.md</footer>
      </article>
    </main>
  );
};
