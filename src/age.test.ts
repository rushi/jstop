import { describe, expect, it } from "vitest";
import { formatAge } from "./age.js";

describe("formatAge", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const startedAgo = (ms: number) => new Date(now.getTime() - ms);

    it("formats under a minute as seconds", () => {
        expect(formatAge(startedAgo(42_000), now)).toBe("42s");
    });

    it("formats under an hour as whole minutes, dropping leftover seconds", () => {
        expect(formatAge(startedAgo(5 * 60_000 + 59_000), now)).toBe("5m");
    });

    it("formats under a day as hours and minutes", () => {
        expect(formatAge(startedAgo(65 * 60_000), now)).toBe("1h 5m");
        expect(formatAge(startedAgo(23 * 3_600_000 + 59 * 60_000), now)).toBe("23h 59m");
    });

    it("formats a day or more as days and hours, dropping leftover minutes", () => {
        expect(formatAge(startedAgo(2 * 86_400_000 + 3 * 3_600_000 + 40 * 60_000), now)).toBe("2d 3h");
    });

    it("omits a zero trailing unit", () => {
        expect(formatAge(startedAgo(3_600_000), now)).toBe("1h");
        expect(formatAge(startedAgo(2 * 86_400_000), now)).toBe("2d");
    });

    it("formats zero elapsed as 0s", () => {
        expect(formatAge(now, now)).toBe("0s");
    });

    it("returns empty for a missing startTime", () => {
        expect(formatAge(undefined, now)).toBe("");
    });

    it("returns empty for a future startTime (clock skew)", () => {
        expect(formatAge(new Date(now.getTime() + 1000), now)).toBe("");
    });
});
