import test from 'node:test';
import assert from 'node:assert/strict';

// Mock browser globals for theme testing in Node environment
class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

// Set up mock window and document
const mockStorage = new MockLocalStorage();
(global as any).window = global;
(global as any).localStorage = mockStorage;
(global as any).document = {
  cookie: '',
  documentElement: {
    classList: {
      classes: new Set<string>(),
      add(cls: string) { this.classes.add(cls); },
      remove(cls: string) { this.classes.delete(cls); },
      contains(cls: string) { return this.classes.has(cls); }
    }
  }
};

import { getSavedUserTheme, saveUserTheme, ACTIVE_THEME_COOKIE } from '../context/theme-context';

test('PHASE B: USER-SPECIFIC THEME PERSISTENCE SUITE', async (t) => {
  mockStorage.clear();
  (global as any).document.cookie = '';

  await t.test('1. Default theme is strictly Light for new/unconfigured users', () => {
    const themeA = getSavedUserTheme('usr-user-a');
    assert.equal(themeA, 'light', 'New user must strictly default to Light theme');

    const themeB = getSavedUserTheme('usr-user-b');
    assert.equal(themeB, 'light', 'Another new user must strictly default to Light theme');
  });

  await t.test('2. User A setting Dark persists for User A', () => {
    saveUserTheme('usr-user-a', 'dark');

    const savedA = getSavedUserTheme('usr-user-a');
    assert.equal(savedA, 'dark', 'User A preference must be persisted as Dark');
    assert.ok(document.cookie.includes(`${ACTIVE_THEME_COOKIE}=dark`), 'Active cookie must be set to dark');
  });

  await t.test('3. User B remains Light when User A is Dark (Cross-user isolation)', () => {
    // User B has not set any preference
    const savedB = getSavedUserTheme('usr-user-b');
    assert.equal(savedB, 'light', 'User B must NOT inherit User A dark preference');

    // Explicitly set User B to light
    saveUserTheme('usr-user-b', 'light');
    assert.equal(getSavedUserTheme('usr-user-b'), 'light');
    assert.ok(document.cookie.includes(`${ACTIVE_THEME_COOKIE}=light`), 'Active cookie for User B must be light');

    // Confirm User A is still dark
    assert.equal(getSavedUserTheme('usr-user-a'), 'dark', 'User A preference must remain dark');
  });

  await t.test('4. User A switching Dark -> Light persists', () => {
    saveUserTheme('usr-user-a', 'light');

    assert.equal(getSavedUserTheme('usr-user-a'), 'light', 'User A must now be persisted as Light');
    assert.ok(document.cookie.includes(`${ACTIVE_THEME_COOKIE}=light`), 'Active cookie must be light');
  });

  await t.test('5. Pre-hydration cookie parser behavior verification', () => {
    // Simulate pre-hydration layout script execution
    document.cookie = 'site_work_active_theme=dark';
    const matchDark = document.cookie.match(/(?:^|;\s*)site_work_active_theme=([^;]+)/);
    const themeDark = matchDark ? decodeURIComponent(matchDark[1]) : null;
    assert.equal(themeDark, 'dark', 'Cookie regex must properly identify dark theme');

    document.cookie = 'site_work_active_theme=light';
    const matchLight = document.cookie.match(/(?:^|;\s*)site_work_active_theme=([^;]+)/);
    const themeLight = matchLight ? decodeURIComponent(matchLight[1]) : null;
    assert.equal(themeLight, 'light', 'Cookie regex must properly identify light theme');

    document.cookie = '';
    const matchEmpty = document.cookie.match(/(?:^|;\s*)site_work_active_theme=([^;]+)/);
    const themeEmpty = matchEmpty ? decodeURIComponent(matchEmpty[1]) : null;
    assert.equal(themeEmpty, null, 'Unset cookie must return null and fall back to Light');
  });
});
