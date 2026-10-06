import type { Condition, Encounter } from '@medplum/fhirtypes';
import { PatientEntryError, stamp, type VisitDiagnosisEntry } from './shared.js';
import terminology from './visit-terminology.json' with { type: 'json' };

const ICD_FORMATS = new Map([
  ['http://hl7.org/fhir/sid/icd-10-cm', /^[A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4}|[A-Z0-9]{1,4})?$/],
  ['http://hl7.org/fhir/sid/icd-9-cm', /^(?:[0-9]{3}(?:\.[0-9]{1,2}|[0-9]{1,2})?|V[0-9]{2}(?:\.[0-9]{1,2}|[0-9]{1,2})?|E[0-9]{3}(?:\.[0-9]|[0-9])?)$/],
]);

function text(value: unknown, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new PatientEntryError(`Enter a valid diagnosis ${field}.`);
  return value.trim();
}

export function parseVisitDiagnoses(value: unknown): VisitDiagnosisEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PatientEntryError('Enter diagnoses as a list.');
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new PatientEntryError('Enter a valid diagnosis.');
    const row = item as Record<string, unknown>;
    const condition_id = text(row['condition_id'], 'reference');
    const system = text(row['system'], 'code system');
    const rawCode = text(row['code'], 'code').toUpperCase();
    const display = text(row['display'], 'description');
    const expected_end_date = text(row['expected_end_date'], 'expected end date');
    if (expected_end_date && (!/^\d{4}-\d{2}-\d{2}$/.test(expected_end_date)
      || expected_end_date.startsWith('0000')
      || !Number.isFinite(Date.parse(expected_end_date))
      || new Date(expected_end_date).toISOString().slice(0, 10) !== expected_end_date)) {
      throw new PatientEntryError('Enter a valid diagnosis expected end date (YYYY-MM-DD).');
    }
    if (condition_id) {
      if (system || rawCode || display) throw new PatientEntryError('Link an existing diagnosis or enter an ICD code, not both.');
      if (!/^[A-Za-z0-9.-]{1,64}$/.test(condition_id)) throw new PatientEntryError('Choose a valid diagnosis reference.');
      return { condition_id, ...(expected_end_date ? { expected_end_date } : {}) };
    }
    if (!system || !ICD_FORMATS.get(system)?.test(rawCode)) {
      throw new PatientEntryError('Enter a correctly formatted ICD-9-CM or ICD-10-CM diagnosis code.');
    }
    const decimalAt = system.endsWith('icd-9-cm') && rawCode.startsWith('E') ? 4 : 3;
    const code = rawCode.length > decimalAt && !rawCode.includes('.')
      ? `${rawCode.slice(0, decimalAt)}.${rawCode.slice(decimalAt)}` : rawCode;
    return { system, code, ...(display ? { display } : {}), ...(expected_end_date ? { expected_end_date } : {}) };
  });
}

export function addVisitDiagnoses(encounter: Encounter, entries: VisitDiagnosisEntry[], existingIds: string[]): void {
  const diagnoses = new Map<string, NonNullable<Encounter['diagnosis']>[number]>();
  for (const id of existingIds) diagnoses.set(`Condition/${id}`, { condition: { reference: `Condition/${id}` } });
  const seenCodes = new Set<string>();
  for (const entry of entries) {
    const extension = entry.expected_end_date
      ? [{ url: terminology.diagnosis.expectedEndDateExtension, valueDate: entry.expected_end_date }] : undefined;
    if (entry.condition_id) {
      const reference = `Condition/${entry.condition_id}`;
      const previous = diagnoses.get(reference);
      if (previous?.extension && JSON.stringify(previous.extension) !== JSON.stringify(extension)) {
        throw new PatientEntryError('A linked diagnosis has conflicting expected end dates.');
      }
      diagnoses.set(reference, { condition: { reference }, ...(extension ? { extension } : {}) });
      continue;
    }
    const key = `${entry.system}|${entry.code}`;
    if (seenCodes.has(key)) throw new PatientEntryError('The same ICD diagnosis was entered more than once.');
    seenCodes.add(key);
    const id = `visit-diagnosis-${seenCodes.size}`;
    const condition: Condition = {
      resourceType: 'Condition',
      subject: { reference: encounter.subject?.reference },
      category: [{ coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis',
      }] }],
      code: {
        coding: [{ system: entry.system, code: entry.code, ...(entry.display ? { display: entry.display } : {}) }],
        ...(entry.display ? { text: entry.display } : {}),
      },
      asserter: { reference: encounter.subject?.reference },
    };
    stamp(condition, []);
    condition.id = id;
    encounter.contained = [...(encounter.contained ?? []), condition];
    diagnoses.set(`#${id}`, {
      condition: { reference: `#${id}`, display: entry.display || entry.code },
      ...(extension ? { extension } : {}),
    });
  }
  if (diagnoses.size) encounter.diagnosis = [...diagnoses.values()];
}
