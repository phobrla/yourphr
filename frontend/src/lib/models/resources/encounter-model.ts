import {fhirVersions, ResourceType} from '../constants';
import * as _ from "lodash";
import {CodableConceptModel, hasValue} from '../datatypes/codable-concept-model';
import {ReferenceModel} from '../datatypes/reference-model';
import {CodingModel} from '../datatypes/coding-model';
import {FastenDisplayModel} from '../fasten/fasten-display-model';
import {FastenOptions} from '../fasten/fasten-options';
import visitTerminology from '../../../../../src/patient-entry/visit-terminology.json';

interface DiagnosisResource {
  id?: string;
  resourceType?: string;
  code?: {text?: string; coding?: {system?: string; code?: string; display?: string}[]};
  valueString?: string;
  valueDateTime?: string;
  valueQuantity?: {value?: number; unit?: string; code?: string; comparator?: string};
  component?: {code?: {text?: string; coding?: {display?: string}[]}; valueQuantity?: {value?: number; unit?: string}}[];
  effectiveDateTime?: string;
  note?: {text?: string}[];
  meta?: {tag?: {code?: string}[]};
  status?: string;
  issued?: string;
  specimen?: {reference?: string; display?: string};
  performer?: {display?: string}[];
  referenceRange?: {text?: string}[];
  author?: {display?: string}[];
  content?: {attachment?: {creation?: string}}[];
  text?: {div?: string};
}

interface EncounterDiagnosis {
  condition?: {reference?: string; display?: string};
  extension?: {url?: string; valueDate?: string}[];
}

// The standard code systems for Encounter.class (HL7 v3 ActCode / ActEncounterCode). A class coding in
// any OTHER system is a vendor-LOCAL code (e.g. Epic's "HOV" under its 1.2.840.114350.* OID) — cryptic
// to a patient — so we don't surface it as a "Class" value (#371). Never guess.
const STANDARD_ENCOUNTER_CLASS_SYSTEMS = [
  'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  'http://hl7.org/fhir/v3/ActCode',
  'urn:oid:2.16.840.1.113883.5.4',
];

function isStandardEncounterClass(system: string | undefined): boolean {
  return !!system && STANDARD_ENCOUNTER_CLASS_SYSTEMS.includes(system);
}

export class EncounterModel extends FastenDisplayModel {
  code: CodableConceptModel | undefined
  display: string | undefined
  period_end: string | undefined
  period_start: string | undefined
  has_participant: boolean | undefined
  location_display: string | undefined
  encounter_type: CodableConceptModel[] | undefined
  resource_class: string | undefined
  resource_status: string | undefined
  discharge_disposition: CodableConceptModel | undefined
  subject: ReferenceModel | undefined          // US Core MS: subject (Patient)
  service_type: CodableConceptModel | undefined // US Core MS: serviceType
  participant: {
    display?: string,
    role?: string,
    reference?: ReferenceModel,
    text?: string,
    periodStart?:string
  }[] | undefined

  reasonCode: CodableConceptModel[] | undefined
  chiefComplaint: string | undefined
  measurements: {label: string; value: string; code?: string; measuredAt?: string; notes: string[]; needsReview: boolean}[] = []
  diagnoses: {display: string; codes: string[]; expectedEndDate?: string}[] = []
  narrative: string | undefined
  noteAuthors: string[] = []
  noteAuthored: string | undefined
  additionalNotes: {authors: string[]; authored?: string; narrative: string}[] = []
  billingCodes: {kind: string; code: string; description: string}[] = []
  labs: {label: string; code?: string; value: string; status?: string; collected?: string; issued?: string;
    specimen?: string; laboratory: string[]; referenceRange: string[]; notes: string[]}[] = []

  constructor(fhirResource: any, fhirVersion?: fhirVersions, fastenOptions?: FastenOptions) {
    super(fastenOptions)
    this.source_resource_type = ResourceType.Encounter
    this.resourceDTO(fhirResource, fhirVersion || fhirVersions.R4);
  }

  commonDTO(fhirResource:any){
    this.narrative = typeof fhirResource?.text?.div === 'string' ? fhirResource.text.div : undefined;
    this.code = _.get(fhirResource, 'serviceType') || _.get(fhirResource, 'type.0');
    this.resource_status = _.get(fhirResource, 'status');
    this.location_display = _.get(fhirResource, 'location[0].location.display');
    this.encounter_type = _.get(fhirResource, 'type');
    this.has_participant = _.has(fhirResource, 'participant');
    this.reasonCode = _.get(fhirResource, 'reasonCode');
    this.discharge_disposition = _.get(fhirResource, 'hospitalization.dischargeDisposition');
    this.subject = _.get(fhirResource, 'subject');             // US Core MS: subject (Patient)
    this.service_type = _.get(fhirResource, 'serviceType');    // US Core MS: serviceType

    // Card title fallback. US Core titles off type/serviceType; Veradigm/FollowMyHealth often omits
    // both and ships only a location + a class with a system but no code — so without this the title
    // renders blank (#54 follow-up). Fall back: type → serviceType → class → location → generic.
    // (Note: the backend sort_title isn't in resource_raw, so the card can't rely on it.)
    this.display =
      _.get(fhirResource, 'type.0.text') ||
      _.get(fhirResource, 'type.0.coding.0.display') ||
      _.get(fhirResource, 'serviceType.text') ||
      _.get(fhirResource, 'serviceType.coding.0.display') ||
      _.get(fhirResource, 'class.display') ||
      _.get(fhirResource, 'class.code') ||
      this.location_display ||
      'Encounter';
  };

  dstu2DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');
    this.resource_class = _.get(fhirResource, 'class');
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      let periodStart = _.get(item, 'period.start');
      periodStart = new Date(periodStart).toLocaleString();
      const reference = _.get(item, 'individual', {});
      return {
        display: _.get(item, 'type[0].coding[0].display'),
        reference: reference,
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  stu3DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');


    this.resource_class = _.get(fhirResource, 'class.display');
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      const periodStart = _.get(item, 'period.start');
      const reference = _.get(item, 'individual', {});
      return {
        display: _.get(item, 'type[0].coding[0].display'),
        reference: reference,
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  r4DTO(fhirResource:any){
    this.period_end = _.get(fhirResource, 'period.end');
    this.period_start = _.get(fhirResource, 'period.start');
    const diagnoses: EncounterDiagnosis[] = Array.isArray(fhirResource.diagnosis) ? fhirResource.diagnosis : [];
    const contained: DiagnosisResource[] = Array.isArray(fhirResource.contained) ? fhirResource.contained : [];
    const reasonReferences: {reference?: string}[] = Array.isArray(fhirResource.reasonReference) ? fhirResource.reasonReference : [];
    this.chiefComplaint = contained.find((item) => item.resourceType === 'Observation'
      && reasonReferences.some((reference) => reference.reference === `#${item.id}`)
      && item.code?.coding?.some((coding) => coding.system === visitTerminology.reason.chiefComplaintSystem
        && coding.code === visitTerminology.reason.chiefComplaintCode))?.valueString;
    const measurementReferences: {url?: string; valueReference?: {reference?: string}}[] =
      Array.isArray(fhirResource.extension) ? fhirResource.extension : [];
    const billingExtensions: {url?: string; valueCoding?: {system?: string; code?: string; display?: string}}[] =
      Array.isArray(fhirResource.extension) ? fhirResource.extension : [];
    this.billingCodes = billingExtensions.filter(entry => entry.url === visitTerminology.billing.extension
      && entry.valueCoding?.code).map(entry => ({
        kind: entry.valueCoding?.system === visitTerminology.billing.systems.revenue ? 'Revenue'
          : entry.valueCoding?.system === visitTerminology.billing.systems['type-of-bill'] ? 'Type of bill' : 'Billing code',
        code: entry.valueCoding?.code || '', description: entry.valueCoding?.display || '',
      }));
    const noteDocuments = contained.filter(item => item.resourceType === 'DocumentReference'
      && measurementReferences.some(extension => extension.url === visitTerminology.note.extension
        && extension.valueReference?.reference === `#${item.id}`));
    this.noteAuthors = (noteDocuments[0]?.author ?? []).flatMap(author => author.display ? [author.display] : []);
    this.noteAuthored = noteDocuments[0]?.content?.[0]?.attachment?.creation;
    // Legacy visits have only Encounter narrative; newer notes each carry a document narrative.
    if (!this.narrative && noteDocuments[0]?.text?.div) this.narrative = noteDocuments[0].text.div;
    this.additionalNotes = noteDocuments.slice(1).map(note => ({
      authors: (note.author ?? []).flatMap(author => author.display ? [author.display] : []),
      authored: note.content?.[0]?.attachment?.creation,
      narrative: note.text?.div ?? '',
    }));
    this.labs = contained.filter(item => item.resourceType === 'Observation'
      && measurementReferences.some(extension => extension.url === visitTerminology.labs.extension
        && extension.valueReference?.reference === `#${item.id}`)).map(item => ({
      label: item.code?.text || item.code?.coding?.[0]?.display || 'Lab result',
      code: item.code?.coding?.find(coding => coding.system === 'http://loinc.org')?.code,
      value: item.valueQuantity?.value !== undefined
        ? `${item.valueQuantity.comparator || ''}${item.valueQuantity.value} ${item.valueQuantity.unit || item.valueQuantity.code || ''}`.trim()
        : item.valueString || 'Not recorded',
      status: item.status,
      collected: item.effectiveDateTime,
      issued: item.issued,
      specimen: item.specimen?.display,
      laboratory: (item.performer ?? []).flatMap(performer => performer.display ? [performer.display] : []),
      referenceRange: (item.referenceRange ?? []).flatMap(range => range.text ? [range.text] : []),
      notes: (item.note ?? []).flatMap(note => note.text ? [note.text] : []),
    }));
    this.measurements = contained.filter((item) => item.resourceType === 'Observation'
      && measurementReferences.some((extension) => extension.url === visitTerminology.observations.extension
        && extension.valueReference?.reference === `#${item.id}`)).map((item) => {
      const quantity = item.valueQuantity;
      const value = item.valueDateTime || (quantity?.value !== undefined
        ? `${quantity.value} ${quantity.unit || quantity.code || ''}`.trim()
        : (item.component ?? []).filter((component) => component.valueQuantity?.value !== undefined)
          .map((component) => `${component.code?.text || component.code?.coding?.[0]?.display || 'Component'}: ${component.valueQuantity?.value} ${component.valueQuantity?.unit || ''}`.trim()).join('; '));
      return {
        label: item.code?.text || item.code?.coding?.find((coding) => coding.display)?.display || 'Measurement',
        value: value || 'Not recorded',
        code: item.code?.coding?.find((coding) => coding.system === 'http://loinc.org')?.code,
        measuredAt: item.effectiveDateTime,
        notes: (item.note ?? []).flatMap((note) => note.text ? [note.text] : []),
        needsReview: item.meta?.tag?.some((tag) => tag.code === 'needs-review') ?? false,
      };
    });
    this.diagnoses = diagnoses.map((diagnosis) => {
      const reference = diagnosis.condition?.reference;
      const condition = reference?.startsWith('#')
        ? contained.find((resource) => resource.id === reference.slice(1) && resource.resourceType === 'Condition') : undefined;
      const codings = condition?.code?.coding ?? [];
      return {
        display: condition?.code?.text || codings.find((coding) => coding.display)?.display
          || diagnosis.condition?.display || reference || 'Diagnosis',
        codes: codings.filter((coding) => coding.code).map((coding) => {
          const system = visitTerminology.diagnosis.systems.find((system) => system.system === coding.system)?.label;
          return [system || coding.system, coding.code].filter(Boolean).join(' ');
        }),
        expectedEndDate: diagnosis.extension?.find((extension) =>
          extension.url === visitTerminology.diagnosis.expectedEndDateExtension)?.valueDate,
      };
    });

    // Only surface a "Class" value when it's a recognized standard ActCode (AMB/IMP/EMER/…). A
    // vendor-LOCAL class code (e.g. Epic "HOV") is cryptic and the Type row + title already convey the
    // setting legibly, so suppress it rather than show a raw code (#371). Veradigm R4 ships class with a
    // system but no code/display — that resolves to undefined here too. Never guess.
    this.resource_class = isStandardEncounterClass(_.get(fhirResource, 'class.system'))
      ? (_.get(fhirResource, 'class.display') || _.get(fhirResource, 'class.code'))
      : undefined;
    this.participant = _.get(fhirResource, 'participant', []).map((item: any) => {
      const periodStart = _.get(item, 'period.start');
      return {
        role: _.get(item, 'type[0].text') || _.get(item, 'type[0].coding[0].display'),
        display: _.get(item, 'individual.display'),
        reference: _.get(item, 'individual'),
        text: _.get(item, 'type[0].text'),
        periodStart,
      };
    });
  };

  resourceDTO(fhirResource:any, fhirVersion: fhirVersions){
    switch (fhirVersion) {
      case fhirVersions.DSTU2: {
        this.commonDTO(fhirResource)
        this.dstu2DTO(fhirResource)
        return
      }
      case fhirVersions.STU3: {
        this.commonDTO(fhirResource)
        this.stu3DTO(fhirResource)
        return
      }
      case fhirVersions.R4: {
        this.commonDTO(fhirResource)
        this.r4DTO(fhirResource)
        return
      }

      default:
        throw Error('Unrecognized the fhir version property type.');
    }
  };
}
