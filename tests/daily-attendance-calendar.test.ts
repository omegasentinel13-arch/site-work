import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('DAILY ATTENDANCE & CUSTOM CALENDAR VERIFICATION', () => {
  const dailyPath = path.join(process.cwd(), 'app', '(dashboard)', 'attendance', 'daily', 'page.tsx');
  const navPath = path.join(process.cwd(), 'components', 'layout', 'Navigation.tsx');
  const headerPath = path.join(process.cwd(), 'components', 'layout', 'Header.tsx');
  const rolesPagePath = path.join(process.cwd(), 'app', '(dashboard)', 'setup', 'roles', 'page.tsx');
  const datePickerPath = path.join(process.cwd(), 'components', 'ui', 'DatePicker.tsx');

  test('1. Daily Attendance Roles button exists beside PDF and Excel and links to /setup/roles', () => {
    const dailySrc = fs.readFileSync(dailyPath, 'utf8');
    
    // Check Roles button exists with ID and href
    assert.match(dailySrc, /id="daily-attendance-roles-btn"/, 'Roles button must have ID daily-attendance-roles-btn');
    assert.match(dailySrc, /href="\/setup\/roles"/, 'Roles button must link to /setup/roles');
    
    // Check placement order in action area: PDF -> Excel -> Roles -> Save Attendance
    const actionArea = dailySrc.substring(dailySrc.indexOf('Action Controls (PDF, Excel, Roles, Save Attendance)'));
    const pdfIndex = actionArea.indexOf('handleExportPDF');
    const excelIndex = actionArea.indexOf('<ExcelExportButton');
    const rolesIndex = actionArea.indexOf('daily-attendance-roles-btn');
    const saveIndex = actionArea.indexOf('handleSave');

    assert.ok(pdfIndex > 0, 'PDF button must exist');
    assert.ok(excelIndex > pdfIndex, 'Excel button must appear after PDF');
    assert.ok(rolesIndex > excelIndex, 'Roles button must appear after Excel');
    assert.ok(saveIndex > rolesIndex, 'Save button must appear after Roles');
  });

  test('2. Roles button satisfies visual and accessibility requirements', () => {
    const dailySrc = fs.readFileSync(dailyPath, 'utf8');
    const rolesBtnChunk = dailySrc.substring(
      dailySrc.indexOf('daily-attendance-roles-btn'),
      dailySrc.indexOf('daily-attendance-roles-btn') + 600
    );

    assert.match(rolesBtnChunk, /min-h-\[44px\]/, 'Must have >= 44px min-height');
    assert.match(rolesBtnChunk, /rounded-lg/, 'Must have consistent rounded corners');
    assert.match(rolesBtnChunk, /dark:bg-\[#202225\]/, 'Must have dark mode background');
    assert.match(rolesBtnChunk, /focus-visible:ring-2/, 'Must have visible focus ring');
    assert.match(rolesBtnChunk, /aria-label="Manage Roles"/, 'Must have accessible label');
  });

  test('3. User-facing "Roles & Rates" label is renamed to "Roles"', () => {
    const navSrc = fs.readFileSync(navPath, 'utf8');
    const headerSrc = fs.readFileSync(headerPath, 'utf8');
    const rolesPageSrc = fs.readFileSync(rolesPagePath, 'utf8');

    // Navigation.tsx
    assert.match(navSrc, /label:\s*'Roles',\s*href:\s*'\/setup\/roles'/, 'Navigation.tsx must display "Roles" for /setup/roles');
    assert.doesNotMatch(navSrc, /label:\s*'Roles & Rates'/, 'Navigation.tsx must not display "Roles & Rates"');

    // Header.tsx
    assert.match(headerSrc, /label:\s*'Roles',\s*href:\s*'\/setup\/roles'/, 'Header.tsx must display "Roles" for /setup/roles');
    assert.doesNotMatch(headerSrc, /label:\s*'Roles & Rates'/, 'Header.tsx must not display "Roles & Rates"');

    // Roles page heading
    assert.doesNotMatch(rolesPageSrc, /Work Categories, Roles &amp; Rates/, 'Roles page heading must not display "Roles & Rates"');
  });

  test('4. Native browser date-picker input is replaced with DatePicker component', () => {
    const dailySrc = fs.readFileSync(dailyPath, 'utf8');
    assert.doesNotMatch(dailySrc, /type="date"/, 'Native <input type="date"> must not exist in Daily Attendance');
    assert.match(dailySrc, /<DatePicker[\s\S]*id="daily-attendance-date-picker"/, 'DatePicker component must be rendered');
  });

  test('5. Global DatePicker component exists with required features', () => {
    const dpSrc = fs.readFileSync(datePickerPath, 'utf8');

    assert.ok(fs.existsSync(datePickerPath), 'DatePicker.tsx must exist');
    assert.match(dpSrc, /role="dialog"/, 'Calendar popup must have role="dialog"');
    assert.match(dpSrc, /aria-modal="true"/, 'Calendar popup must have aria-modal="true"');
    assert.match(dpSrc, /Escape/, 'Must handle Escape key to close');
    assert.match(dpSrc, /handleClickOutside/, 'Must handle outside click to close');
    assert.match(dpSrc, /shiftViewMonth/, 'Must have month shift functionality');
    assert.match(dpSrc, /Previous Month/, 'Must have Previous Month button');
    assert.match(dpSrc, /Next Month/, 'Must have Next Month button');
    assert.match(dpSrc, /Today/, 'Must have Today button');
    assert.match(dpSrc, /data-custom-calendar="site-work"/, 'Must tag custom calendar for testability');
    // Month and Year selector triggers
    assert.match(dpSrc, /month-select-btn/, 'Must have interactive Month selector trigger');
    assert.match(dpSrc, /year-select-btn/, 'Must have interactive Year selector trigger');
    assert.match(dpSrc, /Choose Month/, 'Must render Month selection view');
    assert.match(dpSrc, /Choose Year/, 'Must render Year selection view');
  });

  test('6. Other pages date-selection controls migrated to DatePicker', () => {
    const financePath = path.join(process.cwd(), 'app', '(dashboard)', 'finance', 'page.tsx');
    const exportPath = path.join(process.cwd(), 'components', 'export', 'CompleteExportSection.tsx');
    const backupPath = path.join(process.cwd(), 'components', 'backup', 'BackupCreateCard.tsx');

    const finSrc = fs.readFileSync(financePath, 'utf8');
    const expSrc = fs.readFileSync(exportPath, 'utf8');
    const bacSrc = fs.readFileSync(backupPath, 'utf8');

    assert.doesNotMatch(finSrc, /type="date"/, 'Finance page must not use native date input');
    assert.doesNotMatch(expSrc, /type="date"/, 'CompleteExportSection must not use native date input');
    assert.doesNotMatch(bacSrc, /type="date"/, 'BackupCreateCard must not use native date input');

    assert.match(finSrc, /<DatePicker[\s\S]*id="transaction-date-picker"/, 'Finance page uses DatePicker');
    assert.match(expSrc, /<DatePicker[\s\S]*id="custom-from-date"/, 'CompleteExportSection uses DatePicker');
    assert.match(bacSrc, /<DatePicker[\s\S]*aria-label="Backup Range From Date"/, 'BackupCreateCard uses DatePicker');
  });
});
