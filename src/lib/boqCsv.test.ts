import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoqCsv, parseBoqCsv } from './boqCsv';

const header = 'row_type,level,parent_source_row,node_code,boq_code,description,quantity,uom,unit_rate,remarks,is_stock_item,source_excel_row,source_color,source_total_price,category';

test('rejects empty files and missing required columns', () => {
  assert.match(parseBoqCsv('').errors[0], /kosong/i);
  assert.match(parseBoqCsv('row_type,description\nITEM,A').errors[0], /Kolom wajib/i);
});

test('parses quoted commas, escaped quotes, embedded newlines and UTF-8 BOM', () => {
  const csv = '\uFEFF' + header + '\r\n' +
    'ITEM,4,,,"A-01","Pipa, PVC ""AW""\nkelas AW",1,btg,"12,500",catatan,true,8,,,Material';
  const result = parseBoqCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].description, 'Pipa, PVC "AW"\nkelas AW');
  assert.equal(result.items[0].unit_rate, 12500);
  assert.equal(result.items[0].is_stock_item, true);
});

test('rejects invalid and non-finite numeric quantities and rates', () => {
  const item = (code: string, description: string, quantity: string, rate: string, row: string) =>
    ['ITEM','4','','',code,description,quantity,'zak',rate,'','',row,'','','Material'].join(',');
  const csv = header + '\n' +
    item('A-01','Semen','abc','10','4') + '\n' +
    item('A-02','Besi','2','Infinity','5');
  const result = parseBoqCsv(csv);
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every(error => /Qty\/harga\/induk bukan angka valid/.test(error)));
});

test('rejects incomplete sections, unsupported row types and duplicate BOQ codes', () => {
  const section = ['SECTION','4','','S-1','','','1','','','','','10','FFFFFF','','',''].join(',');
  const unsupported = ['OTHER','4','','','','Unknown','','','','','','11','','','',''].join(',');
  const item = (description: string) => ['ITEM','4','','','DUP',description,'1','unit','2','','','12','','','Material'].join(',');
  const csv = [header, section, unsupported, item('Item A'), item('Item B')].join('\n');
  const result = parseBoqCsv(csv);
  assert.equal(result.sections.length, 0);
  assert.equal(result.items.length, 2);
  assert.ok(result.errors.some(error => /data kelompok tidak lengkap/.test(error)));
  assert.ok(result.errors.some(error => /row_type harus SECTION atau ITEM/.test(error)));
  assert.ok(result.errors.some(error => /kode BOQ duplikat/.test(error)));
});

test('rejects malformed section totals, parent references and non-finite source row numbers', () => {
  const section = ['SECTION','1','','A','','Pekerjaan', 'Infinity','m2','','','','10','FFFFFF','abc',''].join(',');
  const badItem = ['ITEM','4','not-a-row','','A-01','Semen','1','zak','10','','','Infinity','','','Material'].join(',');
  const csv = [header, section, badItem].join('\n');
  const result = parseBoqCsv(csv);
  assert.equal(result.sections.length, 0);
  assert.equal(result.items.length, 0);
  assert.ok(result.errors.some(error => /nomor baris\/Qty\/harga kelompok bukan angka valid/.test(error)));
  assert.ok(result.errors.some(error => /baris Excel wajib/.test(error)));
});

test('round-trips section hierarchy and BOQ items through the project CSV contract', () => {
  const sections = [
    { id: 's1', source_row: 10, level: 1, parent_id: null, node_code: 'A', description: 'Pekerjaan Persiapan', source_qty: null, source_uom: null, source_color: 'FFFFFF', source_total_price: null },
    { id: 's2', source_row: 11, level: 2, parent_id: 's1', node_code: 'A.1', description: 'Mobilisasi, alat', source_qty: null, source_uom: null, source_color: 'EEEEEE', source_total_price: null }
  ];
  const items = [
    { parent_section_id: 's2', kode_boq: 'A.1.1', nama_barang: 'Semen "PCC"', source_qty: 3, source_uom: 'zak', harga_satuan: 65000, keterangan: 'Untuk, struktur', is_stock_item: true, source_excel_row: 12, kategori: 'Material' }
  ];
  const result = parseBoqCsv(makeBoqCsv(sections, items));
  assert.deepEqual(result.errors, []);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[1].parent_source_row, 10);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].parent_source_row, 11);
  assert.equal(result.items[0].description, 'Semen "PCC"');
  assert.equal(result.items[0].remarks, 'Untuk, struktur');
});
