import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const [icd10Archive, icd9Archive] = process.argv.slice(2);
if (!icd10Archive || !icd9Archive) {
  throw new Error('Usage: node scripts/build-icd-catalogs.mjs <CDC FY2027 ZIP> <CMS v32 ZIP>');
}
const output = fileURLToPath(new URL('../frontend/src/assets/terminology/', import.meta.url));
mkdirSync(output, {recursive: true});

for (const catalog of [
  {
    archive: icd10Archive, member: 'icd10cm-code-descriptions-2027/icd10cm-codes-2027.txt',
    name: 'icd-10-cm', version: 'FY2027', minimum: 70000, encoding: 'utf-8',
    source: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/icd10cm-code-descriptions-2027.zip',
  },
  {
    archive: icd9Archive, member: 'CMS32_DESC_LONG_DX.txt',
    name: 'icd-9-cm', version: 'v32 (FY2015, final)', minimum: 14000, encoding: 'windows-1252',
    source: 'https://www.cms.gov/medicare/coding/icd9providerdiagnosticcodes/downloads/icd-9-cm-v32-master-descriptions.zip',
  },
]) {
  const bytes = execFileSync('unzip', ['-p', catalog.archive, catalog.member], {maxBuffer: 20 * 1024 * 1024});
  const text = new TextDecoder(catalog.encoding, {fatal: true}).decode(bytes);
  const entries = text.trim().split(/\r?\n/).map((line) => {
    const match = /^([A-Z0-9]+)\s+(.+)$/.exec(line);
    if (!match) throw new Error(`Invalid ${catalog.name} row`);
    const [, raw, display] = match;
    const split = catalog.name === 'icd-9-cm' && raw.startsWith('E') ? 4 : 3;
    const code = raw.length > split ? `${raw.slice(0, split)}.${raw.slice(split)}` : raw;
    return [code, display.trim()];
  });
  if (entries.length < catalog.minimum || new Set(entries.map(([code]) => code)).size !== entries.length) {
    throw new Error(`Incomplete or duplicate ${catalog.name} catalog`);
  }
  writeFileSync(`${output}${catalog.name}.json`, JSON.stringify({
    system: `http://hl7.org/fhir/sid/${catalog.name}`, version: catalog.version, source: catalog.source, entries,
  }) + '\n');
  console.log(`${catalog.name}: ${entries.length} diagnosis codes`);
}
