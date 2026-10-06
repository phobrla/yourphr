import {describe, expect, it} from 'vitest';
import type {Encounter, Observation} from '@medplum/fhirtypes';
import {buildPatientRecord, PatientEntryError} from '../index.js';
import type {VisitObservationEntry} from '../shared.js';
import terminology from '../visit-terminology.json' with {type: 'json'};

const now = new Date('2026-10-06T12:00:00Z');
const visit = {kind: 'visit', name: 'Synthetic visit', visit_type: 'Consultation', visit_class: 'AMB', effective_date_time: '2020-04-20'};
const subject = {subject: 'Patient/synthetic'};

function build(entries: VisitObservationEntry[]) {
  return buildPatientRecord({...visit, visit_observations: entries}, now, subject);
}

describe('encounter measurements', () => {
  it('stores repeatable linked measurements without replacing the note, diagnosis, location or complaint', () => {
    const built = buildPatientRecord({...visit,
      note: 'Synthetic clinician wording retained as entered',
      visit_reasons: [{text: 'Synthetic concern', primary: true}],
      visit_location_code: '22232009',
      visit_diagnoses: [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10'}],
      visit_observations: [
        {kind: 'body_weight', value: 68, unit: 'kg'},
        {kind: 'body_height', value: 172, unit: 'cm', note: 'Standing measurement'},
        {kind: 'body_mass_index', value: 23, unit: 'kg/m2'},
        {kind: 'heart_rate', value: 73},
        {kind: 'respiratory_rate', value: 18},
        {kind: 'body_temperature', value: 98.1, unit: '[degF]', note: 'Oral'},
        {kind: 'oxygen_saturation', value: 97},
        {kind: 'blood_pressure', systolic: 122, diastolic: 78},
        {kind: 'heart_rate', value: 71, measured_at: '2020-04-21'},
      ],
    }, now, subject);
    const encounter = built.resource as Encounter;
    const measurements = encounter.contained?.filter((item): item is Observation =>
      item.resourceType === 'Observation' && item.id !== 'chief-complaint') ?? [];
    expect(measurements).toHaveLength(9);
    expect(encounter.diagnosis).toHaveLength(1);
    expect(encounter.reasonReference?.[0]?.reference).toBe('#chief-complaint');
    expect(encounter.location?.[0]?.location.reference).toBe('#visit-location');
    expect(encounter.text?.div).toContain('Synthetic clinician wording');
    for (const measurement of measurements) {
      expect(measurement.encounter).toEqual({reference: '#'});
      expect(measurement.subject).toEqual({reference: subject.subject});
      expect(measurement.meta?.tag).toContainEqual(expect.objectContaining({code: 'pghd'}));
      expect(encounter.extension).toContainEqual({
        url: terminology.observations.extension,
        valueReference: {reference: `#${measurement.id}`, display: measurement.code.text},
      });
    }
    expect(measurements[0]?.effectiveDateTime).toBe('2020-04-20');
    expect(measurements[8]?.effectiveDateTime).toBe('2020-04-21');
    expect(measurements[1]?.code.coding?.[0]?.code).toBe('8302-2');
    expect(measurements[2]?.code.coding?.[0]?.code).toBe('39156-5');
    expect(measurements[4]?.code.coding?.[0]?.code).toBe('9279-1');
    expect(measurements[5]?.valueQuantity).toMatchObject({value: 98.1, code: '[degF]'});
    expect(measurements[5]?.note).toEqual([{text: 'Oral'}]);
    expect(measurements[7]?.component).toEqual([
      expect.objectContaining({valueQuantity: expect.objectContaining({value: 122})}),
      expect.objectContaining({valueQuantity: expect.objectContaining({value: 78})}),
    ]);
    expect(built.review).toEqual([]);
  });

  it('keeps zero and maximum PHQ totals as survey scores, never diagnoses or invented answers', () => {
    const encounter = build([
      {kind: 'phq2', value: 0}, {kind: 'phq2', value: 6},
      {kind: 'phq9', value: 0}, {kind: 'phq9', value: 27},
    ]).resource as Encounter;
    const observations = encounter.contained as Observation[];
    expect(observations.map((item) => item.valueQuantity?.value)).toEqual([0, 6, 0, 27]);
    expect(observations.map((item) => item.code.coding?.[0]?.code)).toEqual(['55758-7', '55758-7', '44261-6', '44261-6']);
    for (const item of observations) {
      expect(item.category?.[0]?.coding?.[0]?.code).toBe('survey');
      expect(item.valueQuantity).toMatchObject({system: 'http://unitsofmeasure.org', code: '{score}'});
      expect(item.component).toBeUndefined();
      expect(item.interpretation).toBeUndefined();
    }
    expect(encounter.diagnosis).toBeUndefined();
  });

  it('keeps the LNMP date separate from the visit date and preserves the normal qualifier', () => {
    const encounter = build([{kind: 'lnmp', date: '2020-04-04', measured_at: '2020-04-19', note: 'Reported date'}]).resource as Encounter;
    expect(encounter.contained?.[0]).toMatchObject({
      resourceType: 'Observation', valueDateTime: '2020-04-04', effectiveDateTime: '2020-04-19',
      code: {coding: [{system: 'http://loinc.org', code: '8665-2'}], text: 'Last normal menstrual period (LNMP)'},
      note: [{text: 'Reported date'}, {text: 'Reported as the start date of the last normal menstrual period.'}],
    });
    expect(encounter.contained?.[0]).not.toHaveProperty('valueQuantity');
    expect(encounter.period?.start).toBe('2020-04-20');
  });

  it('keeps partial blood pressure and flags both measurement and encounter for review', () => {
    const built = build([{kind: 'blood_pressure', systolic: 122}]);
    const encounter = built.resource as Encounter;
    const observation = encounter.contained?.[0] as Observation;
    expect(observation.component).toHaveLength(1);
    expect(built.review).toContain('only the systolic half of this blood pressure was given');
    expect(observation.meta?.tag).toContainEqual(expect.objectContaining({code: 'needs-review'}));
    expect(encounter.meta?.tag).toContainEqual(expect.objectContaining({code: 'needs-review'}));
    expect(encounter.meta?.profile).toContain('http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter');
  });

  it('does not invent observations for an omitted or empty section', () => {
    for (const request of [visit, {...visit, visit_observations: []}]) {
      const encounter = buildPatientRecord(request, now, subject).resource as Encounter;
      expect(encounter.contained ?? []).toEqual([]);
      expect(encounter.extension ?? []).toEqual([]);
    }
  });

  it('does not date a historical measurement today when the encounter date cannot be read', () => {
    const built = buildPatientRecord({...visit, effective_date_time: 'unknown historical date',
      visit_observations: [{kind: 'body_weight', value: 68}]}, now, subject);
    const encounter = built.resource as Encounter;
    expect(encounter.period?.start).toBeUndefined();
    expect((encounter.contained?.[0] as Observation).effectiveDateTime).toBeUndefined();
    expect(built.review.some((reason) => reason.includes('has no date'))).toBe(true);
  });

  it('refuses visit measurements on non-encounter entry kinds', () => {
    expect(() => buildPatientRecord({kind: 'vital', vital: 'body_weight', value: 68,
      visit_observations: [{kind: 'phq2', value: 0}]}, now, subject)).toThrow(PatientEntryError);
  });

  it.each([
    {kind: 'phq2', value: -1}, {kind: 'phq2', value: 7}, {kind: 'phq9', value: 28},
    {kind: 'phq9', value: 2.5}, {kind: 'phq2'}, {kind: 'body_weight'}, {kind: 'blood_pressure'},
    {kind: 'lnmp'}, {kind: 'lnmp', date: '2020-02-30'}, {kind: 'lnmp', date: '04/04/2020'},
    {kind: 'heart_rate', value: Infinity}, {kind: 'respiratory_rate', value: NaN},
    {kind: 'heart_rate', value: 70, measured_at: '2020-02-30'},
    {kind: 'phq2', value: 2, unit: 'kg'}, {kind: 'lnmp', date: '2020-04-04', value: 2},
    {kind: 'blood_pressure', systolic: 122, value: 5}, {kind: 'body_weight', value: 70, systolic: 122},
    {kind: 'unsupported', value: 2},
  ])('refuses invalid input without a successful-shaped fallback: %j', (entry) => {
    expect(() => build([entry])).toThrow(PatientEntryError);
  });

  it('rejects malformed JSON shapes', () => {
    for (const entries of [null, {}, [null], [{kind: 'heart_rate', value: '70'}], [{kind: 'phq2', value: null}]]) {
      expect(() => buildPatientRecord({...visit, visit_observations: entries} as never, now, subject)).toThrow(PatientEntryError);
    }
  });
});
