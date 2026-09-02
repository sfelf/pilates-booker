import { describe, expect, it } from "vitest";

import {
  projectDebugText,
  projectSafeText,
  SENSITIVE_TEXT,
  UNSAFE_TEXT
} from "../src/safe-text.js";

describe("projectSafeText", () => {
  it("fails closed before inspecting an oversized value", () => {
    expect(projectSafeText("A".repeat(4097))).toBe(UNSAFE_TEXT);
  });

  it("fails closed when encoded inspection exceeds eight layers", () => {
    let raw = "Synthetic%20Class";
    for (let layer = 0; layer < 8; layer += 1) {
      raw = raw.replaceAll("%", "%25");
    }

    expect(projectSafeText(raw)).toBe(UNSAFE_TEXT);
  });

  it.each([
    "Synthetic package\nprivate detail",
    "Synthetic package\rprivate detail",
    "Synthetic\u0000package",
    "\u001b[31mSynthetic package",
    "Synthetic package\\nprivate detail",
    "Synthetic package\\tprivate detail",
    "Synthetic package\\bprivate detail",
    "Synthetic package\\fprivate detail",
    "Synthetic package\\u202eprivate detail",
    "Synthetic package\\ud800private detail",
    "Synthetic package\\u{110000}private detail",
    "Synthetic package\\u005cnprivate detail",
    "Synthetic package%5Cnprivate detail",
    "Synthetic package%5Cu000aprivate detail",
    "Synthetic package%255Cu000aprivate detail",
    "Synthetic package%25255Cu000aprivate detail",
    "Synthetic package%0Aprivate%20detail",
    "Synthetic package%01private%20detail",
    "Synthetic package%09private%20detail",
    "Synthetic package%1Fprivate%20detail",
    "Synthetic package%80private%20detail",
    "Synthetic package%9Fprivate%20detail",
    "Synthetic package%E2%80%A8private%20detail",
    "Synthetic package%250Aprivate%2520detail",
    "Synthetic package%25250Aprivate%252520detail",
    "Synthetic package%25E2%2580%25A9private"
  ])("replaces unsafe raw, escaped, or encoded text %j", (raw) => {
    expect(projectSafeText(raw)).toBe(UNSAFE_TEXT);
  });

  it("is idempotent", () => {
    expect(projectSafeText(projectSafeText("Synthetic\nprivate"))).toBe(
      UNSAFE_TEXT
    );
  });

  it.each(["\u200b", "\u202e", "\u2066", "\ufeff"])(
    "replaces invisible or bidirectional formatting character %j",
    (formatControl) => {
      expect(projectSafeText(`Synthetic${formatControl}private`)).toBe(
        UNSAFE_TEXT
      );
    }
  );

  it.each([
    "Example Movement Class (Level 2) — Étude",
    "Synthetic Package: 5-Class / Monthly",
    "fixture-name (copy).html",
    "/Users/example/Library/Application Support/Arketa Automation/Profile",
    "Café 東京 – mañana",
    "Movement with friends 👩‍👩‍👧‍👦",
    "Movement%20with%20friends%20%F0%9F%91%A9%E2%80%8D%F0%9F%91%A9",
    "Movement%2520with%2520friends%2520%25F0%259F%2591%25A9%25E2%2580%258D%25F0%259F%2591%25A9",
    "Movement with friends \\u200d",
    "100% Synthetic Movement"
  ])("preserves legitimate printable text %j", (raw) => {
    expect(projectSafeText(raw)).toBe(raw);
  });

  it.each(["\u2061", "\u2064", "\ufff9", "\udb40\udc01"])(
    "replaces other Unicode formatting controls %j",
    (formatControl) => {
      expect(projectSafeText(`Synthetic${formatControl}private`)).toBe(
        UNSAFE_TEXT
      );
    }
  );
});

describe("projectDebugText", () => {
  it.each([
    "Authorization: Bearer private-token",
    "Cookie: session=private-cookie",
    "Set-Cookie: session=private-cookie",
    "access_token=private-token",
    "Authorization%3A%20Bearer%20private-token",
    "Authorization%253A%2520Bearer%2520private-token",
    "Authorization\\u003a Bearer private-token"
  ])("replaces recognizable credential material in %j", (raw) => {
    expect(projectDebugText(raw)).toBe(SENSITIVE_TEXT);
    expect(projectDebugText(projectDebugText(raw))).toBe(SENSITIVE_TEXT);
  });

  it.each([
    "⭐ 10-Class Pack",
    "José’s Reformer",
    "https://app.arketa.co/iframe/synthetic/calendar/checkout/CLASS_ID",
    "/Users/example/Library/Application Support/Pilates Booker"
  ])("preserves accepted debug text %j", (raw) => {
    expect(projectDebugText(raw)).toBe(raw);
  });
});
