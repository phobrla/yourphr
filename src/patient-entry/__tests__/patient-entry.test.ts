import { describe, expect, it } from 'vitest';
import { PATIENT_ENTRY_SOURCE, PatientEntryError, buildPatientRecord, buildPatientVital, validateVisitDiagnosisIds } from '../index.js';
import { titleFor } from '../../server.js';
import { parseVisitDiagnoses } from '../visit-diagnoses.js';
import type { Encounter } from '@medplum/fhirtypes';
import terminology from '../visit-terminology.json' with { type: 'json' };

/** Fixed, so the default-time assertion is about the shape rather than the clock. */
const NOW = new Date('2026-09-23T10:30:00.000Z');

describe('a vital the patient measured', () => {
  it('is a US Core vital-signs Observation with the LOINC code Go used', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'body_weight', value: 72.5, effective_date_time: '2026-09-20' }, NOW);
    expect(observation).toMatchObject({
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }] },
      effectiveDateTime: '2026-09-20',
      valueQuantity: { value: 72.5, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' },
    });
    expect(sortTitle).toBe('Body weight 72.5 kg');
    expect(observation.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says it is patient-generated (PGHD), so it can never be mistaken for what a hospital asserted (yourphr#806)', () => {
    const { observation } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW);
    expect(observation.meta).toMatchObject({
      source: PATIENT_ENTRY_SOURCE,
      tag: [{ system: 'https://yourphr.org/fhir/CodeSystem/record-origin', code: 'pghd' }],
    });
  });

  it('carries a blood pressure as two components, not one value', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW);
    expect(observation.code?.coding?.[0]?.code).toBe('85354-9');
    expect(observation.valueQuantity).toBeUndefined();
    expect(observation.component?.map((c) => [c.code?.coding?.[0]?.code, c.valueQuantity?.value, c.valueQuantity?.code])).toEqual([
      ['8480-6', 128, 'mm[Hg]'],
      ['8462-4', 78, 'mm[Hg]'],
    ]);
    expect(sortTitle).toBe('Blood pressure 128/78 mmHg');
  });

  it('keeps the canonical UCUM code when the person types a friendlier unit — a coded unit is what makes it comparable', () => {
    const { observation, sortTitle } = buildPatientVital({ vital: 'heart_rate', value: 64, unit: 'bpm' }, NOW);
    expect(observation.valueQuantity).toEqual({ value: 64, unit: 'bpm', system: 'http://unitsofmeasure.org', code: '/min' });
    expect(sortTitle).toBe('Heart rate 64 bpm');
  });

  it('accepts the v2-era aliases, so a client written against Go still works', () => {
    for (const [alias, code] of [['weight', '29463-7'], ['pulse', '8867-4'], ['temperature', '8310-5'], ['spo2', '2708-6'], ['bp', '85354-9']] as const) {
      const req = code === '85354-9' ? { vital: alias, systolic: 120, diastolic: 80 } : { vital: alias, value: 1 };
      expect(buildPatientVital(req, NOW).observation.code?.coding?.[0]?.code, alias).toBe(code);
    }
  });

  it('defaults the time to now in UTC, and never invents a time zone for a date-only entry', () => {
    expect(buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW).observation.effectiveDateTime).toBe('2026-09-23T10:30:00Z');
    expect(buildPatientVital({ vital: 'heart_rate', value: 64, effective_date_time: '2026-09-01' }, NOW).observation.effectiveDateTime).toBe('2026-09-01');
  });
});

describe('what it keeps when it cannot code what was said (yourphr#696)', () => {
  const tagged = (o: { meta?: { tag?: { code?: string }[] } }) => (o.meta?.tag ?? []).some((t) => t.code === 'needs-review');

  it('stores an unknown measurement as the person\'s own words, uncoded, for review', () => {
    const { observation, sortTitle, review } = buildPatientVital({ vital: 'peak flow', value: 400, unit: 'L/min' }, NOW);
    expect(observation.code).toEqual({ text: 'peak flow' }); // no coding invented
    expect(observation.valueQuantity).toBeUndefined(); // nor a value hung off a code that is not there
    expect(sortTitle).toBe('peak flow');
    expect(review[0]).toContain('not a measurement this release knows how to code');
    expect(tagged(observation)).toBe(true);
  });

  it('keeps half a blood pressure — 128 is a fact — and says the other half is missing', () => {
    const { observation, sortTitle, review } = buildPatientVital({ vital: 'blood_pressure', systolic: 128 }, NOW);
    expect(observation.component).toEqual([
      { code: expect.objectContaining({ text: 'Systolic blood pressure' }), valueQuantity: { value: 128, unit: 'mm[Hg]', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
    ]);

    expect(sortTitle).toBe('Blood pressure 128 systolic mmHg');
    expect(review[0]).toContain('only the systolic half');
    expect(tagged(observation)).toBe(true);
  });

  it('leaves a record with NO date when the date cannot be read, rather than dating it today', () => {
    const { observation, review } = buildPatientVital({ vital: 'heart_rate', value: 64, effective_date_time: 'last tuesday' }, NOW);
    expect(observation.effectiveDateTime).toBeUndefined();
    expect(observation.valueQuantity?.value).toBe(64); // the reading is still kept
    expect(review[0]).toContain('could not be read');
    expect(tagged(observation)).toBe(true);
  });

  it('keeps a kind it cannot yet store in its own resource type, and says so', () => {
    const { resource, review } = buildPatientRecord({ kind: 'procedure', name: 'knee arthroscopy' }, NOW);
    expect(resource.resourceType).toBe('Observation'); // kept, in the only shape available
    expect((resource as { code?: unknown }).code).toEqual({ text: 'knee arthroscopy' });
    expect(review.some((r) => r.includes('cannot yet store a "procedure"'))).toBe(true);
    expect(tagged(resource as { meta?: { tag?: { code?: string }[] } })).toBe(true);
  });

  it('records a measurement with no reading yet, rather than dropping the fact that it was named', () => {
    const { observation, review } = buildPatientVital({ vital: 'body_weight' }, NOW);
    expect(observation.code?.coding?.[0]?.code).toBe('29463-7');
    expect(observation.valueQuantity).toBeUndefined();
    expect(review[0]).toContain('no reading was given');
  });

  // CodeQL alert 70: a kind or a vital named after something every object inherits used to reach an
  // inherited member — "constructor" was a callable, "toString" a function standing in for a spec.
  it('treats an inherited property name as the ordinary unknown it is', () => {
    const asKind = buildPatientRecord({ kind: 'constructor', name: 'peak flow', value: 400 }, NOW);
    expect(asKind.resource.resourceType).toBe('Observation');
    expect(asKind.review.some((r) => r.includes('cannot yet store a "constructor"'))).toBe(true);

    const asVital = buildPatientVital({ vital: 'toString', value: 1 }, NOW);
    expect(asVital.observation.code).toEqual({ text: 'toString' }); // their words, uncoded
    expect(asVital.review[0]).toContain('not a measurement this release knows how to code');
  });

  it('refuses ONLY an empty submission — no name and no reading is not a fact', () => {
    expect(() => buildPatientVital({}, NOW)).toThrow(PatientEntryError);
    expect(() => buildPatientVital({}, NOW)).toThrow('there is nothing to record');
  });

  it('marks nothing for review when everything was understood', () => {
    const { observation, review } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW);
    expect(review).toEqual([]);
    expect(tagged(observation)).toBe(false);
  });
});

describe('a manually entered visit', () => {
  const visit = { kind: 'visit', name: 'Follow-up', visit_type: 'Consultation', visit_class: 'AMB' };
  const patient = { subject: 'Patient/self-1' };

  it('keeps multiple reasons, one chief complaint, and a single coded visit type', () => {
    const {resource} = buildPatientRecord({
      ...visit, visit_type_code: '185389009', visit_type: 'untrusted label',
      visit_reasons: [
        {text: 'Review my results'},
        {text: 'My head hurts', code: '25064002', primary: true},
      ],
      visit_location_code: '22232009',
      visit_diagnoses: [{system: terminology.diagnosis.systems[0]!.system, code: 'I10'}],
    }, NOW, patient);
    const encounter = resource as Encounter;
    expect(encounter.type).toEqual([{text: 'Follow-up consultation', coding: [{system: 'http://snomed.info/sct', code: '185389009', display: 'Follow-up consultation'}]}]);
    expect(encounter.reasonCode).toEqual([
      {text: 'Review my results'},
      {text: 'My head hurts', coding: [{system: 'http://snomed.info/sct', code: '25064002', display: 'Headache'}]},
    ]);
    expect(encounter.reasonReference).toEqual([{reference: '#chief-complaint', display: 'My head hurts'}]);
    expect(encounter.contained?.find((item) => item.id === 'chief-complaint')).toMatchObject({
      resourceType: 'Observation', status: 'final', valueString: 'My head hurts',
      code: {coding: [{system: 'http://loinc.org', code: '10154-3'}]},
      subject: {reference: patient.subject}, encounter: {reference: '#'},
      meta: {tag: [{code: 'pghd'}]},
    });
    expect(encounter.contained?.map((item) => item.resourceType)).toEqual(['Condition', 'Location', 'Observation']);
  });

  it('keeps legacy free text without inventing a chief complaint or codes', () => {
    const encounter = buildPatientRecord(visit, NOW, patient).resource as Encounter;
    expect(encounter.reasonCode).toEqual([{text: 'Follow-up'}]);
    expect(encounter.type).toEqual([{text: 'Consultation'}]);
    expect(encounter.reasonReference).toBeUndefined();
  });

  it('rejects invalid reason codes, types, empty reasons and multiple primary complaints', () => {
    for (const changes of [
      {visit_type_code: 'bad'},
      {visit_reasons: []},
      {visit_reasons: [{text: ''}]},
      {visit_reasons: [{text: 'A', code: 'bad'}]},
      {visit_reasons: [{text: 'A', primary: true}, {text: 'B', primary: true}]},
    ]) {
      expect(() => buildPatientRecord({...visit, ...changes}, NOW, patient)).toThrow();
    }
  });

  it('stores discrete ICD diagnoses and individual expected dates without implying actual resolution', () => {
    const { resource } = buildPatientRecord({
      ...visit, visit_location_code: '22232009',
      visit_diagnosis_ids: ['own-condition'],
      visit_diagnoses: [
        { condition_id: 'own-condition', expected_end_date: '2026-12-01' },
        { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: ' j069 ', display: 'Upper respiratory infection', expected_end_date: '2026-10-12' },
        { system: 'http://hl7.org/fhir/sid/icd-9-cm', code: '465.9', expected_end_date: '2026-10-14' },
      ],
    }, NOW, patient);
    const encounter = resource as Encounter;
    expect(encounter.diagnosis).toEqual([
      { condition: { reference: 'Condition/own-condition' }, extension: [{url: terminology.diagnosis.expectedEndDateExtension, valueDate: '2026-12-01'}] },
      { condition: { reference: '#visit-diagnosis-1', display: 'Upper respiratory infection' }, extension: [{url: terminology.diagnosis.expectedEndDateExtension, valueDate: '2026-10-12'}] },
      { condition: { reference: '#visit-diagnosis-2', display: '465.9' }, extension: [{url: terminology.diagnosis.expectedEndDateExtension, valueDate: '2026-10-14'}] },
    ]);
    expect(encounter.contained).toHaveLength(3);
    expect(encounter.contained?.[0]).toMatchObject({
      resourceType: 'Condition', id: 'visit-diagnosis-1', subject: {reference: patient.subject}, asserter: {reference: patient.subject},
      code: { coding: [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J06.9', display: 'Upper respiratory infection'}], text: 'Upper respiratory infection' },
      category: [{coding: [{code: 'encounter-diagnosis'}]}],
      meta: { tag: [{code: 'pghd'}] },
    });
    expect(encounter.contained?.[1]).toMatchObject({
      code: { coding: [{system: 'http://hl7.org/fhir/sid/icd-9-cm', code: '465.9'}] },
    });
    expect(encounter.contained?.[2]).toMatchObject({resourceType: 'Location', id: 'visit-location'});
    for (const condition of encounter.contained?.filter((resource) => resource.resourceType === 'Condition') ?? []) {
      expect(condition).not.toHaveProperty('abatementDateTime');
      expect(condition).not.toHaveProperty('clinicalStatus');
      expect(condition).not.toHaveProperty('meta.lastUpdated');
    }
  });

  it('allows optional descriptions and dates and normalizes ICD spellings including U, V, and E codes', () => {
    for (const [system, code, expected] of [
      ['icd-10-cm', 'U071', 'U07.1'], ['icd-10-cm', 'S52521A', 'S52.521A'],
      ['icd-10-cm', 'I10', 'I10'], ['icd-9-cm', '25000', '250.00'],
      ['icd-9-cm', 'V700', 'V70.0'], ['icd-9-cm', 'E8120', 'E812.0'],
    ]) {
      expect(parseVisitDiagnoses([{ system: `http://hl7.org/fhir/sid/${system}`, code }])).toEqual([
        { system: `http://hl7.org/fhir/sid/${system}`, code: expected },
      ]);
    }
    const { resource } = buildPatientRecord({
      ...visit, visit_diagnoses: [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10'}],
    }, NOW, patient);
    expect((resource as Encounter).diagnosis?.[0]).not.toHaveProperty('extension');
  });

  it('rejects malformed rows, unsupported systems, impossible dates and ambiguous links', () => {
    for (const value of [null, {}, 'I10', [null], [[]], [{}], [{code: 'I10'}],
      [{system: 'http://snomed.info/sct', code: '123456'}],
      [{system: 'toString', code: 'I10'}], [{system: '__proto__', code: 'I10'}],
      [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: '123.4'}],
      [{system: 'http://hl7.org/fhir/sid/icd-9-cm', code: 'J06.9'}],
      [{condition_id: '../another'}], [{condition_id: 'own', code: 'I10'}],
      [{condition_id: 'own', expected_end_date: '2026-02-30'}],
      [{condition_id: 'own', expected_end_date: '2026-13-01'}],
      [{condition_id: 'own', expected_end_date: '2026-1-1'}],
      [{condition_id: 'own', expected_end_date: '0000-01-01'}],
      [{condition_id: 'own', expected_end_date: 123}],
      [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 123}],
    ]) {
      expect(() => parseVisitDiagnoses(value)).toThrow(PatientEntryError);
    }
    expect(parseVisitDiagnoses([{condition_id: 'own', expected_end_date: '2028-02-29'}])).toHaveLength(1);
  });

  it('refuses duplicate codes and conflicting estimates, while retaining legacy diagnosis links', () => {
    const code = {system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J06.9'};
    expect(() => buildPatientRecord({
      ...visit, visit_diagnoses: [code, {...code, code: 'j069'}],
    }, NOW, patient)).toThrow('more than once');
    expect(() => buildPatientRecord({
      ...visit, visit_diagnoses: [
        {condition_id: 'own', expected_end_date: '2026-10-10'}, {condition_id: 'own', expected_end_date: '2026-10-11'},
      ],
    }, NOW, patient)).toThrow('conflicting expected end dates');
  });

  it('stores SNOMED location type on a referenced Location, not on Encounter.class', () => {
    const { resource } = buildPatientRecord({
      ...visit, visit_location: ' Cardiology clinic ', visit_location_code: '33022008',
      visit_disposition_code: '306689006',
    }, NOW, patient);
    expect(resource).toMatchObject({
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      contained: [{
        resourceType: 'Location', id: 'visit-location', name: 'Cardiology clinic',
        type: [{
          coding: [
            { system: 'http://snomed.info/sct', code: '33022008', display: 'Hospital-based outpatient department' },
            { system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'OF', display: 'Outpatient facility' },
          ],
          text: 'Hospital-based outpatient department',
        }],
      }],
      location: [{ location: { reference: '#visit-location', display: 'Cardiology clinic' } }],
      hospitalization: { dischargeDisposition: {
        coding: [{ system: 'http://snomed.info/sct', code: '306689006', display: 'Discharge to home' }],
        text: 'Discharge to home',
      } },
    });
  });

  it('retains discharge details alongside the selected code and needs no location name', () => {
    const { resource } = buildPatientRecord({
      ...visit, visit_location_code: '264362003', visit_disposition_code: '306694006',
      visit_disposition: ' Nursing home with family transport ',
    }, NOW, patient);
    expect(resource).toMatchObject({
      contained: [{ resourceType: 'Location', name: 'Home' }],
      location: [{ location: { reference: '#visit-location', display: 'Home' } }],
      hospitalization: { dischargeDisposition: {
        coding: [{ system: 'http://snomed.info/sct', code: '306694006', display: 'Discharge to nursing home' }],
        text: 'Nursing home with family transport',
      } },
    });
  });

  it('does not invent optional location or discharge facts', () => {
    const { resource } = buildPatientRecord(visit, NOW, patient);
    expect(resource).not.toHaveProperty('location');
    expect(resource).not.toHaveProperty('contained');
    expect(resource).not.toHaveProperty('hospitalization');
  });

  it('rejects unknown and malformed codes instead of silently keeping uncoded data', () => {
    for (const value of ['not-a-code', 'AMB', '306689006', ' ', null, 22232009, {}]) {
      expect(() => buildPatientRecord(
        { ...visit, visit_location_code: value } as Parameters<typeof buildPatientRecord>[0], NOW, patient,
      )).toThrow('Choose a valid location type');
    }
    for (const value of ['not-a-code', 'home', '22232009', ' ', null, 306689006, {}]) {
      expect(() => buildPatientRecord(
        { ...visit, visit_disposition_code: value } as Parameters<typeof buildPatientRecord>[0], NOW, patient,
      )).toThrow('Choose a valid discharge disposition');
    }
    expect(() => buildPatientRecord({ ...visit, visit_class: '22232009' }, NOW, patient)).toThrow('Choose a visit setting');
    expect(() => buildPatientRecord({ ...visit, visit_status: '306689006' }, NOW, patient)).toThrow('Choose a valid visit status');
  });

  it('preserves plain-note line breaks and escapes HTML for older clients', () => {
    const {resource} = buildPatientRecord({
      kind: 'visit', name: 'Follow-up', visit_type: 'Office', visit_class: 'AMB',
      note: 'Line one\n<script>unsafe</script>\nLine three',
    }, NOW, {subject: 'Patient/self-1'});
    if (resource.resourceType !== 'Encounter') throw new Error('Expected an Encounter');
    expect(resource.text?.div).toContain('Line one<br />&lt;script&gt;unsafe&lt;/script&gt;<br />Line three');
  });

  it('creates a patient-reported FHIR Encounter linked to the selected provider and organization', () => {
    const { resource, sortTitle, review } = buildPatientRecord({
      kind: 'visit',
      name: 'Cardiology follow-up',
      visit_type: 'Office visit',
      visit_class: 'AMB',
      visit_status: 'finished',
      effective_date_time: '2026-09-20',
      visit_end_date_time: '2026-09-20',
      visit_identifier: 'VISIT-42',
      visit_location: 'Cardiology clinic',
      visit_disposition: 'Discharged home',
      visit_diagnosis_ids: ['condition-1', ' condition-2 ', 'condition-1'],
      provider_id: 'practitioner-123',
      provider_name: 'Dr. Patel',
      organization_id: 'org-4',
      organization_name: 'Heart Clinic',
      note: 'Annual follow-up',
    }, NOW, { subject: 'Patient/self-1' });

    expect(resource).toMatchObject({
      resourceType: 'Encounter',
      status: 'finished',
      meta: {
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter'],
        lastUpdated: NOW.toISOString(),
      },
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      type: [{ text: 'Office visit' }],
      reasonCode: [{ text: 'Cardiology follow-up' }],
      subject: { reference: 'Patient/self-1' },
      identifier: [{ value: 'VISIT-42' }],
      period: { start: '2026-09-20', end: '2026-09-20' },
      participant: [{ individual: { reference: 'Practitioner/practitioner-123', display: 'Dr. Patel' } }],
      serviceProvider: { reference: 'Organization/org-4', display: 'Heart Clinic' },
      location: [{ location: { display: 'Cardiology clinic' } }],
      hospitalization: { dischargeDisposition: { text: 'Discharged home' } },
      diagnosis: [
        { condition: { reference: 'Condition/condition-1' } },
        { condition: { reference: 'Condition/condition-2' } },
      ],
      text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">Annual follow-up</div>' },
    });
    expect(sortTitle).toBe('Cardiology follow-up');
    expect(review).toEqual([]);
  });

  it('refuses a visit with no setting rather than guessing its class', () => {
    expect(() => buildPatientRecord({ kind: 'visit', name: 'Annual visit', visit_type: 'Office visit' }, NOW, { subject: 'Patient/self-1' })).toThrow('Choose a visit setting');
  });

  it('requires a type and a patient subject before it can claim the US Core profile', () => {
    expect(() => buildPatientRecord({ kind: 'visit', name: 'Annual visit', visit_class: 'AMB' }, NOW, { subject: 'Patient/self-1' })).toThrow('Name the type of visit');
    expect(() => buildPatientRecord({ kind: 'visit', name: 'Annual visit', visit_type: 'Office visit', visit_class: 'AMB' }, NOW)).toThrow('patient record is required');
  });

  it('keeps an end date only when it is not earlier than the visit start', () => {
    const { resource, review } = buildPatientRecord({
      kind: 'visit',
      name: 'Annual visit',
      visit_type: 'Office visit',
      visit_class: 'AMB',
      effective_date_time: '2026-09-21',
      visit_end_date_time: '2026-09-20',
    }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({ period: { start: '2026-09-21' } });
    expect((resource as { period?: { end?: string } }).period?.end).toBeUndefined();
    expect(review).toContain('the visit end is earlier than its start, so the end time needs review');
  });

  it('accepts every visit class offered by the form', () => {
    for (const visit_class of ['AMB', 'OBSENC', 'EMER', 'PRENC', 'IMP', 'HH', 'SS', 'VR']) {
      expect(() => buildPatientRecord({
        kind: 'visit', name: 'Visit', visit_type: 'Consultation', visit_class,
      }, NOW, { subject: 'Patient/self-1' })).not.toThrow();
    }
  });

  it('rejects malformed or non-owned visit diagnosis references', () => {
    const ownIds = new Set(['condition-1']);
    expect(() => validateVisitDiagnosisIds('condition-1', ownIds)).toThrow('Choose valid diagnoses');
    expect(() => validateVisitDiagnosisIds(['condition-1', ''], ownIds)).toThrow('Choose valid diagnoses');
    expect(() => validateVisitDiagnosisIds(['condition-2'], ownIds)).toThrow('not in your own records');
    expect(validateVisitDiagnosisIds([' condition-1 ', 'condition-1'], ownIds)).toEqual(['condition-1']);
  });
});

describe('a manually entered implant', () => {
  it('creates a US Core Implantable Device with the patient and identifiers they supplied', () => {
    const { resource, sortTitle, review } = buildPatientRecord({
      kind: 'implant',
      name: 'Coronary artery stent',
      implant_status: 'active',
      implant_device_identifier: '00844588003288',
      implant_distinct_identifier: 'A9999',
      implant_serial_number: 'SN456',
      implant_lot_number: 'LOT123',
      implant_manufacture_date: '2022-01-15',
      implant_expiration_date: '2032-01-15',
    }, NOW, { subject: 'Patient/self-1' });

    expect(resource).toMatchObject({
      resourceType: 'Device',
      status: 'active',
      type: { text: 'Coronary artery stent' },
      patient: { reference: 'Patient/self-1' },
      udiCarrier: [{ deviceIdentifier: '00844588003288' }],
      distinctIdentifier: 'A9999',
      serialNumber: 'SN456',
      lotNumber: 'LOT123',
      manufactureDate: '2022-01-15',
      expirationDate: '2032-01-15',
      meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-implantable-device'] },
    });
    expect(sortTitle).toBe('Coronary artery stent');
    expect(review).toEqual([]);
  });

  it('uses unknown status and does not invent optional identifiers', () => {
    const { resource } = buildPatientRecord({
      kind: 'implant',
      name: 'Pacemaker',
    }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({ resourceType: 'Device', status: 'unknown', type: { text: 'Pacemaker' } });
    expect(resource).not.toHaveProperty('udiCarrier');
    expect(resource).not.toHaveProperty('serialNumber');
  });

  it('requires a device type and patient subject', () => {
    expect(() => buildPatientRecord({ kind: 'implant' }, NOW, { subject: 'Patient/self-1' })).toThrow('Name the implant');
    expect(() => buildPatientRecord({ kind: 'implant', name: 'Pacemaker' }, NOW)).toThrow('patient record is required');
  });
});

describe('a home glucose reading (yourphr#696)', () => {
  it('is coded by the UNIT, because the unit says which quantity was measured', () => {
    expect(buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'mg/dL' }, NOW).observation.code?.coding?.[0]?.code).toBe('41653-7');
    expect(buildPatientVital({ vital: 'blood_sugar', value: 5.3, unit: 'mmol/L' }, NOW).observation.code?.coding?.[0]?.code).toBe('14743-9');
    expect(buildPatientVital({ vital: 'glucose', value: 96 }, NOW).observation.code?.coding?.[0]?.code).toBe('41653-7'); // mg/dL by default
  });

  it('is a laboratory observation, not a vital sign — a finger-stick is a lab value wherever it was taken', () => {
    const { observation } = buildPatientVital({ vital: 'blood_sugar', value: 96 }, NOW);
    expect(observation.category?.[0]?.coding?.[0]?.code).toBe('laboratory');
  });

  it('leaves a reading in an unrecognised unit uncoded for review, rather than guessing the specimen', () => {
    const { observation, review } = buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'g/L' }, NOW);
    expect(observation.code).toEqual({ text: 'blood sugar' });
    expect(review[0]).toContain('unit "g/L" was not recognised');
  });
});

describe('who the record is about and who measured it (PGHD)', () => {
  it('states both, when the caller gives the person record', () => {
    const { observation } = buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW, { subject: 'Patient/self-1' });
    expect(observation.subject).toEqual({ reference: 'Patient/self-1' });
    expect(observation.performer).toEqual([{ reference: 'Patient/self-1' }]);
  });

  // yourphr#764: what measured it is evidence, and only ever what the person said.
  it('states the device when one was named', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW, { subject: 'Patient/self-1', device: 'Device/cuff-1' });
    expect(observation.device).toEqual({ reference: 'Device/cuff-1' });
  });

  it('leaves the device absent when none was named — a remembered reading is not a measured one', () => {
    expect(buildPatientVital({ vital: 'heart_rate', value: 64 }, NOW, { subject: 'Patient/self-1' }).observation.device).toBeUndefined();
    // Nor is one inferred from a value or a unit: mg/dL does not mean a meter produced it.
    expect(buildPatientVital({ vital: 'blood_sugar', value: 96, unit: 'mg/dL' }, NOW, { subject: 'Patient/self-1' }).observation.device).toBeUndefined();
  });
});

describe('what the record list shows for a vital (yourphr#696, and the display rule in #262)', () => {
  it('shows the measurement, not the LOINC panel name — the reason a saved 128/78 read as "Blood pressure panel with all children optional"', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128, diastolic: 78 }, NOW);
    expect(titleFor(observation)).toBe('Blood pressure 128/78 mmHg');
  });

  it('names the measurement for a single-value vital', () => {
    expect(titleFor(buildPatientVital({ vital: 'body_weight', value: 72.5 }, NOW).observation)).toBe('Body weight 72.5 kg');
    expect(titleFor(buildPatientVital({ vital: 'oxygen_saturation', value: 97 }, NOW).observation)).toBe('Oxygen saturation in Arterial blood 97 %');
  });

  it('does the same for an imported observation, since the gap was never specific to hand-entered records', () => {
    const fromEpic = {
      resourceType: 'Observation',
      code: { text: 'Hemoglobin A1c', coding: [{ system: 'http://loinc.org', code: '4548-4' }] },
      valueQuantity: { value: 5.9, unit: '%' },
    };
    expect(titleFor(fromEpic)).toBe('Hemoglobin A1c 5.9 %');
  });

  it('names half a reading too, rather than falling back to the panel LOINC display (yourphr#696)', () => {
    const { observation } = buildPatientVital({ vital: 'blood_pressure', systolic: 128 }, NOW);
    expect(titleFor(observation)).toBe('Blood pressure 128 systolic mmHg');
    expect(titleFor(buildPatientVital({ vital: 'blood_pressure', diastolic: 78 }, NOW).observation)).toBe('Blood pressure 78 diastolic mmHg');
  });

  it('falls back to the code text rather than inventing one when the record states no value yet', () => {
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Lipid panel' } })).toBe('Lipid panel');
    expect(titleFor({ resourceType: 'Observation', code: { text: 'Blood pressure' }, component: [{ code: { coding: [{ code: '8480-6' }] } }] })).toBe('Blood pressure');
  });
});


describe('an allergy the patient states (yourphr#763)', () => {
  it('is an AllergyIntolerance about the person, asserted by the person — not an Observation wearing a label', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({
      resourceType: 'AllergyIntolerance',
      code: { text: 'penicillin' },
      patient: { reference: 'Patient/self-1' },
      asserter: { reference: 'Patient/self-1' }, // who says so: the PGHD pattern, stated in FHIR's own field
      recordedDate: '2026-09-23T10:30:00Z',
    });
    expect(sortTitle).toBe('Allergy to penicillin');
  });

  it('invents no criticality, severity, reaction or verification — the form never asked', () => {
    const { resource } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    const allergy = resource as unknown as Record<string, unknown>;
    expect(allergy['criticality']).toBeUndefined();
    expect(allergy['reaction']).toBeUndefined();
    expect(allergy['verificationStatus']).toBeUndefined();
    expect(allergy['clinicalStatus']).toBeUndefined();
  });

  it('waits for the person, because nothing has matched the substance to a coded one', () => {
    const { resource, review } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW, { subject: 'Patient/self-1' });
    expect(review[0]).toContain('nothing has matched it to a known substance');
    expect(((resource.meta?.tag ?? []) as { code?: string }[]).some((t) => t.code === 'needs-review')).toBe(true);
    expect((resource as { note?: { text?: string }[] }).note?.[0]?.text).toBe(review[0]);
  });

  it('takes the substance under the older field name too, so a v2-era client still works', () => {
    expect((buildPatientRecord({ kind: 'allergy', vital: 'shellfish' }, NOW).resource as { code?: { text?: string } }).code?.text).toBe('shellfish');
  });

  it('refuses only an unnamed allergy — there is no fact in it', () => {
    expect(() => buildPatientRecord({ kind: 'allergy' }, NOW)).toThrow(PatientEntryError);
  });

  it('leaves the record undated rather than dating it today when the date cannot be read', () => {
    const { resource, review } = buildPatientRecord({ kind: 'allergy', name: 'penicillin', effective_date_time: 'last spring' }, NOW);
    expect((resource as { recordedDate?: string }).recordedDate).toBeUndefined();
    expect(review.some((r) => r.includes('could not be read'))).toBe(true);
  });
});

describe('a medication the patient says they take (yourphr#763)', () => {
  it('is a MedicationStatement about the person, sourced to the person', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'medication', name: 'metformin 500mg', status: 'active' }, NOW, { subject: 'Patient/self-1' });
    expect(resource).toMatchObject({
      resourceType: 'MedicationStatement',
      status: 'active',
      medicationCodeableConcept: { text: 'metformin 500mg' },
      subject: { reference: 'Patient/self-1' },
      informationSource: { reference: 'Patient/self-1' },
      dateAsserted: '2026-09-23T10:30:00Z',
    });
    expect(sortTitle).toBe('metformin 500mg');
  });

  // FHIR R4 requires a status. "unknown" is its own value for one nobody stated — "active" would be
  // this instance asserting that they take it today.
  it('says unknown, not active, when the person did not say whether they still take it', () => {
    const { resource, review } = buildPatientRecord({ kind: 'medication', name: 'metformin' }, NOW);
    expect((resource as { status?: string }).status).toBe('unknown');
    expect(review.some((r) => r.includes('did not say whether you are still taking this'))).toBe(true);
  });

  it('keeps a stopped medication as stopped — it is still a fact about them', () => {
    const { resource, review } = buildPatientRecord({ kind: 'medication', name: 'lisinopril', status: 'stopped' }, NOW);
    expect((resource as { status?: string }).status).toBe('stopped');
    expect(review.some((r) => r.includes('did not say whether'))).toBe(false);
  });

  it('invents no dose, route or frequency, and no coding', () => {
    const { resource } = buildPatientRecord({ kind: 'medication', name: 'metformin', status: 'active' }, NOW);
    const statement = resource as unknown as Record<string, unknown>;
    expect(statement['dosage']).toBeUndefined();
    expect((statement['medicationCodeableConcept'] as { coding?: unknown }).coding).toBeUndefined();
  });

  it('refuses only an unnamed medication', () => {
    expect(() => buildPatientRecord({ kind: 'medication' }, NOW)).toThrow(PatientEntryError);
  });
});

describe('what the record list shows for the kinds added in yourphr#763', () => {
  it('names an allergy by what it is an allergy to, so a mixed list reads as sentences', () => {
    const { resource } = buildPatientRecord({ kind: 'allergy', name: 'penicillin' }, NOW);
    expect(titleFor(resource)).toBe('Allergy to penicillin');
    // The same for one a provider sent: the display gap was never specific to hand-entered records.
    expect(titleFor({ resourceType: 'AllergyIntolerance', code: { coding: [{ display: 'Peanut' }] } })).toBe('Allergy to Peanut');
  });

  it('names a medication by the medicine, which is what the record states', () => {
    const { resource, sortTitle } = buildPatientRecord({ kind: 'medication', name: 'metformin 500mg', status: 'active' }, NOW);
    expect(titleFor(resource)).toBe('metformin 500mg');
    expect(titleFor(resource)).toBe(sortTitle); // the queue and the list must not disagree (yourphr#762)
  });
});
