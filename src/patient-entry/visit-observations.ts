import type { Observation } from '@medplum/fhirtypes';
import type { BuiltEntry } from './index.js';
import type { BuiltRecord, PatientEntryContext, PatientEntryRequest, VisitObservationEntry } from './shared.js';
import { LOINC, PatientEntryError, stamp } from './shared.js';
import terminology from './visit-terminology.json' with { type: 'json' };

type VitalBuilder = (request: PatientEntryRequest, now: Date, context: PatientEntryContext) => BuiltEntry;

function validDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new PatientEntryError(`Enter a valid ${field} date (YYYY-MM-DD).`);
  }
  return value;
}

function parseEntry(value: unknown): VisitObservationEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PatientEntryError('Enter valid visit measurements.');
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.kind !== 'string' || !terminology.observations.options.some((option) => option.key === entry.kind)) {
    throw new PatientEntryError('Choose a supported visit measurement.');
  }
  for (const field of ['value', 'systolic', 'diastolic'] as const) {
    if (entry[field] !== undefined && (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]))) {
      throw new PatientEntryError('Measurement values must be finite numbers.');
    }
  }
  for (const field of ['unit', 'note'] as const) {
    if (entry[field] !== undefined && typeof entry[field] !== 'string') {
      throw new PatientEntryError(`Enter valid measurement ${field} text.`);
    }
  }
  return {
    kind: entry.kind,
    value: entry.value as number | undefined,
    systolic: entry.systolic as number | undefined,
    diastolic: entry.diastolic as number | undefined,
    unit: entry.unit as string | undefined,
    note: entry.note as string | undefined,
    date: validDate(entry.date, 'LNMP'),
    measured_at: validDate(entry.measured_at, 'measurement'),
  };
}

/** Containment keeps the visit and its measurements in one atomic save and export. */
export function addVisitObservations(
  built: BuiltRecord, request: PatientEntryRequest, now: Date, context: PatientEntryContext, buildVital: VitalBuilder,
): void {
  if (request.visit_observations === undefined) return;
  if (!Array.isArray(request.visit_observations)) throw new PatientEntryError('Enter valid visit measurements.');
  if (built.resource.resourceType !== 'Encounter') throw new PatientEntryError('Measurements require an encounter.');
  if (request.visit_observations.length === 0) return;
  const encounter = built.resource;
  const observations = request.visit_observations.map((raw, index): Observation => {
    const entry = parseEntry(raw);
    const option = terminology.observations.options.find((item) => item.key === entry.kind);
    if (!option) throw new PatientEntryError('Choose a supported visit measurement.');
    let observation: Observation;
    if (entry.kind === 'lnmp' || entry.kind === 'phq2' || entry.kind === 'phq9') {
      if (!('code' in option)) throw new PatientEntryError('Choose a coded screening or LNMP measurement.');
      observation = {
        resourceType: 'Observation', status: 'final',
        code: {coding: [{system: LOINC, code: option.code}], text: option.label},
        category: [{coding: [{system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'survey', display: 'Survey'}]}],
        subject: {reference: context.subject},
        performer: [{reference: context.subject}],
      };
      if (entry.kind === 'lnmp') {
        if (!entry.date) throw new PatientEntryError('Enter the LNMP start date.');
        if (entry.value !== undefined || entry.systolic !== undefined || entry.diastolic !== undefined || entry.unit) {
          throw new PatientEntryError('LNMP is a date, not a numeric measurement.');
        }
        observation.valueDateTime = entry.date;
      } else {
        if (typeof option.max !== 'number') throw new PatientEntryError('Choose a supported PHQ score.');
        if (entry.value === undefined || !Number.isInteger(entry.value)
          || entry.value < 0 || entry.value > option.max) {
          throw new PatientEntryError(`Enter a whole-number ${option.label} from 0 to ${option.max}.`);
        }
        if (entry.date || entry.systolic !== undefined || entry.diastolic !== undefined
          || (entry.unit && entry.unit !== '{score}')) {
          throw new PatientEntryError('PHQ entries require a total score, not a date, blood pressure or another unit.');
        }
        observation.valueQuantity = {value: entry.value, unit: 'score', system: 'http://unitsofmeasure.org', code: '{score}'};
      }
      stamp(observation, []);
    } else {
      if (entry.date || (entry.kind !== 'blood_pressure' && (entry.systolic !== undefined || entry.diastolic !== undefined))
        || (entry.kind === 'blood_pressure' && entry.value !== undefined)) {
        throw new PatientEntryError('Enter the values appropriate to the selected measurement.');
      }
      if (entry.kind === 'blood_pressure' ? entry.systolic === undefined && entry.diastolic === undefined : entry.value === undefined) {
        throw new PatientEntryError(`Enter a value for ${option.label}.`);
      }
      const vital = buildVital({
        kind: 'vital', vital: entry.kind, value: entry.value, systolic: entry.systolic, diastolic: entry.diastolic,
        unit: entry.unit, effective_date_time: entry.measured_at || encounter.period?.start,
      }, now, context);
      observation = vital.observation;
      built.review.push(...vital.review);
    }
    observation.id = `visit-observation-${index + 1}`;
    observation.encounter = {reference: '#'};
    // With no recorded measurement date, preserve the visit's precision; never date a historical reading today.
    observation.effectiveDateTime = entry.measured_at || encounter.period?.start;
    if (entry.note?.trim()) observation.note = [...(observation.note ?? []), {text: entry.note.trim()}];
    if (entry.kind === 'lnmp') {
      observation.note = [...(observation.note ?? []), {text: 'Reported as the start date of the last normal menstrual period.'}];
    }
    return observation;
  });
  encounter.contained = [...(encounter.contained ?? []), ...observations];
  encounter.extension = [...(encounter.extension ?? []), ...observations.map((observation) => ({
    url: terminology.observations.extension,
    valueReference: {reference: `#${observation.id}`, display: observation.code.text},
  }))];
  if (observations.some((observation) => observation.meta?.tag?.some((tag) => tag.code === 'needs-review'))) {
    const id = encounter.id;
    const meta = encounter.meta;
    stamp(encounter, built.review);
    encounter.id = id;
    encounter.meta = {...meta, ...encounter.meta};
  }
}
