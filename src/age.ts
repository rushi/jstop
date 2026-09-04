const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Largest-two-units display: 42s, 5m, 1h 5m, 2d 3h. The trailing unit is omitted when zero
// (exactly 1h -> "1h"). A missing or future startTime (clock skew) renders as "" so callers
// can treat the suffix as optional.
export const formatAge = (startTime: Date | undefined, now: Date = new Date()): string => {
    if (!startTime) {
        return "";
    }

    const elapsedMs = now.getTime() - startTime.getTime();
    if (elapsedMs < 0) {
        return "";
    }
    if (elapsedMs < MINUTE_MS) {
        return `${Math.floor(elapsedMs / SECOND_MS)}s`;
    }
    if (elapsedMs < HOUR_MS) {
        return `${Math.floor(elapsedMs / MINUTE_MS)}m`;
    }

    const hours = Math.floor(elapsedMs / HOUR_MS);
    const minutes = Math.floor((elapsedMs % HOUR_MS) / MINUTE_MS);
    if (elapsedMs < DAY_MS) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    const days = Math.floor(elapsedMs / DAY_MS);
    const restHours = Math.floor((elapsedMs % DAY_MS) / HOUR_MS);
    return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
};
