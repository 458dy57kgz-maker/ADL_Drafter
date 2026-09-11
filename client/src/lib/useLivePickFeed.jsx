import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { loadHandle, saveHandle, clearHandle } from './fileHandleStore.js';

// Watches the JSON file a Chrome bookmarklet appends draft picks to, and
// pushes it at the server whenever it changes.
//
// The browser does the reading rather than the server because the file lives
// on the drafting laptop while the app may be running on the NAS — a container
// there can't see /Users/... at all. The File System Access API is the only
// way a web page can re-read a local file over and over without the user
// picking it every time, so this is Chrome-only by construction; the manual
// draft overlay stays as the fallback everywhere else.
//
// It lives above the page router (see App.jsx) so watching continues while you
// move between the War Room, Results and Settings.

const POLL_MS = 2000;

const LivePickFeedContext = createContext(null);

export function useLivePickFeed() {
  return useContext(LivePickFeedContext);
}

export const FEED_SUPPORTED = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export function LivePickFeedProvider({ children }) {
  const [handle, setHandle] = useState(null);
  const [permission, setPermission] = useState(null); // 'granted' | 'prompt' | 'denied'
  const [report, setReport] = useState(null); // last successful sync
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [busy, setBusy] = useState(false);

  // Last file state we acted on, so an unchanged file costs one stat and no
  // request.
  const seenRef = useRef({ lastModified: null, size: null, picks: null });

  // Remember the file across reloads. Chrome hands the handle back but not the
  // permission, so this usually lands on 'prompt' — one click, no file picker.
  useEffect(() => {
    if (!FEED_SUPPORTED) return;
    let cancelled = false;
    loadHandle().then(async (stored) => {
      if (cancelled || !stored) return;
      setHandle(stored);
      setFileName(stored.name ?? null);
      try {
        setPermission(await stored.queryPermission({ mode: 'read' }));
      } catch {
        setPermission('prompt');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const readAndSync = useCallback(
    async (target, { force = false } = {}) => {
      const file = await target.getFile();
      const seen = seenRef.current;
      if (!force && file.lastModified === seen.lastModified && file.size === seen.size) return null;

      const text = await file.text();
      let picks;
      try {
        picks = JSON.parse(text);
      } catch {
        // The bookmarklet rewrites the whole file, so a poll can land
        // mid-write and see truncated JSON. Leave `seen` alone and try again
        // on the next tick rather than reporting an error the user can't act
        // on — a genuinely broken file just keeps failing quietly.
        return null;
      }
      if (!Array.isArray(picks)) throw new Error('That file is not a list of picks.');

      seenRef.current = { lastModified: file.lastModified, size: file.size, picks };

      try {
        const result = await api.feedSync(picks);
        setReport(result);
        setOrderIssue(null);
        setError(null);
        setLastSyncAt(Date.now());
        return result;
      } catch (err) {
        // 409 is the server refusing to attribute picks to the wrong
        // managers — actionable, and it carries the order it recovered.
        if (err.status === 409 && err.body) {
          setOrderIssue(err.body);
          setError(null);
        } else {
          setError(err.message);
        }
        return null;
      }
    },
    []
  );

  // The watch loop. Only runs with permission in hand.
  useEffect(() => {
    if (!handle || permission !== 'granted') return undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        await readAndSync(handle);
      } catch (err) {
        // Losing the file (moved, deleted, permission revoked) should stop
        // the loop rather than log once per second forever.
        setError(err.message);
        if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
          setPermission('prompt');
          stopped = true;
        }
      }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [handle, permission, readAndSync]);

  // One entry point for the button, whatever state it's in: pick a file if
  // there isn't one, otherwise just ask for permission back.
  const connect = useCallback(async () => {
    if (!FEED_SUPPORTED) return;
    setBusy(true);
    setError(null);
    try {
      let target = handle;
      if (target) {
        const granted = await target.requestPermission({ mode: 'read' });
        if (granted !== 'granted') {
          // They picked a different file, or revoked it — fall through to the
          // picker rather than leaving a dead button.
          target = null;
        }
      }
      if (!target) {
        const [picked] = await window.showOpenFilePicker({
          types: [{ description: 'Draft pick feed', accept: { 'application/json': ['.json'] } }],
          multiple: false,
        });
        target = picked;
        await saveHandle(picked);
        setHandle(picked);
        setFileName(picked.name);
      }
      setPermission('granted');
      seenRef.current = { lastModified: null, size: null, picks: seenRef.current.picks };
      await readAndSync(target, { force: true });
    } catch (err) {
      // AbortError just means the picker was dismissed.
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [handle, readAndSync]);

  const disconnect = useCallback(async () => {
    setHandle(null);
    setPermission(null);
    setFileName(null);
    setReport(null);
    setOrderIssue(null);
    setError(null);
    seenRef.current = { lastModified: null, size: null, picks: null };
    await clearHandle();
  }, []);

  const syncNow = useCallback(async () => {
    if (!handle) return;
    setBusy(true);
    try {
      await readAndSync(handle, { force: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [handle, readAndSync]);

  const value = {
    supported: FEED_SUPPORTED,
    connected: !!handle && permission === 'granted',
    hasHandle: !!handle,
    permission,
    fileName,
    report,
    error,
    lastSyncAt,
    busy,
    connect,
    disconnect,
    syncNow,
  };

  return <LivePickFeedContext.Provider value={value}>{children}</LivePickFeedContext.Provider>;
}
