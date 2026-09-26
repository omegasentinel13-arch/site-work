import assert from 'node:assert/strict';
import {
  parseTransactionSearch,
  matchTransactionSearch,
  SearchableTransaction,
} from '../lib/finance/search-parser';

async function runManualQATests() {
  console.log('====================================================');
  console.log('EXECUTING PHASE 32 MANUAL QA TEST SCENARIOS A - U');
  console.log('====================================================\n');

  // Test dataset representing realistic site ledger records
  const transactions: SearchableTransaction[] = [
    {
      id: 'tx-1',
      date: '2026-09-01',
      type: 'CREDIT',
      amount_paise: 47500000, // ₹4,75,000 Credit
      runningBalancePaise: 47500000,
      description: 'Initial project fund deposit',
      investor_name: 'Investor A',
    },
    {
      id: 'tx-2',
      date: '2026-09-01',
      type: 'DEBIT',
      amount_paise: 47500000, // ₹4,75,000 Debit
      runningBalancePaise: 0,
      description: 'Major steel reinforcement package',
      debit_category: 'SUPPLIES',
    },
    {
      id: 'tx-3',
      date: '2026-09-02',
      type: 'CREDIT',
      amount_paise: 1000000, // ₹10,000 Credit
      runningBalancePaise: 47500000, // Running balance equals ₹4,75,000!
      description: 'Secondary contingency credit',
      investor_name: 'Investor B',
    },
    {
      id: 'tx-4',
      date: '2026-09-03',
      type: 'CREDIT',
      amount_paise: 500000, // ₹5,000 Credit
      runningBalancePaise: 48000000,
      description: 'Investor advance installment',
      investor_name: 'Direct Inflow Investor',
    },
    {
      id: 'tx-5',
      date: '2026-09-03',
      type: 'DEBIT',
      amount_paise: 500000, // ₹5,000 Debit
      runningBalancePaise: 47500000,
      description: 'Plumbing contractor advance',
      debit_category: 'SALARY',
      work_category_name: 'Plumbing',
    },
    {
      id: 'tx-6',
      date: '2026-01-09',
      type: 'DEBIT',
      amount_paise: 250000, // ₹2,500 Debit on 9th Jan 2026
      runningBalancePaise: 47250000,
      description: 'January winter site preparation supplies',
      debit_category: 'SUPPLIES',
    },
    {
      id: 'tx-7',
      date: '2026-09-04',
      type: 'DEBIT',
      amount_paise: 120000, // ₹1,200 Debit
      runningBalancePaise: 47130000,
      description: 'UltraTech cement bags order #512',
      debit_category: 'SUPPLIES',
    },
  ];

  let passed = 0;
  let total = 0;

  function runScenario(label: string, description: string, fn: () => void) {
    total++;
    try {
      fn();
      console.log(`  ✓ [PASS] TEST ${label}: ${description}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] TEST ${label}: ${description}`, err.message);
      throw err;
    }
  }

  // TEST A: Search 475000 -> credit matches, debit matches, running balance matches
  runScenario('A', 'Search 475000 matches credit, debit, and running balance', () => {
    const q = parseTransactionSearch('475000');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    const ids = matched.map(t => t.id);
    assert.ok(ids.includes('tx-1'), 'Must match tx-1 via credit amount');
    assert.ok(ids.includes('tx-2'), 'Must match tx-2 via debit amount');
    assert.ok(ids.includes('tx-3'), 'Must match tx-3 via running balance');
    assert.equal(matched.length, 4); // tx-1, tx-2, tx-3, tx-5 (tx-5 running balance also 475000)
  });

  // TEST B: Search 475,000 -> Verify same result set
  runScenario('B', 'Search 475,000 produces identical results as 475000', () => {
    const qA = parseTransactionSearch('475000');
    const qB = parseTransactionSearch('475,000');
    const resA = transactions.filter(t => matchTransactionSearch(t, qA, 'ALL')).map(t => t.id);
    const resB = transactions.filter(t => matchTransactionSearch(t, qB, 'ALL')).map(t => t.id);
    assert.deepEqual(resA, resB);
  });

  // TEST C: Search ₹475000 -> Verify same result set
  runScenario('C', 'Search ₹475000 produces identical results as 475000', () => {
    const qA = parseTransactionSearch('475000');
    const qC = parseTransactionSearch('₹475000');
    const resA = transactions.filter(t => matchTransactionSearch(t, qA, 'ALL')).map(t => t.id);
    const resC = transactions.filter(t => matchTransactionSearch(t, qC, 'ALL')).map(t => t.id);
    assert.deepEqual(resA, resC);
  });

  // TEST D: Search ₹4,75,000 -> Verify same result set
  runScenario('D', 'Search ₹4,75,000 produces identical results as 475000', () => {
    const qA = parseTransactionSearch('475000');
    const qD = parseTransactionSearch('₹4,75,000');
    const resA = transactions.filter(t => matchTransactionSearch(t, qA, 'ALL')).map(t => t.id);
    const resD = transactions.filter(t => matchTransactionSearch(t, qD, 'ALL')).map(t => t.id);
    assert.deepEqual(resA, resD);
  });

  // TEST E: Search +5000 -> Verify credit only
  runScenario('E', 'Search +5000 matches credit 5000 only', () => {
    const q = parseTransactionSearch('+5000');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-4');
    assert.equal(matched[0].type, 'CREDIT');
  });

  // TEST F: Search -5000 -> Verify debit only
  runScenario('F', 'Search -5000 matches debit 5000 only', () => {
    const q = parseTransactionSearch('-5000');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-5');
    assert.equal(matched[0].type, 'DEBIT');
  });

  // TEST G: Search 5000 -> Verify unsigned amount search (both credit and debit)
  runScenario('G', 'Search 5000 matches both credit 5000 and debit 5000', () => {
    const q = parseTransactionSearch('5000');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    const ids = matched.map(t => t.id);
    assert.ok(ids.includes('tx-4'), 'Matches tx-4 credit 5000');
    assert.ok(ids.includes('tx-5'), 'Matches tx-5 debit 5000');
  });

  // TEST H: Search 2026-09-01 -> Verify correct date
  runScenario('H', 'Search 2026-09-01 matches transactions on that date', () => {
    const q = parseTransactionSearch('2026-09-01');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 2);
    assert.deepEqual(matched.map(t => t.id).sort(), ['tx-1', 'tx-2']);
  });

  // TEST I: Search 2026/09/01 -> Verify same date
  runScenario('I', 'Search 2026/09/01 matches same date as 2026-09-01', () => {
    const q = parseTransactionSearch('2026/09/01');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.deepEqual(matched.map(t => t.id).sort(), ['tx-1', 'tx-2']);
  });

  // TEST J: Search 01-09-2026 -> Verify same date
  runScenario('J', 'Search 01-09-2026 matches same date as 2026-09-01', () => {
    const q = parseTransactionSearch('01-09-2026');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.deepEqual(matched.map(t => t.id).sort(), ['tx-1', 'tx-2']);
  });

  // TEST K: Search 01/09/2026 -> Verify same date
  runScenario('K', 'Search 01/09/2026 matches same date as 2026-09-01', () => {
    const q = parseTransactionSearch('01/09/2026');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.deepEqual(matched.map(t => t.id).sort(), ['tx-1', 'tx-2']);
  });

  // TEST L: Search 2026-01-09 -> Verify January 9, 2026, NOT September 1
  runScenario('L', 'Search 2026-01-09 matches January 9, 2026 only', () => {
    const q = parseTransactionSearch('2026-01-09');
    assert.equal(q.canonicalDate, '2026-01-09');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-6');
    assert.equal(matched[0].date, '2026-01-09');
  });

  // TEST M: Search 2026/01/09 -> Verify January 9, 2026
  runScenario('M', 'Search 2026/01/09 matches January 9, 2026', () => {
    const q = parseTransactionSearch('2026/01/09');
    assert.equal(q.canonicalDate, '2026-01-09');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-6');
  });

  // TEST N: Search 09-01-2026 -> Verify January 9, 2026
  runScenario('N', 'Search 09-01-2026 matches January 9, 2026', () => {
    const q = parseTransactionSearch('09-01-2026');
    assert.equal(q.canonicalDate, '2026-01-09');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-6');
  });

  // TEST O: Search 09/01/2026 -> Verify January 9, 2026
  runScenario('O', 'Search 09/01/2026 matches January 9, 2026', () => {
    const q = parseTransactionSearch('09/01/2026');
    assert.equal(q.canonicalDate, '2026-01-09');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-6');
  });

  // TEST P: Search cement -> Verify existing text search
  runScenario('P', 'Search cement matches descriptions with UltraTech cement', () => {
    const q = parseTransactionSearch('cement');
    const matched = transactions.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 2);
    assert.ok(matched.some(t => t.id === 'tx-2'));
    assert.ok(matched.some(t => t.id === 'tx-7'));
  });

  // TEST Q: Select CREDITS, Search 475000 -> Verify only credit-side matching transactions
  runScenario('Q', 'Type=CREDITS + Search=475000 returns credit matches only, not debits or running balances', () => {
    const q = parseTransactionSearch('475000');
    const matched = transactions.filter(t => t.type === 'CREDIT' && matchTransactionSearch(t, q, 'CREDIT'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-1');
  });

  // TEST R: Select DEBITS, Search 475000 -> Verify only debit-side matching transactions
  runScenario('R', 'Type=DEBITS + Search=475000 returns debit matches only', () => {
    const q = parseTransactionSearch('475000');
    const matched = transactions.filter(t => t.type === 'DEBIT' && matchTransactionSearch(t, q, 'DEBIT'));
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-2');
  });

  // TEST S: Select DEBITS + SUPPLIES, Search 475000 -> Verify only matching supplies debit
  runScenario('S', 'Type=DEBITS + Category=SUPPLIES + Search=475000 matches tx-2', () => {
    const q = parseTransactionSearch('475000');
    const matched = transactions.filter(t => 
      t.type === 'DEBIT' && 
      t.debit_category === 'SUPPLIES' && 
      matchTransactionSearch(t, q, 'DEBIT')
    );
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-2');
  });

  // TEST T: Select CREDITS + INVESTOR CREDITS, Search 5000 -> Verify only matching investor credit
  runScenario('T', 'Type=CREDITS + Search=5000 matches tx-4', () => {
    const q = parseTransactionSearch('5000');
    const matched = transactions.filter(t => 
      t.type === 'CREDIT' && 
      matchTransactionSearch(t, q, 'CREDIT')
    );
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'tx-4');
  });

  // TEST U: Date range + search date outside range -> Expected zero results
  runScenario('U', 'Search date outside selected date range produces 0 results', () => {
    const startDate = '2026-09-01';
    const endDate = '2026-09-30';
    // User searches January 9, 2026, but active date range is September 2026
    const q = parseTransactionSearch('2026-01-09');
    const inRange = transactions.filter(t => t.date >= startDate && t.date <= endDate);
    const matched = inRange.filter(t => matchTransactionSearch(t, q, 'ALL'));
    assert.equal(matched.length, 0);
  });

  console.log('\n====================================================');
  console.log(`ALL 21 MANUAL QA SCENARIOS A - U PASSED: ${passed}/${total}`);
  console.log('====================================================\n');
}

runManualQATests().catch((err) => {
  console.error('QA Scenarios Suite failed:', err);
  process.exit(1);
});
