export function formatRupiahInput(value: number | null | undefined): string {
  if (value == null || isNaN(value) || value === 0) return '';
  return Math.round(value).toLocaleString('id-ID');
}

export function parseRupiahInput(str: string): number {
  if (!str) return 0;
  const digits = str.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export function formatQtyInput(value: number | null | undefined): string {
  if (value == null || isNaN(value) || value === 0) return '';
  if (Number.isInteger(value)) {
    return value.toLocaleString('id-ID');
  }
  return value.toLocaleString('id-ID', { maximumFractionDigits: 4 });
}

export function parseQtyInput(str: string): number {
  if (!str) return 0;
  const sanitized = str.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(sanitized);
  return isNaN(num) ? 0 : num;
}

const satuanKata = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];

function konversiRatusan(n: number): string {
  let hasil = '';
  if (n >= 100) {
    if (Math.floor(n / 100) === 1) {
      hasil += 'Seratus ';
    } else {
      hasil += satuanKata[Math.floor(n / 100)] + ' Ratus ';
    }
    n %= 100;
  }

  if (n >= 20) {
    hasil += satuanKata[Math.floor(n / 10)] + ' Puluh ';
    n %= 10;
  } else if (n >= 12) {
    hasil += satuanKata[n - 10] + ' Belas ';
    n = 0;
  } else if (n === 11) {
    hasil += 'Sebelas ';
    n = 0;
  } else if (n === 10) {
    hasil += 'Sepuluh ';
    n = 0;
  }

  if (n >= 1) {
    hasil += satuanKata[n] + ' ';
  }

  return hasil.trim();
}

export function terbilangRupiah(nominal: number | null | undefined): string {
  if (nominal == null || isNaN(nominal) || nominal <= 0) return '';
  const n = Math.round(nominal);
  if (n === 0) return 'Nol Rupiah';

  const triliun = Math.floor(n / 1_000_000_000_000);
  const milyar = Math.floor((n % 1_000_000_000_000) / 1_000_000_000);
  const juta = Math.floor((n % 1_000_000_000) / 1_000_000);
  const ribu = Math.floor((n % 1_000_000) / 1_000);
  const sisa = n % 1_000;

  let bagian: string[] = [];

  if (triliun > 0) bagian.push(konversiRatusan(triliun) + ' Triliun');
  if (milyar > 0) bagian.push(konversiRatusan(milyar) + ' Miliar');
  if (juta > 0) bagian.push(konversiRatusan(juta) + ' Juta');
  if (ribu > 0) {
    if (ribu === 1 && triliun === 0 && milyar === 0 && juta === 0) {
      bagian.push('Seribu');
    } else {
      bagian.push(konversiRatusan(ribu) + ' Ribu');
    }
  }
  if (sisa > 0) bagian.push(konversiRatusan(sisa));

  return bagian.join(' ').replace(/\s+/g, ' ').trim() + ' Rupiah';
}
