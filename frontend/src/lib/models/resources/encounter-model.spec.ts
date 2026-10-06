import { EncounterModel } from './encounter-model';
import {DocumentReferenceModel} from './document-reference-model';
import example1Fixture from "../../fixtures/r4/resources/encounter/example1.json"
import example2Fixture from "../../fixtures/r4/resources/encounter/example2.json"
import example3Fixture from "../../fixtures/r4/resources/encounter/example3.json"
import * as exampleFmhFixture from "../../fixtures/r4/resources/encounter/example-followmyhealth.json"
import * as exampleEpicHovFixture from "../../fixtures/r4/resources/encounter/example-epic-hov.json"


describe('EncounterModel', () => {
  it('keeps additional note narratives and independent authors separate', () => {
    const model = new EncounterModel({
      extension: ['first', 'second'].map(id => ({url: 'https://yourphr.org/fhir/StructureDefinition/encounter-note', valueReference: {reference: `#${id}`}})),
      contained: [
        {resourceType: 'DocumentReference', id: 'first', text: {div: '<div>First note</div>'}, author: [{display: 'First Provider'}]},
        {resourceType: 'DocumentReference', id: 'second', text: {div: '<div>Second note</div>'},
          author: [{display: 'Second Provider'}], content: [{attachment: {creation: '2020-04-22'}}]},
      ],
    });
    expect(model.narrative).toBe('<div>First note</div>');
    expect(model.noteAuthors).toEqual(['First Provider']);
    expect(model.additionalNotes).toEqual([{authors: ['Second Provider'], authored: '2020-04-22', narrative: '<div>Second note</div>'}]);
  });
  it('resolves only referenced labs and note attribution with separate collection/report/authored dates', () => {
    const model = new EncounterModel({
      extension: [
        {url: 'https://yourphr.org/fhir/StructureDefinition/encounter-laboratory-result', valueReference: {reference: '#lab'}},
        {url: 'https://yourphr.org/fhir/StructureDefinition/encounter-note', valueReference: {reference: '#note'}},
      ],
      contained: [
        {resourceType: 'Observation', id: 'lab', code: {text: 'Glucose', coding: [{system: 'http://loinc.org', code: '2345-7'}]},
          valueQuantity: {value: 0, comparator: '<', unit: 'mg/dL'}, status: 'final', effectiveDateTime: '2020-04-21', issued: '2020-04-23T12:30:00Z',
          referenceRange: [{text: '70-99 mg/dL'}], specimen: {display: 'Serum'}, performer: [{display: 'Synthetic laboratory'}], note: [{text: 'Fasting'}]},
        {resourceType: 'DocumentReference', id: 'note', author: [{display: 'Synthetic Author, MD'}],
          content: [{attachment: {creation: '2020-04-20'}}]},
        {resourceType: 'DocumentReference', id: 'unrelated', author: [{display: 'Not the author'}]},
      ],
    });
    expect(model.noteAuthors).toEqual(['Synthetic Author, MD']);
    expect(model.noteAuthored).toBe('2020-04-20');
    expect(model.measurements).toEqual([]);
    expect(model.labs).toEqual([{
      label: 'Glucose', code: '2345-7', value: '<0 mg/dL', status: 'final', collected: '2020-04-21',
      issued: '2020-04-23T12:30:00Z', referenceRange: ['70-99 mg/dL'], specimen: 'Serum',
      laboratory: ['Synthetic laboratory'], notes: ['Fasting'],
    }]);
  });
  it('shows referenced encounter measurements with zero scores and distinct LNMP dates, not unrelated observations', () => {
    const model = new EncounterModel({
      extension: [
        {url: 'https://yourphr.org/fhir/StructureDefinition/encounter-observation', valueReference: {reference: '#phq'}},
        {url: 'https://yourphr.org/fhir/StructureDefinition/encounter-observation', valueReference: {reference: '#lnmp'}},
        {url: 'https://yourphr.org/fhir/StructureDefinition/encounter-observation', valueReference: {reference: '#bp'}},
      ],
      contained: [
        {resourceType: 'Observation', id: 'phq', code: {text: 'PHQ-2', coding: [{system: 'http://loinc.org', code: '55758-7'}]},
          valueQuantity: {value: 0, unit: 'score'}, effectiveDateTime: '2020-04-20'},
        {resourceType: 'Observation', id: 'lnmp', code: {text: 'LNMP'}, valueDateTime: '2020-04-04', effectiveDateTime: '2020-04-20'},
        {resourceType: 'Observation', id: 'bp', code: {text: 'Blood pressure'},
          component: [{code: {text: 'Systolic blood pressure'}, valueQuantity: {value: 122, unit: 'mm[Hg]'}}],
          meta: {tag: [{code: 'needs-review'}]}, note: [{text: 'Incomplete reading'}]},
        {resourceType: 'Observation', id: 'unrelated', code: {text: 'Do not show'}},
      ],
    });
    expect(model.measurements).toEqual([
      {label: 'PHQ-2', value: '0 score', code: '55758-7', measuredAt: '2020-04-20', notes: [], needsReview: false},
      {label: 'LNMP', value: '2020-04-04', code: undefined, measuredAt: '2020-04-20', notes: [], needsReview: false},
      {label: 'Blood pressure', value: 'Systolic blood pressure: 122 mm[Hg]', code: undefined, measuredAt: undefined, notes: ['Incomplete reading'], needsReview: true},
    ]);
  });
  it('reads only a referenced LOINC chief complaint without treating diagnoses as complaints', () => {
    const model = new EncounterModel({
      resourceType: 'Encounter', reasonCode: [{text: 'Review'}, {text: 'My head hurts'}],
      reasonReference: [{reference: '#chief'}],
      contained: [
        {resourceType: 'Observation', id: 'other', code: {coding: [{system: 'http://loinc.org', code: '10154-3'}]}, valueString: 'Not linked'},
        {resourceType: 'Observation', id: 'chief', code: {coding: [{system: 'http://loinc.org', code: '10154-3'}]}, valueString: 'My head hurts'},
      ],
    });
    expect(model.chiefComplaint).toBe('My head hurts');
    expect(model.reasonCode).toHaveSize(2);
    expect(model.diagnoses).toEqual([]);
  });
  it('shows contained ICD diagnoses, their distinct expected dates and existing references', () => {
    const model = new EncounterModel({
      resourceType: 'Encounter', status: 'finished',
      contained: [
        {resourceType: 'Condition', id: 'd1', code: {text: 'URI', coding: [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J06.9'}]}},
        {resourceType: 'Condition', id: 'd2', code: {coding: [{system: 'http://hl7.org/fhir/sid/icd-9-cm', code: '465.9'}]}},
      ],
      diagnosis: [
        {condition: {reference: '#d1'}, extension: [{url: 'https://yourphr.org/fhir/StructureDefinition/encounter-diagnosis-expected-end-date', valueDate: '2026-10-12'}]},
        {condition: {reference: '#d2', display: 'Legacy URI'}},
        {condition: {reference: 'Condition/existing', display: 'Hypertension'}},
      ],
    });
    expect(model.diagnoses).toEqual([
      {display: 'URI', codes: ['ICD-10-CM J06.9'], expectedEndDate: '2026-10-12'},
      {display: 'Legacy URI', codes: ['ICD-9-CM 465.9'], expectedEndDate: undefined},
      {display: 'Hypertension', codes: [], expectedEndDate: undefined},
    ]);
  });
  it('should create an instance', () => {
    expect(new EncounterModel({})).toBeTruthy();
  });
  describe('with r4', () => {

    it('should parse example1.json', () => {
      const expected = new EncounterModel({})
      expected.narrative = example1Fixture.text.div;
      // periodEnd: string | undefined
      // periodStart: string | undefined
      // hasParticipant: boolean | undefined
      // locationDisplay: string | undefined
      // encounterType: string | undefined
      expected.resource_class = 'inpatient encounter'
      expected.resource_status = 'in-progress'
      expected.subject = { reference: 'Patient/example' } // US Core MS
      // no type/serviceType → title falls back to class.display
      expected.display = 'inpatient encounter'
      // participant

      expect(new EncounterModel(example1Fixture)).toEqual(expected);
    });

    it('should parse example2.json', () => {
      const expected = new EncounterModel({})
      expected.narrative = example2Fixture.text.div;
      expected.period_end = '2015-01-17T16:30:00Z'
      expected.period_start = '2015-01-17T16:00:00Z'
      expected.has_participant = true
      expected.location_display = 'Client\'s home'
      // example2.json has no encounter-level `type`; encounter_type stays undefined (we no longer
      // synthesise it from location — that duplicated the Location row). The title instead falls
      // back through class.display below.
      expected.resource_class =  'home health'
      expected.resource_status = 'finished'
      expected.subject = { reference: 'Patient/example' } // US Core MS
      expected.display = 'home health'
      expected.participant = [
        {
          display: 'Dr Adam Careful',
          reference: { reference: 'Practitioner/example', display: 'Dr Adam Careful' },
          text: undefined,
          periodStart: '2015-01-17T16:00:00+10:00',
          role: undefined,
        }
      ]

      expect(new EncounterModel(example2Fixture)).toEqual(expected);
    });

    it('should parse example3.json', () => {
      const expected = new EncounterModel({})
      expected.narrative = example3Fixture.text.div;
      // expected.periodEnd = '2015-01-17T16:30:00+10:00'
      // expected.periodStart = '2015-01-17T16:00:00+10:00'
      expected.has_participant = true
      // no location in example3 → location_display undefined (we dropped the 'Encounter' default)
      expected.encounter_type = [ { coding: [ Object({ system: 'http://snomed.info/sct', code: '11429006', display: 'Consultation' }) ] } ]
      expected.resource_class = 'ambulatory'
      expected.resource_status = 'finished'
      expected.subject = { reference: 'Patient/f201', display: 'Roel' } // US Core MS
      expected.display = 'Consultation' // title from type.coding.display
      expected.reasonCode = [
        {
          text: 'The patient had fever peaks over the last couple of days. He is worried about these peaks.'
        }
      ]
      expected.participant = [
        { display: undefined,
          reference: Object({ reference: 'Practitioner/f201' }),
          text: undefined,
          periodStart: undefined,
          role: undefined
        }
      ]
      expected.code = { coding: [{ system: 'http://snomed.info/sct', code: '11429006', display: 'Consultation' }] }

      expect(new EncounterModel(example3Fixture)).toEqual(expected);
    });

    // Non-US-Core (FollowMyHealth): no type/serviceType, a class with a system but no code/display,
    // only a location. The title must fall back to the location (not render blank), and the location
    // is not duplicated into a synthesised type.
    it('should title a FollowMyHealth encounter from its location', () => {
      const model = new EncounterModel(exampleFmhFixture);
      expect(model.display).toEqual('Department of Primary Care - Family Medicine, Example');
      expect(model.location_display).toEqual('Department of Primary Care - Family Medicine, Example');
      expect(model.encounter_type).toBeUndefined();
      expect(model.resource_status).toEqual('unknown');
      expect(model.period_start).toEqual('2026-03-05');
    });

    // Non-US-Core (Epic): class is a LOCAL patient-class code {code:"4", display:"HOV"} (NOT v3-ActCode
    // — Epic's spec defines class as the local patient class outside NL/DK). The legible label lives in
    // type[0].text ("Outpatient"), so the card title must surface that, never the raw local code "HOV".
    it('should title an Epic HOV encounter from type text, not the raw local class code (#262)', () => {
      const model = new EncounterModel(exampleEpicHovFixture);
      expect(model.display).toEqual('Outpatient'); // legible title from type[0].text
      // #371: the Epic-local class ("HOV", under Epic's OID system) is NOT a standard ActCode, so it is
      // suppressed — the card shows no cryptic "Class: HOV" line; the Type row + title carry the setting.
      expect(model.resource_class).toBeUndefined();
    });

  })

});
