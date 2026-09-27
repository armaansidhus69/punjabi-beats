/**
 * useDebounce — value ko delay tak hold karta hai, phir naya value deta hai.
 * Search screen isse API spam rokne ke liye use karta hai (har keystroke pe
 * request nahi jaati, sirf 400ms ruk jaane ke baad).
 * Cleanup unmount / value change pe timer clear kar deta hai.
 */
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debounced;
}
