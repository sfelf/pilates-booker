import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const validateUriFormat = addFormats(new Ajv({ strict: true })).compile({
  type: "string",
  format: "uri"
});

const ARKETA_ORIGIN = "https://app.arketa.co";
const CHECKOUT_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const PERCENT_ESCAPE = /%[0-9a-f]{2}/iu;
const MALFORMED_PERCENT_ESCAPE = /%(?![0-9a-f]{2})/iu;
const MAX_URL_LENGTH = 4096;
const MAX_PERCENT_INSPECTION_LAYERS = 8;

type ArketaUrlKind = "calendar" | "checkout";

function containsUnsafeCodePoint(raw: string): boolean {
  return Array.from(raw).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedJoiner = codePoint === 0x200c || codePoint === 0x200d;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (/\p{Cf}/u.test(character) && !allowedJoiner)
    );
  });
}

function hasSafePercentEncodedRepresentations(raw: string): boolean {
  let inspection = raw;
  for (let layer = 0; layer <= MAX_PERCENT_INSPECTION_LAYERS; layer += 1) {
    if (containsUnsafeCodePoint(inspection)) {
      return false;
    }
    if (!PERCENT_ESCAPE.test(inspection)) {
      return true;
    }

    try {
      const decoded = decodeURIComponent(inspection);
      if (decoded === inspection) {
        return true;
      }
      inspection = decoded;
    } catch {
      return false;
    }
  }

  return false;
}

function hasAllowedRawSyntax(raw: string, kind: ArketaUrlKind): boolean {
  if (
    raw.length === 0 ||
    raw.length > MAX_URL_LENGTH ||
    !raw.startsWith(`${ARKETA_ORIGIN}/`) ||
    raw.includes("\\") ||
    raw.includes("#") ||
    MALFORMED_PERCENT_ESCAPE.test(raw) ||
    containsUnsafeCodePoint(raw) ||
    !validateUriFormat(raw)
  ) {
    return false;
  }

  if (kind === "checkout" && (raw.includes("?") || raw.includes("%"))) {
    return false;
  }

  return kind === "checkout" || hasSafePercentEncodedRepresentations(raw);
}

function parseArketaUrl(raw: string, kind: ArketaUrlKind): URL | undefined {
  if (!hasAllowedRawSyntax(raw, kind)) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "app.arketa.co" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.href !== raw
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function validateCheckoutUrl(raw: string): URL {
  const url = parseArketaUrl(raw, "checkout");
  const segments = url?.pathname.split("/");

  if (
    url === undefined ||
    segments?.length !== 6 ||
    segments[1] !== "iframe" ||
    !CHECKOUT_SEGMENT.test(segments[2] ?? "") ||
    segments[3] !== "calendar" ||
    segments[4] !== "checkout" ||
    !CHECKOUT_SEGMENT.test(segments[5] ?? "")
  ) {
    throw new Error("Invalid Arketa checkout URL.");
  }

  return url;
}

export function validateCalendarUrl(raw: string): string | undefined {
  return parseArketaUrl(raw, "calendar") === undefined ? undefined : raw;
}
