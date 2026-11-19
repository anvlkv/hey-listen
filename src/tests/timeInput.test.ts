import { expect, it } from "vitest";
import { parseTime } from "../components/timeline/format";

/**
 * Unit checks for the Timeline's window-field parser (`components/timeline/format.ts`)
 * — the inverse of `formatTime` that backs the numeric Window form (D-05). A rejected
 * string is what makes a mistyped field revert instead of writing a nonsense window.
 */

it("parses minutes and seconds with a fraction", () => {
  expect(parseTime("1:02.500")).toBe(62.5);
  expect(parseTime("0:01.5")).toBe(1.5);
  expect(parseTime("12:34.567")).toBe(754.567);
});

it("parses hours as the leading part", () => {
  expect(parseTime("1:02:03.5")).toBe(3723.5);
});

it("accepts bare seconds", () => {
  expect(parseTime("62.5")).toBe(62.5);
  expect(parseTime("0")).toBe(0);
});

it("carries a part over 59 into the next unit", () => {
  expect(parseTime("1:62")).toBe(122);
});

it("rejects empty, non-numeric, negative and malformed text", () => {
  expect(parseTime("")).toBeNull();
  expect(parseTime("   ")).toBeNull();
  expect(parseTime("abc")).toBeNull();
  expect(parseTime("-1")).toBeNull();
  expect(parseTime("1::2")).toBeNull();
  expect(parseTime("1:2:3:4")).toBeNull();
});

it("rounds to whole milliseconds", () => {
  expect(parseTime("1.23456")).toBe(1.235);
  expect(parseTime("2.00049")).toBe(2);
  expect(parseTime("0:00.0004")).toBe(0);
});
