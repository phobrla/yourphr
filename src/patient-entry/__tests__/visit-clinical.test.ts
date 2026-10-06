import {describe, expect, it} from 'vitest';
import type {DocumentReference, Encounter, Observation, Specimen} from '@medplum/fhirtypes';
import {buildPatientRecord, PatientEntryError} from '../index.js';
import type {PatientEntryRequest, VisitLabEntry} from '../shared.js';
import terminology from '../visit-terminology.json' with {type: 'json'};

const now = new Date('2026-10-06T12:00:00Z');
const visit: PatientEntryRequest = {kind: 'visit', name: 'Synthetic visit', visit_type: 'Office', visit_class: 'AMB', effective_date_time: '2020-04-20'};
const lab: VisitLabEntry = {code: '2345-7', display: 'Glucose [Mass/volume] in Serum or Plasma', result_type: 'quantity', value: 0, status: 'final'};
const build = (extra: Partial<PatientEntryRequest>) => buildPatientRecord({...visit, ...extra}, now, {subject: 'Patient/synthetic'});

describe('visit billing annotations and timestamp precision', () => {
  it('preserves leading-zero billing codes separately from clinical codes', () => {
    const encounter = build({visit_billing: [
      {kind: 'revenue', code: '0999', description: 'Synthetic billing description'},
      {kind: 'type-of-bill', code: '0999'},
    ]}).resource as Encounter;
    expect(encounter.extension?.filter(entry => entry.url === terminology.billing.extension)).toEqual([
      {url: terminology.billing.extension, valueCoding: {system: terminology.billing.systems.revenue, code: '0999', display: 'Synthetic billing description'}},
      {url: terminology.billing.extension, valueCoding: {system: terminology.billing.systems['type-of-bill'], code: '0999'}},
    ]);
    expect(encounter.diagnosis).toBeUndefined();
  });

  it.each([null, {}, [null], [{kind: 'revenue', code: 999}], [{kind: 'revenue', code: '999'}],
    [{kind: 'unknown', code: '0999'}], [{kind: 'revenue', code: '0999', description: {}}]])('rejects malformed billing annotations %j', value => {
    expect(() => build({visit_billing: value as PatientEntryRequest['visit_billing']})).toThrow(PatientEntryError);
  });

  it('retains timed periods and retains date-only precision when time is absent', () => {
    expect((build({effective_date_time: '2020-04-20T09:30:00-04:00',
      visit_end_date_time: '2020-04-20T10:15:00-04:00'}).resource as Encounter).period).toEqual({
      start: '2020-04-20T09:30:00-04:00', end: '2020-04-20T10:15:00-04:00',
    });
    expect((build({visit_end_date_time: '2020-04-21'}).resource as Encounter).period).toEqual({
      start: '2020-04-20', end: '2020-04-21',
    });
  });
});

describe('LOINC encounter laboratory results', () => {
  it('preserves numeric zero, comparator, explicit UCUM, separate dates, range, specimen and actual performer', () => {
    const encounter = build({visit_labs: [{...lab, comparator: '<', unit: 'mg/dL', ucum_code: 'mg/dL',
      collected: '2020-04-21', issued: '2020-04-23T10:12:00-04:00',
      reference_range: '70-99 mg/dL', specimen: 'Serum', laboratory: 'Synthetic laboratory', note: 'Fasting'}]}).resource as Encounter;
    const observation = encounter.contained?.[0] as Observation;
    expect(observation).toMatchObject({
      resourceType: 'Observation', status: 'final',
      category: [{coding: [{code: 'laboratory'}]}],
      code: {coding: [{system: 'http://loinc.org', code: '2345-7'}]},
      subject: {reference: 'Patient/synthetic'}, encounter: {reference: '#'},
      valueQuantity: {value: 0, comparator: '<', unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL'},
      effectiveDateTime: '2020-04-21', issued: '2020-04-23T10:12:00-04:00',
      referenceRange: [{text: '70-99 mg/dL'}], performer: [{display: 'Synthetic laboratory'}], note: [{text: 'Fasting'}],
      specimen: {reference: '#visit-lab-specimen-1', display: 'Serum'},
      meta: {source: 'yourphr://patient-ui', tag: [{code: 'pghd'}]},
    });
    expect(encounter.contained?.[1] as Specimen).toMatchObject({
      resourceType: 'Specimen', subject: {reference: 'Patient/synthetic'}, type: {text: 'Serum'}, collection: {collectedDateTime: '2020-04-21'},
    });
    expect(encounter.extension).toContainEqual({url: terminology.labs.extension, valueReference: {reference: '#visit-lab-1'}});
  });

  it('retains qualitative text without inferring negativity, units, collection date or patient performer', () => {
    const encounter = build({visit_labs: [
      {...lab, value: undefined, result_type: 'text', text: 'Not detected'},
      {...lab, unit: 'units as reported', status: 'unknown'},
    ]}).resource as Encounter;
    const observations = encounter.contained as Observation[];
    expect(observations[0]?.valueString).toBe('Not detected');
    expect(observations[0]?.valueQuantity).toBeUndefined();
    expect(observations[0]?.effectiveDateTime).toBeUndefined();
    expect(observations[0]?.performer).toBeUndefined();
    expect(observations[0]?.interpretation).toBeUndefined();
    expect(observations[1]?.valueQuantity).toEqual({value: 0, unit: 'units as reported'});
    expect(observations[1]?.valueQuantity?.system).toBeUndefined();
  });

  it.each([
    {code: 'not-loinc'}, {display: ''}, {status: 'made-up'}, {value: NaN}, {value: Infinity}, {value: undefined},
    {text: 'Both types'}, {comparator: '='}, {result_type: 'text', text: ''},
    {result_type: 'text', text: 'Positive'}, {collected: '2020-02-30'},
    {collected: '2020-04-25', issued: '2020-04-23T12:00:00Z'},
    {issued: '2020-04-23'}, {issued: '2020-04-23T12:00:00'}, {issued: '2020-04-23T25:00:00Z'},
    {specimen: 3}, {unit: {}}, {result_type: 'boolean'},
  ])('rejects invalid lab inputs: %j', extra => {
    expect(() => build({visit_labs: [{...lab, ...extra} as VisitLabEntry]})).toThrow(PatientEntryError);
  });

  it('rejects malformed collections and non-visit requests', () => {
    for (const labs of [null, {}, [null]]) expect(() => build({visit_labs: labs as never})).toThrow(PatientEntryError);
    expect(() => build({kind: 'allergy', visit_labs: [lab]})).toThrow(PatientEntryError);
  });

  it('supports the existing encounter request alias', () => {
    expect(build({kind: 'encounter', visit_labs: [lab]}).resource.resourceType).toBe('Encounter');
  });

  it('does not treat a date-only collection as midnight UTC when checking report order', () => {
    const encounter = build({visit_labs: [{...lab, collected: '2020-04-21', issued: '2020-04-21T00:30:00+14:00'}]}).resource as Encounter;
    expect((encounter.contained?.[0] as Observation).effectiveDateTime).toBe('2020-04-21');
    expect((encounter.contained?.[0] as Observation).issued).toBe('2020-04-21T00:30:00+14:00');
  });
});

describe('FHIR note attribution', () => {
  it('keeps multiple notes distinct, each with Practitioner authors, dates and formatted content', () => {
    const narratives = [
      '<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Second note</strong></p></div>',
      '<div xmlns="http://www.w3.org/1999/xhtml"><p>Third note</p></div>',
    ];
    const encounter = buildPatientRecord({...visit, note: 'First note',
      visit_note_authors: [{provider_id: 'provider-one', name: 'Provider One'}], visit_note_authored: '2020-04-20',
      visit_notes: [
        {note: '**Second note**', note_format: 'markdown', authored: '2020-04-22',
          authors: [{provider_id: 'provider-two', name: 'Provider Two'}]},
        {note: 'Third note', authored: '2020-04-25', authors: []},
      ],
    }, now, {subject: 'Patient/synthetic'}, undefined, narratives).resource as Encounter;
    const documents = encounter.contained?.filter((item): item is DocumentReference => item.resourceType === 'DocumentReference') ?? [];
    expect(documents).toHaveLength(3);
    expect(documents.map(doc => doc.id)).toEqual(['visit-note', 'visit-note-2', 'visit-note-3']);
    expect(documents[0]?.author).toEqual([{reference: 'Practitioner/provider-one', display: 'Provider One'}]);
    expect(documents[1]?.author).toEqual([{reference: 'Practitioner/provider-two', display: 'Provider Two'}]);
    expect(documents[2]?.author).toBeUndefined();
    expect(documents.map(doc => doc.content[0]?.attachment.creation)).toEqual(['2020-04-20', '2020-04-22', '2020-04-25']);
    expect(Buffer.from(documents[1]!.content[0]!.attachment.data!, 'base64').toString('utf8')).toBe(narratives[0]);
    expect(documents[1]?.text?.div).toBe(narratives[0]);
    expect(encounter.text?.div).toContain('First note');
    expect(encounter.text?.div).not.toContain('Second note');
    for (const document of documents) {
      expect(encounter.extension).toContainEqual({url: terminology.note.extension, valueReference: {reference: `#${document.id}`}});
      expect(document.context?.encounter).toEqual([{reference: '#'}]);
      expect(document.authenticator).toBeUndefined();
    }
  });

  it('supports additional notes without the legacy first note', () => {
    const encounter = build({visit_notes: [{note: 'Only note', authors: [{provider_id: 'provider-one', name: 'Provider One'}]}]}).resource as Encounter;
    expect(encounter.contained?.[0]).toMatchObject({resourceType: 'DocumentReference', id: 'visit-note',
      author: [{reference: 'Practitioner/provider-one'}]});
  });

  it.each([
    null, {}, [null], [{note: ''}], [{note: 'Synthetic', authors: [{name: 'No provider'}]}],
    [{note: 'Synthetic', authors: [{name: 'Provider', provider_id: '../invalid'}]}],
    [{note: 'Synthetic', authored: '2020-02-30'}], [{note: 'Synthetic', note_format: 'html'}],
  ])('refuses malformed additional notes and authors: %j', notes => {
    expect(() => build({visit_notes: notes as never})).toThrow(PatientEntryError);
  });
  it('retains the complete rendered note as one document with explicit authors and a distinct authored date', () => {
    const xhtml = '<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Synthetic note</strong></p></div>';
    const built = buildPatientRecord({...visit, note: '**Synthetic note**', note_format: 'markdown',
      provider_name: 'Different visit provider', visit_note_authors: [{name: 'Synthetic Author, MD'}, {name: 'Synthetic Contributor, RN'}],
      visit_note_authored: '2020-04-20', visit_labs: [lab], visit_observations: [{kind: 'heart_rate', value: 70}],
    }, now, {subject: 'Patient/synthetic'}, xhtml);
    const encounter = built.resource as Encounter;
    const document = encounter.contained?.find(item => item.resourceType === 'DocumentReference') as DocumentReference;
    expect(document).toMatchObject({
      resourceType: 'DocumentReference', status: 'current', subject: {reference: 'Patient/synthetic'},
      author: [{display: 'Synthetic Author, MD'}, {display: 'Synthetic Contributor, RN'}],
      date: now.toISOString(), context: {encounter: [{reference: '#'}]},
      content: [{attachment: {contentType: 'application/xhtml+xml', creation: '2020-04-20'}}],
      meta: {source: 'yourphr://patient-ui', tag: [{code: 'pghd'}]},
    });
    expect(Buffer.from(document.content[0]!.attachment.data!, 'base64').toString('utf8')).toBe(xhtml);
    expect(encounter.text?.div).toBe(xhtml);
    expect(document.authenticator).toBeUndefined();
    expect(document.docStatus).toBeUndefined();
    expect(encounter.extension).toContainEqual({url: terminology.note.extension, valueReference: {reference: '#visit-note'}});
    expect(encounter.contained?.filter(item => item.resourceType === 'Observation')).toHaveLength(2);
  });

  it('does not assume the encounter provider authored or authenticated the note', () => {
    const encounter = build({note: 'Synthetic note', provider_name: 'Visit provider'}).resource as Encounter;
    const document = encounter.contained?.[0] as DocumentReference;
    expect(document.author).toBeUndefined();
    expect(document.authenticator).toBeUndefined();
    expect(document.content[0]?.attachment.creation).toBeUndefined();
  });

  it.each([
    {visit_note_authors: [{name: ''}]}, {visit_note_authors: [null]}, {visit_note_authors: {}},
    {visit_note_authored: '2020-02-30'}, {visit_note_authored: 2},
    {note: '', visit_note_authors: [{name: 'Synthetic author'}]}, {note: '', visit_note_authored: '2020-04-20'},
  ])('refuses malformed or orphan attribution: %j', extra => {
    expect(() => build({note: 'Synthetic note', ...extra} as Partial<PatientEntryRequest>)).toThrow(PatientEntryError);
  });
});
