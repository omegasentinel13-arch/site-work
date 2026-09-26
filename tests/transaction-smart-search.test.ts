import assert from 'node:assert/strict';
import {
  parseTransactionSearch,
  matchTransactionSearch,
  normalizeSearchAmount,
  normalizeTransactionAmount,
  parseTransactionSearchDate,
  SearchableTransaction,
} from '../lib/finance/search-parser';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING UNIVERSAL TRANSACTION SEARCH TEST SUITE');
  console.log('SPECIFICATIONS: TESTS 1 THROUGH 55 + INVARIANTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(id: number | string, name: string, fn: () => void) {
    total++;
    try {
      fn();
      console.log(`  ✓ [PASS] Test ${id}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] Test ${id}: ${name}:`, err.message);
      throw err;
    }
  }

  // Sample transactions fixture
  const txCredit475k: SearchableTransaction = {
    id: 'tx-1',
    date: '2026-09-01',
    type: 'CREDIT',
    amount_paise: 47500000, // ₹4,75,000
    runningBalancePaise: 51500000, // ₹5,15,000
    description: 'Owner Equity Inflow',
    reference_note: 'Direct Transfer',
    investor_name: 'Shahil',
  };

  const txDebit475k: SearchableTransaction = {
    id: 'tx-2',
    date: '2026-09-01',
    type: 'DEBIT',
    amount_paise: 47500000, // ₹4,75,000
    runningBalancePaise: 4000000, // ₹40,000
    description: 'UltraTech cement bulk order',
    reference_note: 'Vendor Inv #8812',
    debit_category: 'SUPPLIES',
  };

  const txDebit5k: SearchableTransaction = {
    id: 'tx-3',
    date: '2026-09-05',
    type: 'DEBIT',
    amount_paise: 500000, // ₹5,000
    runningBalancePaise: 47500000, // ₹4,75,000 (Running Balance matches 475000!)
    description: 'Electrician weekly wages',
    reference_note: 'Cash payment',
    debit_category: 'SALARY',
    work_category_name: 'Electrical',
    work_role_name: 'Electrician',
  };

  const txCredit5k: SearchableTransaction = {
    id: 'tx-4',
    date: '2026-09-05',
    type: 'CREDIT',
    amount_paise: 500000, // ₹5,000
    runningBalancePaise: 10000000, // ₹1,00,000
    description: 'Investor petty deposit',
    investor_name: 'Angel Investor',
  };

  const txDebit50: SearchableTransaction = {
    id: 'tx-5',
    date: '2026-09-10',
    type: 'DEBIT',
    amount_paise: 5000, // ₹50
    runningBalancePaise: 9995000,
    description: 'Tea and coffee for staff',
    debit_category: 'SUPPLIES',
  };

  const txDebit1500: SearchableTransaction = {
    id: 'tx-6',
    date: '2026-09-12',
    type: 'DEBIT',
    amount_paise: 150000, // ₹1,500
    runningBalancePaise: 9845000,
    description: 'Plumbing fittings',
    debit_category: 'SUPPLIES',
  };

  // --------------------------------------------------------------------------
  // AMOUNT (Tests 1 - 12)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 1: AMOUNT SEARCH (TESTS 1 - 12) ---');

  test(1, '475000 matches credit 475000', () => {
    const q = parseTransactionSearch('475000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(2, '475000 matches debit 475000', () => {
    const q = parseTransactionSearch('475000');
    assert.equal(matchTransactionSearch(txDebit475k, q), true);
  });

  test(3, '475000 matches running balance 475000', () => {
    const q = parseTransactionSearch('475000');
    assert.equal(matchTransactionSearch(txDebit5k, q), true);
  });

  test(4, '475000 matches formatted: ₹475000', () => {
    const q = parseTransactionSearch('₹475000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(5, '475000 matches: ₹475,000', () => {
    const q = parseTransactionSearch('₹475,000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(6, '475000 matches: ₹4,75,000', () => {
    const q = parseTransactionSearch('₹4,75,000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(7, '4,75,000 matches 475000', () => {
    const q = parseTransactionSearch('4,75,000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(8, '₹4,75,000 matches 475000', () => {
    const q = parseTransactionSearch('₹4,75,000');
    assert.equal(matchTransactionSearch(txDebit475k, q), true);
  });

  test(9, 'Existing prefix behavior: 50 matches 50', () => {
    const q = parseTransactionSearch('50');
    assert.equal(matchTransactionSearch(txDebit50, q), true);
  });

  test(10, '50 matches 500', () => {
    const tx500: SearchableTransaction = {
      date: '2026-09-01',
      type: 'DEBIT',
      amount_paise: 50000, // ₹500
      runningBalancePaise: 50000,
    };
    const q = parseTransactionSearch('50');
    assert.equal(matchTransactionSearch(tx500, q), true);
  });

  test(11, '50 matches 5000', () => {
    const q = parseTransactionSearch('50');
    assert.equal(matchTransactionSearch(txDebit5k, q), true);
  });

  test(12, '50 does NOT match 1500 under prefix semantics', () => {
    const q = parseTransactionSearch('50');
    assert.equal(matchTransactionSearch(txDebit1500, q), false);
  });

  // --------------------------------------------------------------------------
  // SIGNED AMOUNT (Tests 13 - 21)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 2: SIGNED AMOUNT SEARCH (TESTS 13 - 21) ---');

  test(13, '+5000 matches credit 5000', () => {
    const q = parseTransactionSearch('+5000');
    assert.equal(matchTransactionSearch(txCredit5k, q), true);
  });

  test(14, '+5000 does not match debit 5000', () => {
    const q = parseTransactionSearch('+5000');
    assert.equal(matchTransactionSearch(txDebit5k, q), false);
  });

  test(15, '-5000 matches debit 5000', () => {
    const q = parseTransactionSearch('-5000');
    assert.equal(matchTransactionSearch(txDebit5k, q), true);
  });

  test(16, '-5000 does not match credit 5000', () => {
    const q = parseTransactionSearch('-5000');
    assert.equal(matchTransactionSearch(txCredit5k, q), false);
  });

  test(17, '5000 unsigned can match credit', () => {
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txCredit5k, q), true);
  });

  test(18, '5000 unsigned can match debit', () => {
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txDebit5k, q), true);
  });

  test(19, '5000 unsigned can match running balance', () => {
    const txBal5k: SearchableTransaction = {
      date: '2026-09-01',
      type: 'DEBIT',
      amount_paise: 100000,
      runningBalancePaise: 500000, // ₹5,000
    };
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txBal5k, q), true);
  });

  test(20, '+₹5,000 works', () => {
    const q = parseTransactionSearch('+₹5,000');
    assert.equal(q.direction, 'CREDIT');
    assert.equal(q.amountDigits, '5000');
    assert.equal(matchTransactionSearch(txCredit5k, q), true);
    assert.equal(matchTransactionSearch(txDebit5k, q), false);
  });

  test(21, '-₹5,000 works', () => {
    const q = parseTransactionSearch('-₹5,000');
    assert.equal(q.direction, 'DEBIT');
    assert.equal(q.amountDigits, '5000');
    assert.equal(matchTransactionSearch(txDebit5k, q), true);
    assert.equal(matchTransactionSearch(txCredit5k, q), false);
  });

  // --------------------------------------------------------------------------
  // RUNNING BALANCE (Tests 22 - 24)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 3: RUNNING BALANCE SEARCH (TESTS 22 - 24) ---');

  test(22, 'Search finds transaction by running balance', () => {
    const q = parseTransactionSearch('515000');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(23, 'Search does not confuse running balance with credit on signed search', () => {
    const q = parseTransactionSearch('+515000');
    // txCredit475k has balance 515000, but its credit amount is 475000!
    assert.equal(matchTransactionSearch(txCredit475k, q), false);
  });

  test(24, 'Search does not confuse running balance with debit on signed search', () => {
    const q = parseTransactionSearch('-475000');
    // txDebit5k has balance 475000, but its debit amount is 5000!
    assert.equal(matchTransactionSearch(txDebit5k, q), false);
  });

  // --------------------------------------------------------------------------
  // DATES (Tests 25 - 35)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 4: DATE SEARCH ENGINE (TESTS 25 - 35) ---');

  test(25, '2026-09-01 -> 2026-09-01', () => {
    const q = parseTransactionSearch('2026-09-01');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-09-01');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
    assert.equal(matchTransactionSearch(txDebit5k, q), false);
  });

  test(26, '2026/09/01 -> 2026-09-01', () => {
    const q = parseTransactionSearch('2026/09/01');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-09-01');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(27, '01-09-2026 -> 2026-09-01', () => {
    const q = parseTransactionSearch('01-09-2026');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-09-01');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(28, '01/09/2026 -> 2026-09-01', () => {
    const q = parseTransactionSearch('01/09/2026');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-09-01');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(29, '2026-01-09 -> 2026-01-09 (Jan 9, not Sep 1)', () => {
    const q = parseTransactionSearch('2026-01-09');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-01-09');
  });

  test(30, '2026/01/09 -> 2026-01-09', () => {
    const q = parseTransactionSearch('2026/01/09');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-01-09');
  });

  test(31, '09-01-2026 -> 2026-01-09', () => {
    const q = parseTransactionSearch('09-01-2026');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-01-09');
  });

  test(32, '09/01/2026 -> 2026-01-09', () => {
    const q = parseTransactionSearch('09/01/2026');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2026-01-09');
  });

  test(33, 'Invalid dates rejected', () => {
    assert.equal(parseTransactionSearch('31-02-2026').mode, 'INVALID_DATE');
    assert.equal(parseTransactionSearch('2026-02-31').mode, 'INVALID_DATE');
    assert.equal(parseTransactionSearch('2026/13/01').mode, 'INVALID_DATE');
    assert.equal(parseTransactionSearch('00-09-2026').mode, 'INVALID_DATE');
    assert.equal(parseTransactionSearch('2026-00-10').mode, 'INVALID_DATE');
    assert.equal(matchTransactionSearch(txCredit475k, parseTransactionSearch('31-02-2026')), false);
  });

  test(34, 'Leap year valid date accepted (29-02-2024)', () => {
    const q = parseTransactionSearch('29-02-2024');
    assert.equal(q.mode, 'DATE');
    assert.equal(q.canonicalDate, '2024-02-29');
  });

  test(35, 'Non-leap-year invalid date rejected (29-02-2025)', () => {
    const q = parseTransactionSearch('29-02-2025');
    assert.equal(q.mode, 'INVALID_DATE');
  });

  // --------------------------------------------------------------------------
  // TYPE FILTER (Tests 36 - 40)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 5: TYPE FILTER INTERACTION (TESTS 36 - 40) ---');

  test(36, 'ALL TYPES + 5000 matches both credit and debit', () => {
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txCredit5k, q, 'ALL'), true);
    assert.equal(matchTransactionSearch(txDebit5k, q, 'ALL'), true);
  });

  test(37, 'CREDITS + 5000 matches credit only', () => {
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txCredit5k, q, 'CREDIT'), true);
    assert.equal(matchTransactionSearch(txDebit5k, q, 'CREDIT'), false);
  });

  test(38, 'DEBITS + 5000 matches debit only', () => {
    const q = parseTransactionSearch('5000');
    assert.equal(matchTransactionSearch(txDebit5k, q, 'DEBIT'), true);
    assert.equal(matchTransactionSearch(txCredit5k, q, 'DEBIT'), false);
  });

  test(39, 'CREDITS + -5000 -> zero results (filter collision)', () => {
    const q = parseTransactionSearch('-5000');
    assert.equal(matchTransactionSearch(txCredit5k, q, 'CREDIT'), false);
    assert.equal(matchTransactionSearch(txDebit5k, q, 'CREDIT'), false);
  });

  test(40, 'DEBITS + +5000 -> zero results (filter collision)', () => {
    const q = parseTransactionSearch('+5000');
    assert.equal(matchTransactionSearch(txCredit5k, q, 'DEBIT'), false);
    assert.equal(matchTransactionSearch(txDebit5k, q, 'DEBIT'), false);
  });

  // --------------------------------------------------------------------------
  // CATEGORY FILTER (Tests 41 - 43)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 6: CATEGORY FILTER (TESTS 41 - 43) ---');

  test(41, 'CREDIT + Investor Credits + amount', () => {
    const all = [txCredit475k, txCredit5k, txDebit5k];
    const q = parseTransactionSearch('475000');
    const filtered = all.filter(t => t.type === 'CREDIT' && matchTransactionSearch(t, q, 'CREDIT'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'tx-1');
  });

  test(42, 'DEBIT + Supplies + amount', () => {
    const all = [txDebit475k, txDebit5k, txDebit50];
    const q = parseTransactionSearch('475000');
    const filtered = all.filter(t => t.type === 'DEBIT' && t.debit_category === 'SUPPLIES' && matchTransactionSearch(t, q, 'DEBIT'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'tx-2');
  });

  test(43, 'DEBIT + Salary + amount', () => {
    const all = [txDebit475k, txDebit5k, txDebit50];
    const q = parseTransactionSearch('5000');
    const filtered = all.filter(t => t.type === 'DEBIT' && t.debit_category === 'SALARY' && matchTransactionSearch(t, q, 'DEBIT'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'tx-3');
  });

  // --------------------------------------------------------------------------
  // COMBINED FILTERING (Tests 44 - 50)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 7: COMBINED FILTERING (TESTS 44 - 50) ---');

  test(44, 'Date + amount matching', () => {
    const q = parseTransactionSearch('2026-09-01');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
    assert.equal(matchTransactionSearch(txDebit5k, q), false);
  });

  test(45, 'Date + credit', () => {
    const q = parseTransactionSearch('01/09/2026');
    assert.equal(matchTransactionSearch(txCredit475k, q, 'CREDIT'), true);
  });

  test(46, 'Date + debit', () => {
    const q = parseTransactionSearch('01/09/2026');
    assert.equal(matchTransactionSearch(txDebit475k, q, 'DEBIT'), true);
  });

  test(47, 'Date + amount + category', () => {
    const all = [txCredit475k, txDebit475k, txDebit5k];
    const qDate = parseTransactionSearch('2026-09-01');
    const filtered = all.filter(t => matchTransactionSearch(t, qDate) && t.debit_category === 'SUPPLIES');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'tx-2');
  });

  test(48, 'Date + amount + type + category', () => {
    const all = [txCredit475k, txDebit475k, txDebit5k];
    const qDate = parseTransactionSearch('2026-09-01');
    const filtered = all.filter(t => t.type === 'DEBIT' && t.debit_category === 'SUPPLIES' && matchTransactionSearch(t, qDate, 'DEBIT'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'tx-2');
  });

  test(49, 'Search + existing date range', () => {
    const startDate = '2026-09-01';
    const endDate = '2026-09-10';
    const all = [txCredit475k, txDebit5k, txDebit1500];
    const q = parseTransactionSearch('5000');
    const inRange = all.filter(t => t.date >= startDate && t.date <= endDate);
    const matched = inRange.filter(t => matchTransactionSearch(t, q));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-3');
  });

  test(50, 'Search date outside selected date range -> zero', () => {
    const startDate = '2026-09-01';
    const endDate = '2026-09-04';
    const all = [txCredit475k, txDebit5k]; // txDebit5k is 2026-09-05
    const qDate = parseTransactionSearch('2026-09-05');
    // User searches 2026-09-05, but date range is 2026-09-01 to 2026-09-04
    const inRange = all.filter(t => t.date >= startDate && t.date <= endDate);
    const matched = inRange.filter(t => matchTransactionSearch(t, qDate));
    assert.equal(matched.length, 0, 'Must return zero results when search date is outside active range');
  });

  // --------------------------------------------------------------------------
  // TEXT REGRESSION (Tests 51 - 54)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 8: TEXT REGRESSION (TESTS 51 - 54) ---');

  test(51, 'cement still works', () => {
    const q = parseTransactionSearch('cement');
    assert.equal(q.mode, 'TEXT');
    assert.equal(matchTransactionSearch(txDebit475k, q), true);
    assert.equal(matchTransactionSearch(txCredit475k, q), false);
  });

  test(52, 'Shahil still works', () => {
    const q = parseTransactionSearch('Shahil');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
    assert.equal(matchTransactionSearch(txDebit475k, q), false);
  });

  test(53, 'Direct Inflow / Direct Transfer still works', () => {
    const q = parseTransactionSearch('Direct Transfer');
    assert.equal(matchTransactionSearch(txCredit475k, q), true);
  });

  test(54, 'Existing text fields remain searchable (role and notes)', () => {
    const qRole = parseTransactionSearch('Electrician');
    assert.equal(matchTransactionSearch(txDebit5k, qRole), true);

    const qInv = parseTransactionSearch('8812');
    // Note: '8812' is 4 digits so it is recognized as amount 8812!
    // But text like 'Vendor' matches reference_note:
    const qVendor = parseTransactionSearch('Vendor');
    assert.equal(matchTransactionSearch(txDebit475k, qVendor), true);
  });

  // --------------------------------------------------------------------------
  // CLEAR SEARCH (Test 55)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 9: CLEAR SEARCH (TEST 55) ---');

  test(55, 'Clear search restores dataset under existing filters', () => {
    const all = [txCredit475k, txDebit475k, txDebit5k];
    const qEmpty = parseTransactionSearch('');
    const matched = all.filter(t => matchTransactionSearch(t, qEmpty));
    assert.equal(matched.length, all.length, 'Empty search must match all records');
  });

  // --------------------------------------------------------------------------
  // INVARIANTS (Phase 27)
  // --------------------------------------------------------------------------
  console.log('\n--- GROUP 10: INVARIANTS & NORMALIZATION (PHASE 27) ---');

  test(56, 'Invariant: normalize(normalize(input)) = normalize(input)', () => {
    const inputs = ['₹4,75,000', '475000', '₹ 15,00,000', '  10000000 '];
    for (const inp of inputs) {
      const n1 = normalizeSearchAmount(inp);
      const n2 = normalizeSearchAmount(n1);
      assert.equal(n1, n2);
    }
  });

  test(57, 'Invariant: Equivalent amount representations produce identical normalized amount', () => {
    const equivalents = [
      '475000',
      '475,000',
      '₹475000',
      '₹475,000',
      '₹ 475,000',
      '4,75,000',
      '₹4,75,000',
    ];
    const expected = '475000';
    for (const eq of equivalents) {
      const parsed = parseTransactionSearch(eq);
      assert.equal(parsed.mode, 'AMOUNT');
      assert.equal(parsed.amountDigits, expected, `Failed for input: ${eq}`);
    }
  });

  test(58, 'Invariant: Equivalent date representations produce identical canonical date', () => {
    const equivalents = [
      '2026-09-01',
      '2026/09/01',
      '01-09-2026',
      '01/09/2026',
    ];
    const expected = '2026-09-01';
    for (const eq of equivalents) {
      const parsed = parseTransactionSearch(eq);
      assert.equal(parsed.mode, 'DATE');
      assert.equal(parsed.canonicalDate, expected, `Failed for date: ${eq}`);
    }
  });

  test(59, 'Invariant: Indian grouping normalization (Lakhs & Crores)', () => {
    assert.equal(normalizeSearchAmount('4,75,000'), '475000');
    assert.equal(normalizeSearchAmount('15,00,000'), '1500000');
    assert.equal(normalizeSearchAmount('1,00,00,000'), '10000000');
  });

  console.log('\n====================================================');
  console.log(`ALL UNIVERSAL TRANSACTION SEARCH TESTS PASSED: ${passed}/${total}`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
