import { getDb, runTransaction } from './index';

export function runSeed() {
  const db = getDb();

  runTransaction(db, () => {
    // 1. Sites
    const insertSite = db.prepare(`
      INSERT OR IGNORE INTO sites (id, name, code, location, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
    `);

    insertSite.run('site-1', 'Site 1', 'S-01', 'Commercial Tower');
    insertSite.run('site-2', 'Site 2', 'S-02', 'Residential Block A');

    // 2. Categories
    const insertCat = db.prepare(`
      INSERT OR IGNORE INTO work_categories (id, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
    `);

    const categories = [
      { id: 'cat-civil', name: 'CIVIL WORKS', sort: 1 },
      { id: 'cat-finishing', name: 'FINISHING WORKS', sort: 2 },
      { id: 'cat-mep', name: 'MEP WORKS', sort: 3 },
      { id: 'cat-exterior', name: 'EXTERIOR WORKS', sort: 4 },
    ];

    for (const cat of categories) {
      insertCat.run(cat.id, cat.name, cat.sort);
    }

    // 3. Roles with default rates in Paise (1 INR = 100 Paise)
    const insertRole = db.prepare(`
      INSERT OR IGNORE INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `);

    const roles = [
      // Civil Works (9 roles)
      { id: 'role-mason', cat: 'cat-civil', name: 'Mason', rate: 140000, sort: 1 },
      { id: 'role-male-helper', cat: 'cat-civil', name: 'Male Helper', rate: 90000, sort: 2 },
      { id: 'role-female-helper', cat: 'cat-civil', name: 'Female Helper', rate: 80000, sort: 3 },
      { id: 'role-bar-bender', cat: 'cat-civil', name: 'Bar Bender', rate: 130000, sort: 4 },
      { id: 'role-carpenter', cat: 'cat-civil', name: 'Carpenter', rate: 130000, sort: 5 },
      { id: 'role-excavation-labour', cat: 'cat-civil', name: 'Excavation Labour', rate: 90000, sort: 6 },
      { id: 'role-concrete-labour', cat: 'cat-civil', name: 'Concrete Labour', rate: 100000, sort: 7 },
      { id: 'role-scaffolding-labour', cat: 'cat-civil', name: 'Scaffolding Labour', rate: 100000, sort: 8 },
      { id: 'role-pile-labour', cat: 'cat-civil', name: 'Pile Labour', rate: 110000, sort: 9 },

      // Finishing Works (5 roles)
      { id: 'role-tile-mason', cat: 'cat-finishing', name: 'Tile / Granite Mason', rate: 140000, sort: 10 },
      { id: 'role-tile-helper', cat: 'cat-finishing', name: 'Tile Helper', rate: 90000, sort: 11 },
      { id: 'role-painter', cat: 'cat-finishing', name: 'Painter', rate: 120000, sort: 12 },
      { id: 'role-waterproofing', cat: 'cat-finishing', name: 'Waterproofing Labour', rate: 110000, sort: 13 },
      { id: 'role-false-ceiling', cat: 'cat-finishing', name: 'False Ceiling Labour', rate: 120000, sort: 14 },

      // MEP Works (3 roles)
      { id: 'role-electrician', cat: 'cat-mep', name: 'Electrician', rate: 150000, sort: 15 },
      { id: 'role-plumber', cat: 'cat-mep', name: 'Plumber', rate: 140000, sort: 16 },
      { id: 'role-ac-technician', cat: 'cat-mep', name: 'AC Technician', rate: 160000, sort: 17 },

      // Exterior Works (2 roles)
      { id: 'role-welder', cat: 'cat-exterior', name: 'Welder', rate: 130000, sort: 18 },
      { id: 'role-upvc-worker', cat: 'cat-exterior', name: 'Aluminium / UPVC Worker', rate: 140000, sort: 19 },
    ];

    for (const r of roles) {
      insertRole.run(r.id, r.cat, r.name, r.rate, r.sort);
    }
  });

  console.log('Master data seed executed successfully (Zero hardcoded credentials).');
}
