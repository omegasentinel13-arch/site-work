'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds
const CHANNEL_NAME = 'site_work_inactivity_sync';
const LOCAL_STORAGE_KEY = 'site_work_last_active_ts';

export function InactivityManager() {
  const router = useRouter();
  const lastActivityRef = useRef<number>(Date.now());
  const lastHeartbeatRef = useRef<number>(Date.now());
  const isLoggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    // Check if window is defined
    if (typeof window === 'undefined') return;

    // Initialize with current time
    lastActivityRef.current = Date.now();
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, String(Date.now()));
    } catch {}

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
      } catch {}
    }

    const performInactivityLogout = async () => {
      if (isLoggingOutRef.current) return;
      isLoggingOutRef.current = true;

      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {}

      const currentPath = window.location.pathname + window.location.search;
      const target = currentPath && currentPath !== '/'
        ? `/login?next=${encodeURIComponent(currentPath)}`
        : '/login';

      router.replace(target);
    };

    // Listen to cross-tab broadcast
    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data) return;
        if (event.data.type === 'USER_ACTIVITY' && typeof event.data.timestamp === 'number') {
          if (event.data.timestamp > lastActivityRef.current) {
            lastActivityRef.current = event.data.timestamp;
          }
        } else if (event.data.type === 'INACTIVITY_LOGOUT') {
          performInactivityLogout();
        }
      };
    }

    // Storage fallback for cross-tab sync
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_KEY && e.newValue) {
        const ts = Number(e.newValue);
        if (ts > lastActivityRef.current) {
          lastActivityRef.current = ts;
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    // Record user activity
    let throttleTimeout: NodeJS.Timeout | null = null;
    const recordActivity = () => {
      if (throttleTimeout) return;
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
      }, 1000); // Throttle activity events to max 1 per second

      const now = Date.now();
      lastActivityRef.current = now;

      // Broadcast to other tabs
      if (channel) {
        try {
          channel.postMessage({ type: 'USER_ACTIVITY', timestamp: now });
        } catch {}
      }
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, String(now));
      } catch {}

      // Heartbeat check: if >= 5 min elapsed since last heartbeat, trigger server heartbeat
      if (now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatRef.current = now;
        fetch('/api/auth/heartbeat', { method: 'POST' })
          .then((res) => {
            if (res.status === 401) {
              performInactivityLogout();
            }
          })
          .catch(() => {});
      }
    };

    // Activity event listeners
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, recordActivity, { passive: true }));

    // Periodic check interval
    const intervalId = setInterval(() => {
      const now = Date.now();
      const idleMs = now - lastActivityRef.current;

      if (idleMs >= INACTIVITY_TIMEOUT_MS) {
        if (channel) {
          try {
            channel.postMessage({ type: 'INACTIVITY_LOGOUT' });
          } catch {}
        }
        performInactivityLogout();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      if (channel) {
        channel.close();
      }
      window.removeEventListener('storage', handleStorage);
      events.forEach((ev) => window.removeEventListener(ev, recordActivity));
      clearInterval(intervalId);
    };
  }, [router]);

  return null;
}
