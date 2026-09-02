export const UNSAFE_TEXT = "[unsafe text omitted]";
export const SENSITIVE_TEXT = "[sensitive text omitted]";

const MAX_DIAGNOSTIC_TEXT_LENGTH = 4096;
const MAX_INSPECTION_LAYERS = 8;
const FORMAT_CHARACTER = /\p{Cf}/u;
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/giu;
const PERCENT_BYTE = /[0-9a-f]{2}/giu;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function containsRawUnsafeText(raw: string): boolean {
  return Array.from(raw).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedJoiner = codePoint === 0x200c || codePoint === 0x200d;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (FORMAT_CHARACTER.test(character) && !allowedJoiner)
    );
  });
}

function decodeEscapesForInspection(raw: string): string | undefined {
  const simpleEscapes: Readonly<Record<string, string>> = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    0: "\0"
  };

  try {
    return raw
      .replace(/\\u\{([0-9a-f]{1,6})\}/giu, (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16))
      )
      .replace(/\\u([0-9a-f]{4})/giu, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/\\x([0-9a-f]{2})/giu, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(
        /\\([bfnrtv0])/gu,
        (_, escape: string) => simpleEscapes[escape] ?? ""
      );
  } catch {
    return undefined;
  }
}

function decodePercentLayer(raw: string): string | undefined {
  try {
    return raw.replace(PERCENT_RUN, (run) => {
      const bytes = run
        .match(PERCENT_BYTE)
        ?.map((hex) => Number.parseInt(hex, 16));
      return utf8Decoder.decode(Uint8Array.from(bytes ?? []));
    });
  } catch {
    return undefined;
  }
}

function containsUnsafeRepresentation(raw: string): boolean {
  let inspection = raw;
  for (let layer = 0; layer <= MAX_INSPECTION_LAYERS; layer += 1) {
    if (containsRawUnsafeText(inspection)) {
      return true;
    }

    const escaped = decodeEscapesForInspection(inspection);
    if (escaped === undefined) {
      return true;
    }

    const decoded = decodePercentLayer(escaped);
    if (decoded === undefined) {
      return true;
    }
    if (decoded === inspection) {
      return false;
    }
    inspection = decoded;
  }

  return true;
}

export function projectSafeText(raw: string): string {
  if (
    raw.length > MAX_DIAGNOSTIC_TEXT_LENGTH ||
    containsUnsafeRepresentation(raw)
  ) {
    return UNSAFE_TEXT;
  }

  return raw;
}

const CREDENTIAL_MATERIAL =
  /(?:^|\b)(?:authorization|proxy-authorization|cookie|set-cookie|(?:access_|refresh_|id_)?token)(?:\\?["'])?\s*[:=]/iu;

function containsCredentialRepresentation(raw: string): boolean {
  let inspection = raw;
  for (let layer = 0; layer <= MAX_INSPECTION_LAYERS; layer += 1) {
    if (CREDENTIAL_MATERIAL.test(inspection)) return true;

    const escaped = decodeEscapesForInspection(inspection);
    if (escaped === undefined) return true;
    if (CREDENTIAL_MATERIAL.test(escaped)) return true;

    const decoded = decodePercentLayer(escaped);
    if (decoded === undefined) return true;
    if (decoded === inspection) return false;
    inspection = decoded;
  }

  return true;
}

export function projectDebugText(raw: string): string {
  if (raw === SENSITIVE_TEXT) return SENSITIVE_TEXT;
  const safe = projectSafeText(raw);
  if (safe === UNSAFE_TEXT) return UNSAFE_TEXT;
  return containsCredentialRepresentation(safe) ? SENSITIVE_TEXT : safe;
}
