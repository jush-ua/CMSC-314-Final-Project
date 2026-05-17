/**
 * Throttle: Execute function at most once per interval (leading + trailing)
 */
export function throttle(fn, intervalMs) {
  let lastRun = 0;
  let scheduled = null;

  const throttled = function throttled(...args) {
    const now = Date.now();
    const timeSinceLastRun = now - lastRun;

    if (timeSinceLastRun >= intervalMs) {
      // Execute immediately (leading)
      lastRun = now;
      fn.apply(this, args);
      if (scheduled) {
        clearTimeout(scheduled);
        scheduled = null;
      }
    } else if (!scheduled) {
      // Schedule for later (trailing)
      const timeUntilNextRun = intervalMs - timeSinceLastRun;
      scheduled = setTimeout(() => {
        lastRun = Date.now();
        fn.apply(this, args);
        scheduled = null;
      }, timeUntilNextRun);
    }
  };

  throttled.cancel = () => {
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
  };

  return throttled;
}

/**
 * Debounce: Execute function only after interval has passed (trailing only)
 */
export function debounce(fn, intervalMs) {
  let scheduled = null;

  return function debounced(...args) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      fn.apply(this, args);
      scheduled = null;
    }, intervalMs);
  };
}
