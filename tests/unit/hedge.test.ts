import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hedge } from "@/lib/hedge";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// An attempt that answers (or fails) after ms, and notes whether it was aborted.
const attempts: { aborted: boolean }[] = [];
const after = (ms: number, value: string, fail = false) => (signal: AbortSignal) => {
  const a = { aborted: false };
  attempts.push(a);
  return new Promise<string>((res, rej) => {
    // like fetch, an aborted attempt fails at once
    signal.addEventListener("abort", () => { a.aborted = true; rej(new Error("aborted")); });
    setTimeout(() => (fail ? rej(new Error(value)) : res(value)), ms);
  });
};
beforeEach(() => { attempts.length = 0; });

describe("a hedged call", () => {
  test("a quick answer: one attempt only", async () => {
    const p = hedge(after(1000, "a"), 4000, 12000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("a");
    await vi.advanceTimersByTimeAsync(20000);
    expect(attempts.length).toBe(1);
  });

  test("a slow first answer: a second attempt starts at 4 s and the first answer wins; the other is aborted", async () => {
    const times = [26000, 3000];
    const p = hedge((s) => after(times.shift() as number, `took ${attempts.length + 1}`)(s), 4000, 12000);
    await vi.advanceTimersByTimeAsync(7000);
    await expect(p).resolves.toBe("took 2");
    expect(attempts.map((a) => a.aborted)).toEqual([true, true]);
  });

  test("a failure before the second attempt ends the call; one of two failing waits for the other", async () => {
    const p = hedge(after(1000, "bad", true), 4000, 12000);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBe("bad");
    expect(attempts.length).toBe(1);
    const plan: [number, string, boolean][] = [[5000, "bad", true], [2000, "good", false]];
    const q = hedge((s) => { const [ms, v, f] = plan.shift() as [number, string, boolean]; return after(ms, v, f)(s); }, 4000, 12000);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(q).resolves.toBe("good");
  });

  test("both failing ends with the last error; nothing by the limit ends with timeout", async () => {
    const plan: [number, string][] = [[5000, "first"], [3000, "second"]];
    const p = hedge((s) => { const [ms, v] = plan.shift() as [number, string]; return after(ms, v, true)(s); }, 4000, 12000);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await caught).toBe("second");
    const q = hedge(after(30000, "late"), 4000, 12000);
    const late = q.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await late).toBe("timeout");
    expect(attempts.slice(-2).map((a) => a.aborted)).toEqual([true, true]);
  });
});
