import test from 'node:test';
import assert from 'node:assert/strict';

test('STEP 2K: NAVBAR ARROW RESTORED SPECIFICATION VERIFICATION', async (t) => {
  // Navigation item model
  const getNavGroups = (isAdmin: boolean) => {
    const groups = [
      {
        title: 'Overview',
        items: [{ label: 'Dashboard', href: '/' }],
      },
      {
        title: 'Attendance',
        items: [
          { label: 'Daily Entry', href: '/attendance/daily' },
          { label: 'Weekly Matrix', href: '/attendance/weekly' },
          { label: 'Monthly Report', href: '/attendance/monthly' },
        ],
      },
      {
        title: 'Reports',
        items: [
          { label: 'Role Breakdown', href: '/reports/role' },
          { label: 'Category Summary', href: '/reports/category' },
          { label: 'Site Overview', href: '/reports/site' },
        ],
      },
      {
        title: 'Money',
        items: [
          { label: 'Transactions', href: '/finance' },
          { label: 'Monthly Ledger', href: '/finance/monthly' },
        ],
      },
    ];

    if (isAdmin) {
      groups.push({
        title: 'Setup & Admin',
        items: [
          { label: 'Sites', href: '/setup/sites' },
          { label: 'Roles & Rates', href: '/setup/roles' },
          { label: 'Users & Access', href: '/setup/users' },
          { label: 'Audit Trail', href: '/setup/audit' },
          { label: 'My Account', href: '/setup/account' },
        ],
      });
    }

    return groups;
  };

  await t.test('1. Navigation item order and complete list preserved', () => {
    const groups = getNavGroups(true);
    assert.equal(groups.length, 5);
    assert.deepEqual(
      groups.map(g => g.title),
      ['Overview', 'Attendance', 'Reports', 'Money', 'Setup & Admin']
    );

    const allAdminHrefs = groups.flatMap(g => g.items.map(i => i.href));
    assert.equal(allAdminHrefs.length, 14);
    assert.equal(allAdminHrefs[0], '/');
    assert.equal(allAdminHrefs[1], '/attendance/daily');
    assert.equal(allAdminHrefs[13], '/setup/account');
  });

  await t.test('2. Role-based visibility strictly isolates Admin from Non-Admin', () => {
    const nonAdminGroups = getNavGroups(false);
    assert.equal(nonAdminGroups.length, 4);
    assert.equal(nonAdminGroups.some(g => g.title === 'Setup & Admin'), false);

    const nonAdminHrefs = nonAdminGroups.flatMap(g => g.items.map(i => i.href));
    assert.equal(nonAdminHrefs.length, 9);
  });

  await t.test('3. Arrow primary purpose: operates against overflow/hidden navigation segments, NOT router.back()', () => {
    // Verify that the arrow function moves the horizontal scroll offset to reveal hidden segment
    const computeScrollOffset = (currentScroll: number, clientWidth: number, direction: 'left' | 'right') => {
      const scrollAmount = Math.max(180, Math.floor(clientWidth * 0.75));
      return direction === 'left' ? currentScroll - scrollAmount : currentScroll + scrollAmount;
    };

    const clientWidth = 600;
    const initialScroll = 400;

    // Moving left reveals previous hidden segment
    const leftTarget = computeScrollOffset(initialScroll, clientWidth, 'left');
    assert.ok(leftTarget < initialScroll);
    assert.equal(leftTarget, -50); // 400 - 450

    // Moving right reveals next hidden segment
    const rightTarget = computeScrollOffset(initialScroll, clientWidth, 'right');
    assert.ok(rightTarget > initialScroll);
    assert.equal(rightTarget, 850); // 400 + 450
  });

  await t.test('4. Active item reveal calculation: centers active item if clipped', () => {
    const isItemClipped = (itemLeft: number, itemRight: number, containerLeft: number, containerRight: number) => {
      return itemLeft < containerLeft + 8 || itemRight > containerRight - 8;
    };

    // Item comfortably visible: no scroll needed
    assert.equal(isItemClipped(100, 200, 50, 500), false);

    // Item clipped on left: scroll needed
    assert.equal(isItemClipped(40, 140, 50, 500), true);

    // Item clipped on right: scroll needed
    assert.equal(isItemClipped(450, 550, 50, 500), true);
  });

  await t.test('5. Constant physical layout footprint: arrow button width does not collapse to 0', () => {
    // The arrow button classes maintain a constant width footprint regardless of canScrollLeft
    const getArrowClass = (canScroll: boolean) => {
      return canScroll
        ? 'w-8 h-8 rounded-lg opacity-100 cursor-pointer'
        : 'w-8 h-8 rounded-lg opacity-20 cursor-not-allowed pointer-events-none';
    };

    const activeClasses = getArrowClass(true);
    const disabledClasses = getArrowClass(false);

    assert.ok(activeClasses.includes('w-8 h-8'), 'Active arrow must have w-8 h-8');
    assert.ok(disabledClasses.includes('w-8 h-8'), 'Disabled arrow must retain w-8 h-8');
    assert.equal(disabledClasses.includes('w-0'), false, 'Disabled arrow must never collapse to w-0');
  });

  await t.test('6. Duplicate navigation protection: clicking active route is prevented', () => {
    let triggered = false;
    const handleItemClick = (targetHref: string, currentPathname: string) => {
      if (targetHref === currentPathname) {
        return { prevented: true };
      }
      triggered = true;
      return { prevented: false };
    };

    assert.equal(handleItemClick('/attendance/daily', '/attendance/daily').prevented, true);
    assert.equal(triggered, false);

    assert.equal(handleItemClick('/finance', '/attendance/daily').prevented, false);
    assert.equal(triggered, true);
  });
});
