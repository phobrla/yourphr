import type { Encounter } from '@medplum/fhirtypes';
import type { BuiltRecord, PatientEntryContext, PatientEntryRequest } from './shared.js';
import { PatientEntryError, effectiveDateTime, stamp } from './shared.js';
import terminology from './visit-terminology.json' with { type: 'json' };
import { addVisitDiagnoses, parseVisitDiagnoses } from './visit-diagnoses.js';

const US_CORE_ENCOUNTER = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter';

function selectedCoding(value: unknown, choices: typeof terminology.location, field: string) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new PatientEntryError(`Choose a valid ${field}.`);
  const option = choices.options.find((candidate) => candidate.code === value.trim());
  if (!option) throw new PatientEntryError(`Choose a valid ${field}.`);
  return { system: choices.system, code: option.code, display: option.display };
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function buildPatientVisit(req: PatientEntryRequest, now = new Date(), context: PatientEntryContext = { subject: '' }): BuiltRecord {
  const reasons = parseVisitReasons(req);
  const reason = reasons.find((item) => item.primary)?.concept.text || reasons[0]?.concept.text || '';
  const typeCoding = selectedCoding(req.visit_type_code, terminology.type, 'visit type');
  const visitType = typeCoding?.display || (req.visit_type ?? '').trim();
  const encounterClass = (req.visit_class ?? '').trim();
  const status = (req.visit_status ?? 'finished').trim();
  if (!reason) throw new PatientEntryError('Name what the visit was for.');
  if (!visitType) throw new PatientEntryError('Name the type of visit.');
  const classOption = terminology.class.options.find((option) => option.code === encounterClass);
  if (!classOption) throw new PatientEntryError('Choose a visit setting.');
  if (!terminology.status.options.some((option) => option.code === status)) throw new PatientEntryError('Choose a valid visit status.');
  const locationCoding = selectedCoding(req.visit_location_code, terminology.location, 'location type');
  const dispositionCoding = selectedCoding(req.visit_disposition_code, terminology.disposition, 'discharge disposition');
  if (!context.subject) throw new PatientEntryError('A patient record is required for a visit.');

  const review: string[] = [];
  const start = effectiveDateTime(req.effective_date_time, now, review);
  const end = (req.visit_end_date_time ?? '').trim()
    ? effectiveDateTime(req.visit_end_date_time, now, review)
    : '';
  const period = start || end ? {
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  } : undefined;
  if (period?.start && period.end && Date.parse(period.end) < Date.parse(period.start)) {
    delete period.end;
    review.push('the visit end is earlier than its start, so the end time needs review');
  }
  const encounter: Encounter = {
    resourceType: 'Encounter',
    status: status as Encounter['status'],
    class: { system: terminology.class.system, code: encounterClass, display: classOption.display },
    type: [{ text: visitType, ...(typeCoding ? {coding: [typeCoding]} : {}) }],
    reasonCode: reasons.map((item) => item.concept),
    subject: { reference: context.subject },
    ...(period ? { period } : {}),
  };

  const diagnosisIds = req.visit_diagnosis_ids === undefined ? [] : req.visit_diagnosis_ids;
  if (req.visit_billing !== undefined) {
    if (!Array.isArray(req.visit_billing)) throw new PatientEntryError('Enter valid UB-04 billing codes.');
    for (const entry of req.visit_billing) {
      if (!entry || !['revenue', 'type-of-bill'].includes(entry.kind) || typeof entry.code !== 'string'
        || !/^\d{4}$/.test(entry.code.trim()) || (entry.description !== undefined && typeof entry.description !== 'string')) {
        throw new PatientEntryError('Enter a four-digit UB-04 revenue or type-of-bill code, including leading zeros.');
      }
      encounter.extension = [...(encounter.extension ?? []), {
        url: terminology.billing.extension,
        valueCoding: {system: terminology.billing.systems[entry.kind], code: entry.code.trim(),
          ...(entry.description?.trim() ? {display: entry.description.trim()} : {})},
      }];
    }
  }
  if (!Array.isArray(diagnosisIds) || diagnosisIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new PatientEntryError('Choose valid diagnoses from your records.');
  }
  const uniqueDiagnosisIds = [...new Set(diagnosisIds.map((id) => id.trim()))];
  addVisitDiagnoses(encounter, parseVisitDiagnoses(req.visit_diagnoses), uniqueDiagnosisIds);

  const identifier = (req.visit_identifier ?? '').trim();
  if (identifier) encounter.identifier = [{ value: identifier }];

  const providerId = (req.provider_id ?? '').trim();
  const providerName = (req.provider_name ?? '').trim();
  if (providerId || providerName) {
    encounter.participant = [{
      type: [{ text: 'Provider' }],
      individual: {
        ...(providerId ? { reference: `Practitioner/${providerId}` } : {}),
        ...(providerName ? { display: providerName } : {}),
      },
    }];
  }

  const organizationId = (req.organization_id ?? '').trim();
  const organizationName = (req.organization_name ?? '').trim();
  if (organizationId || organizationName) {
    encounter.serviceProvider = {
      ...(organizationId ? { reference: `Organization/${organizationId}` } : {}),
      ...(organizationName ? { display: organizationName } : {}),
    };
  }

  const location = (req.visit_location ?? '').trim();
  if (locationCoding) {
    const roleCoding = terminology.location.options.find((option) => option.code === locationCoding.code)?.roleCoding;
    encounter.contained = [...(encounter.contained ?? []), {
      resourceType: 'Location',
      id: 'visit-location',
      name: location || locationCoding.display,
      type: [{ coding: [locationCoding, ...(roleCoding ? [roleCoding] : [])], text: locationCoding.display }],
    }];
    encounter.location = [{ location: { reference: '#visit-location', display: location || locationCoding.display } }];
  } else if (location) {
    encounter.location = [{ location: { display: location } }];
  }

  const disposition = (req.visit_disposition ?? '').trim();
  if (disposition || dispositionCoding) {
    encounter.hospitalization = {
      dischargeDisposition: {
        ...(dispositionCoding ? { coding: [dispositionCoding] } : {}),
        text: disposition || dispositionCoding?.display,
      },
    };
  }

  const note = (req.note ?? '').trim();
  if (note) encounter.text = { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(note).replace(/\r?\n/g, '<br />')}</div>` };

  stamp(encounter, review);
  const primary = reasons.find((item) => item.primary);
  if (primary) {
    encounter.contained = [...(encounter.contained ?? []), {
      resourceType: 'Observation',
      id: 'chief-complaint',
      status: 'final',
      code: {coding: [{system: terminology.reason.chiefComplaintSystem, code: terminology.reason.chiefComplaintCode, display: 'Chief complaint Narrative - Reported'}]},
      subject: {reference: context.subject},
      encounter: {reference: '#'},
      valueString: primary.concept.text,
      ...(period?.start ? {effectiveDateTime: period.start} : {}),
      meta: {source: encounter.meta?.source, tag: encounter.meta?.tag},
    }];
    encounter.reasonReference = [{reference: '#chief-complaint', display: primary.concept.text}];
  }
  encounter.meta = {
    ...encounter.meta,
    lastUpdated: now.toISOString(),
    profile: [...(encounter.meta?.profile ?? []), US_CORE_ENCOUNTER],
  };
  return { resource: encounter, sortTitle: reason, review };
}

function parseVisitReasons(req: PatientEntryRequest) {
  if (req.visit_reasons === undefined) {
    return [{concept: {text: (req.name ?? '').trim()}, primary: false}];
  }
  if (!Array.isArray(req.visit_reasons) || req.visit_reasons.length === 0) {
    throw new PatientEntryError('Enter at least one reason for the visit.');
  }
  const reasons = req.visit_reasons.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.text !== 'string'
      || (item.primary !== undefined && typeof item.primary !== 'boolean')) {
      throw new PatientEntryError('Enter valid visit reasons and a primary selection.');
    }
    const coding = selectedCoding(item.code, terminology.reason, 'visit reason');
    const text = item.text.trim();
    if (!text) throw new PatientEntryError('Enter text for every visit reason.');
    return {concept: {text, ...(coding ? {coding: [coding]} : {})}, primary: item.primary === true};
  });
  if (reasons.filter((item) => item.primary).length > 1) {
    throw new PatientEntryError('Choose only one primary chief complaint.');
  }
  return reasons;
}

export function validateVisitDiagnosisIds(value: unknown, allowedIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new PatientEntryError('Choose valid diagnoses from your records.');
  }
  const ids = [...new Set((value as string[]).map((id) => id.trim()))];
  if (ids.some((id) => !allowedIds.has(id))) {
    throw new PatientEntryError('One or more visit diagnoses are not in your own records.');
  }
  return ids;
}
