import { createRequire } from "node:module";

import resultSchema from "../schemas/result.schema.json" with { type: "json" };
import type { BookingResult } from "./contracts.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true }));
const resultValidator = ajv.compile(resultSchema);

export const validateResult = (value: unknown): value is BookingResult =>
  resultValidator(value) as boolean;
