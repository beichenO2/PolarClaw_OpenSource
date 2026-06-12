/**
 * Shared helper — compile a full JSON Schema (with definitions) and
 * return a validator for a specific $ref within it.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTRACTS_DIR = resolve(__dirname, '../../contracts');

export function loadSchema(filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(CONTRACTS_DIR, filename), 'utf-8'));
}

export function compileDefinition(
  schema: Record<string, unknown>,
  definitionName: string,
): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);

  ajv.addSchema(schema, 'root');
  const validate = ajv.compile({ $ref: `root#/definitions/${definitionName}` });
  return validate;
}
