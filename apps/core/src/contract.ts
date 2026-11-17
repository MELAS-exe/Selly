// Test helper: validates a response against its schema in docs/api.json, by path template, method and status.
// The agent and web code against that file, so core must answer exactly what it says.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/api.json', import.meta.url)), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, allErrors: true, discriminator: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const cache = new Map<string, ReturnType<typeof ajv.compile>>();

/** Throws with the schema errors when `body` does not match the contract. */
export function assertContract(
  method: string,
  pathTemplate: string,
  status: number,
  body: unknown,
) {
  const key = `${method} ${pathTemplate} ${status}`;
  let validate = cache.get(key);
  if (!validate) {
    const op = doc.paths[pathTemplate]?.[method.toLowerCase()];
    if (!op) throw new Error(`docs/api.json has no ${method} ${pathTemplate}`);
    let resp = op.responses[String(status)];
    if (!resp)
      throw new Error(`docs/api.json has no ${status} response for ${method} ${pathTemplate}`);
    if (resp.$ref) resp = doc.components.responses[resp.$ref.split('/').pop()];
    const media = resp.content?.['application/json'] ?? resp.content?.['application/problem+json'];
    if (!media) throw new Error(`${key}: no JSON body in docs/api.json`);
    validate = ajv.compile({ ...media.schema, components: doc.components });
    cache.set(key, validate);
  }
  if (!validate(body)) {
    throw new Error(
      `${key} does not match docs/api.json: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
    );
  }
}
