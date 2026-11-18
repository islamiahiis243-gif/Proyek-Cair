const fs = require('fs');

const csvPath = 'supabase/seed/boq_trainer_udu_office_sheet1.csv';
const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');

const projectId = '2506245e-ff3f-4313-b821-920ab368a5df';
const workspaceId = '50e273d9-735a-4f75-8204-badab2929f3a';

const values = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const matches = line.match(/(?:[^\",]+|\"[^\"]*\")+/g);
  if (!matches || matches.length < 9) continue;
  
  const source_sheet = matches[0].replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const source_row = parseInt(matches[1].replace(/^\"|\"$/g, '')) || 0;
  const boq_code = matches[2].replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const category = matches[4].replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const description = matches[5].replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const quantity = parseFloat(matches[6].replace(/^\"|\"$/g, '')) || 0;
  const uom = matches[7].replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const unit_rate = parseFloat(matches[8].replace(/^\"|\"$/g, '')) || 0;
  const remarks = (matches[10] || '').replace(/^\"|\"$/g, '').replace(/'/g, "''");
  const is_stock_item = !category.toLowerCase().startsWith('iv.');

  values.push(`('${workspaceId}', '${projectId}', '${boq_code}', '${description}', '${category}', ${quantity}, '${uom}', ${unit_rate}, '${remarks}', '${source_sheet}', ${source_row}, ${is_stock_item})`);
}

const mid = Math.ceil(values.length / 2);
const part1 = values.slice(0, mid);
const part2 = values.slice(mid);

const sqlHeader = `INSERT INTO public.boq_items (workspace_id, project_id, boq_code, description, category, quantity, uom, unit_rate, remarks, source_sheet, source_row, is_stock_item) VALUES \n`;
const sqlFooter = `\nON CONFLICT (boq_code) DO NOTHING;`;

fs.writeFileSync('supabase/seed/boq_part1.sql', sqlHeader + part1.join(',\n') + sqlFooter);
fs.writeFileSync('supabase/seed/boq_part2.sql', sqlHeader + part2.join(',\n') + sqlFooter);
console.log('Split into Part 1 (' + part1.length + ') and Part 2 (' + part2.length + ')');
