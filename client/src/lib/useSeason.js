import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// The season data behind all three season pages. Fetched once and again
// after an import, not polled: nothing changes it except me importing
// something, unlike draft night where the room moves every minute.
export function useSeason() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    try {
      setData(await api.getSeason());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, error, refetch };
}

// "Tue, Sep 29" from "2026-09-29", read as a calendar date rather than a
// UTC midnight that would print as the day before in Toronto.
export function formatRosterDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatImportedAt(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  const minutes = Math.round((Date.now() - when.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
