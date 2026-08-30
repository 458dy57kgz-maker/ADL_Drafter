import { useCallback, useEffect, useRef, useState } from 'react';

// Polls `fetcher` every `intervalSeconds`, matching the Draft-Day Behavior
// "polling interval" setting (5-60s, default from server settings).
export function usePolling(fetcher, intervalSeconds, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const fetcherRef = useRef(fetcher);
  const cancelledRef = useRef(false);
  fetcherRef.current = fetcher;

  const tick = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      if (!cancelledRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (!cancelledRef.current) setError(err);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    // intervalSeconds <= 0 means "disabled" (e.g. a hidden overlay that
    // shouldn't poll at all while closed) — not "fetch once and stop".
    if (intervalSeconds > 0) {
      tick();
      timerRef.current = setInterval(tick, intervalSeconds * 1000);
    }
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refetch: tick };
}
