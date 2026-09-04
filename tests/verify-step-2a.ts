import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  createExcelJsWorkbook,
  writeExcelJsWorkbookToBuffer,
  applyExcelJsTitleBanner,
  applyExcelJsMetadataBlock,
  applyExcelJsKpiStrip,
  applyExcelJsTableHeader,
  applyExcelJsDataRow,
  applyExcelJsGrandTotalRow,
  configureExcelJsWorksheet,
  EXCEL_THEME,
  EXCEL_STYLES,
  EXCEL_FORMATS,
  escapeExcelFormula,
} from '../lib/export/excel';

export async function verifyStep2aFoundation() {
  console.log('================================================================');
  console.log('PHASE 5 STEP 2A: EXCELJS FOUNDATION & OPENXML PROOF');
  console.log('================================================================\n');

  // 1. Build controlled test workbook using all shared foundation primitives
  const wb = createExcelJsWorkbook('SITE WORK Release QA Engine');
  const ws = wb.addWorksheet('Foundation Audit');

  // Title Banner (Row 1-2)
  applyExcelJsTitleBanner(
    ws,
    'Daily Operations Executive Audit',
    'Site: Sunrise Commercial Hub (SCH-01) | Date: 2026-09-04',
    6
  );

  // Metadata Block (Row 3-5)
  const metaEndRow = applyExcelJsMetadataBlock(
    ws,
    3,
    {
      siteName: 'Sunrise Commercial Hub',
      siteCode: 'SCH-01',
      reportTitle: 'Daily Operations',
      periodLabel: '2026-09-04',
      generatedAt: '04/09/2026, 04:00:00 pm',
    },
    6
  );

  // KPI Strip (Row 6)
  const kpiRow = metaEndRow;
  applyExcelJsKpiStrip(
    ws,
    kpiRow,
    [
      { label: 'Total Workers', value: 24 },
      { label: 'Worker-Days', value: 21.5 },
      { label: 'Net Labour Outlay', value: 'Rs. 19,250.00' },
    ],
    6
  );

  // Table Headers (Row 7)
  const headerRow = kpiRow + 1;
  const columns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Work Category', width: 22, align: 'left' },
    { header: 'Role Description', width: 28, align: 'left' },
    { header: 'Daily Rate (INR)', width: 18, align: 'right' },
    { header: 'Worker-Days', width: 14, align: 'center' },
    { header: 'Adjustment (INR)', width: 18, align: 'right' },
    { header: 'Line Cost (INR)', width: 22, align: 'right' },
  ];
  applyExcelJsTableHeader(ws, headerRow, columns);

  // Data Rows (Rows 8, 9, 10 - at least 3 rows with alternating zebra fills)
  const data = [
    {
      category: 'Civil Works',
      role: escapeExcelFormula('=SUM(DangerousInjection)') as string, // formula injection test
      rate: 950.0,
      workerDays: 8.0,
      adj: -500.0, // genuine negative numeric test
      cost: 7100.0,
    },
    {
      category: 'Civil Works',
      role: 'Mason Assistant',
      rate: 650.0,
      workerDays: 6.5,
      adj: -250.5, // genuine negative decimal
      cost: 3974.5,
    },
    {
      category: 'Electrical',
      role: 'Master Electrician',
      rate: 1100.0,
      workerDays: 7.0,
      adj: 0.0,
      cost: 7700.0,
    },
  ];

  data.forEach((item, idx) => {
    const rIdx = headerRow + 1 + idx;
    const row = ws.getRow(rIdx);
    row.values = [item.category, item.role, item.rate, item.workerDays, item.adj, item.cost];

    // Formats
    row.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
    row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
    row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY; // formatted currency for negative number
    row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsDataRow(row, idx % 2 === 1, ['left', 'left', 'right', 'center', 'right', 'right']);
  });

  // Grand Total Row (Row 11)
  const totalRowIdx = headerRow + 1 + data.length;
  const totalRow = ws.getRow(totalRowIdx);
  totalRow.getCell(1).value = 'GRAND TOTAL';
  totalRow.getCell(2).value = '';
  totalRow.getCell(3).value = '';
  totalRow.getCell(4).value = { formula: `SUM(D${headerRow + 1}:D${totalRowIdx - 1})`, result: 21.5 };
  totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
  totalRow.getCell(5).value = { formula: `SUM(E${headerRow + 1}:E${totalRowIdx - 1})`, result: -750.5 };
  totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
  totalRow.getCell(6).value = { formula: `SUM(F${headerRow + 1}:F${totalRowIdx - 1})`, result: 18774.5 };
  totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

  applyExcelJsGrandTotalRow(totalRow, ['left', 'left', 'right', 'center', 'right', 'right']);

  // Configure Worksheet Views, Freeze Panes, AutoFilter, A4 Print Setup, Repeating Headers
  configureExcelJsWorksheet(ws, {
    orientation: 'portrait',
    freezeRow: headerRow,
    autoFilterRange: `A${headerRow}:F${totalRowIdx - 1}`,
    repeatHeaderRow: headerRow,
    reportTitle: 'Daily Operations Executive Audit',
  });

  // Write workbook to buffer
  const buf = await writeExcelJsWorkbookToBuffer(wb);

  console.log('1. BUFFER CREATION:');
  console.log(`   - Generated Buffer Size: ${buf.length.toLocaleString()} bytes`);
  console.log(`   - ZIP Magic Bytes (PK\\x03\\x04): [${buf[0].toString(16)}, ${buf[1].toString(16)}, ${buf[2].toString(16)}, ${buf[3].toString(16)}]`);
  assert.ok(buf.length > 5000, 'Buffer must be valid non-empty OpenXML archive');
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
  assert.equal(buf[2], 0x03);
  assert.equal(buf[3], 0x04);
  console.log('   ✔ OpenXML ZIP buffer valid.\n');

  // 2. Direct OpenXML Zip Inspection
  const parsedZip = XLSX.read(buf, { type: 'buffer', bookFiles: true });
  const files = parsedZip.files || {};
  console.log('2. DIRECT OPENXML PACKAGE AUDIT:');
  console.log('   Discovered OpenXML Parts:', Object.keys(files).filter(f => f.length > 0));

  // A. Audit xl/styles.xml for real Fonts, Fills, Borders, XFs
  const stylesXml = files['xl/styles.xml']?.content?.toString('utf8') || '';
  console.log('\n   A. STYLES AUDIT (xl/styles.xml):');
  assert.ok(stylesXml.length > 0, 'xl/styles.xml must exist');

  const hasPrimaryFill = stylesXml.includes('0F172A');
  const hasZebraFill = stylesXml.includes('F8FAFC');
  const hasSubheadFill = stylesXml.includes('F1F5F9');
  const hasTotalFill = stylesXml.includes('E2E8F0');
  const hasWhiteFont = stylesXml.includes('FFFFFFFF') || stylesXml.includes('FFFFFF');
  const hasDoubleBorder = stylesXml.includes('double');

  console.log(`      - Slate 900 Fill (#0F172A): ${hasPrimaryFill ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Zebra Row Fill (#F8FAFC): ${hasZebraFill ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Subhead / KPI Fill (#F1F5F9): ${hasSubheadFill ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Total Fill (#E2E8F0): ${hasTotalFill ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - White Header Font: ${hasWhiteFont ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Double Bottom Accounting Border: ${hasDoubleBorder ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);

  assert.ok(hasPrimaryFill, 'Must contain primary brand fill');
  assert.ok(hasZebraFill, 'Must contain zebra row fill');
  assert.ok(hasSubheadFill, 'Must contain subhead fill');
  assert.ok(hasTotalFill, 'Must contain total fill');
  assert.ok(hasWhiteFont, 'Must contain white font');
  assert.ok(hasDoubleBorder, 'Must contain double bottom accounting border');

  // B. Audit xl/worksheets/sheet1.xml for Merges, Freeze Panes, AutoFilter, Row Heights, PageSetup
  const sheetXml = files['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';
  console.log('\n   B. WORKSHEET AUDIT (xl/worksheets/sheet1.xml):');
  assert.ok(sheetXml.length > 0, 'xl/worksheets/sheet1.xml must exist');

  const hasMergedTitle = sheetXml.includes('ref="A1:F1"') || sheetXml.includes('ref="A1:F2"') || sheetXml.includes('<mergeCell ref="A1:F1"/>');
  const hasMergedKpi = sheetXml.includes(`ref="A${kpiRow}:F${kpiRow}"`);
  const hasFreezePane = sheetXml.includes(`ySplit="${headerRow}"`) || sheetXml.includes('state="frozen"');
  const hasAutoFilter = sheetXml.includes(`ref="A${headerRow}:F`);
  const hasCustomRowHeights = sheetXml.includes('customHeight="1"') || sheetXml.includes('ht="34"');
  const hasA4Paper = sheetXml.includes('paperSize="9"');
  const hasPortraitOrientation = sheetXml.includes('orientation="portrait"');
  const hasHeaderFooter = sheetXml.includes('<headerFooter') || sheetXml.includes('&amp;P');

  console.log(`      - Merged Title Banner (A1:F1): ${hasMergedTitle ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Merged KPI Strip (A6:F6): ${hasMergedKpi ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Functional Freeze Panes (ySplit=${headerRow}): ${hasFreezePane ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - AutoFilter Range: ${hasAutoFilter ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Custom Row Heights: ${hasCustomRowHeights ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - A4 Paper Size (paperSize="9"): ${hasA4Paper ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Portrait Print Orientation: ${hasPortraitOrientation ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  console.log(`      - Header / Footer Configuration: ${hasHeaderFooter ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);

  assert.ok(hasMergedTitle, 'Must contain merged title banner');
  assert.ok(hasMergedKpi, 'Must contain merged KPI strip');
  assert.ok(hasFreezePane, 'Must contain OpenXML frozen pane');
  assert.ok(hasAutoFilter, 'Must contain OpenXML autoFilter');
  assert.ok(hasCustomRowHeights, 'Must contain custom row heights');
  assert.ok(hasA4Paper, 'Must contain A4 paper size');
  assert.ok(hasPortraitOrientation, 'Must contain portrait orientation');

  // C. Audit xl/workbook.xml for Repeating Print Titles
  const workbookXml = files['xl/workbook.xml']?.content?.toString('utf8') || '';
  console.log('\n   C. WORKBOOK PRINT TITLES AUDIT (xl/workbook.xml):');
  const hasPrintTitles = workbookXml.includes('_xlnm.Print_Titles') || workbookXml.includes(`$${headerRow}:$${headerRow}`);
  console.log(`      - Repeating Header Row for Print (_xlnm.Print_Titles): ${hasPrintTitles ? 'FOUND (PASS)' : 'MISSING (FAIL)'}`);
  assert.ok(hasPrintTitles, 'Must contain repeating print title rows');

  // D. Verify SheetJS Parser AST Compatibility & Security
  console.log('\n3. PARSER & SECURITY COMPATIBILITY:');
  const sheetJsWb = XLSX.read(buf, { type: 'buffer' });
  const sheetJsWs = sheetJsWb.Sheets['Foundation Audit'];
  assert.ok(sheetJsWs, 'SheetJS must parse worksheet seamlessly');

  // Cell values check (first data row is at headerRow + 1)
  const firstDataRow = headerRow + 1;
  const cellInjection = sheetJsWs[`B${firstDataRow}`];
  const cellNegative = sheetJsWs[`E${firstDataRow}`];
  console.log(`      - Formula Injected Cell: value="${cellInjection?.v}" (Escaped: ${cellInjection?.v?.startsWith("'") ? 'PASS' : 'FAIL'})`);
  console.log(`      - Negative Numeric Cell: value=${cellNegative?.v}, type="${cellNegative?.t}" (Numeric: ${cellNegative?.t === 'n' ? 'PASS' : 'FAIL'})`);
  assert.ok(cellInjection?.v?.startsWith("'"), 'Formula injection must be safely escaped');
  assert.equal(cellNegative?.t, 'n', 'Negative numeric cell must remain number type');
  assert.equal(cellNegative?.v, -500, 'Negative numeric value must match exactly');

  console.log('\n================================================================');
  console.log('EXCELJS FOUNDATION & OPENXML PROOF: ALL GATES PASS');
  console.log('================================================================\n');
}

if (require.main === module) {
  verifyStep2aFoundation().catch((err) => {
    console.error('FATAL VERIFICATION ERROR:', err);
    process.exit(1);
  });
}
