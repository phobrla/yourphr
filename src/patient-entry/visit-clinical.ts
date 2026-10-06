import type {DocumentReference, Encounter, Observation, Specimen} from '@medplum/fhirtypes';
import type {PatientEntryRequest, VisitLabEntry, VisitNoteAuthor, VisitNoteEntry} from './shared.js';
import {LOINC, PatientEntryError, stamp, UCUM} from './shared.js';
import terminology from './visit-terminology.json' with {type: 'json'};

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new PatientEntryError(`Enter valid ${label} text.`);
  return value.trim() || undefined;
}

function dateTime(value: unknown, label: string, instant = false): string | undefined {
  const text = optionalText(value, label);
  if (!text) return undefined;
  const pattern = instant ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
    : /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  const day = text.slice(0, 10);
  if (!pattern.test(text) || !Number.isFinite(Date.parse(text))
    || new Date(day).toISOString().slice(0, 10) !== day
    || (text.length > 10 && (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19)) > 59))) {
    throw new PatientEntryError(`Enter a valid ${label}${instant ? ' timestamp with timezone' : ' date or timestamp with timezone'}.`);
  }
  return text;
}

function labObservation(raw: VisitLabEntry, index: number, encounter: Encounter): {observation: Observation; specimen?: Specimen} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PatientEntryError('Enter valid lab results.');
  const code = optionalText(raw.code, 'LOINC code');
  const display = optionalText(raw.display, 'lab name');
  if (!code || !/^\d{1,7}-\d$/.test(code) || !display) throw new PatientEntryError('Enter a LOINC code and test name for each lab result.');
  if (!['preliminary', 'final', 'amended', 'corrected', 'unknown'].includes(raw.status)) throw new PatientEntryError('Choose a valid lab result status.');
  const unit = optionalText(raw.unit, 'lab unit');
  const ucum = optionalText(raw.ucum_code, 'UCUM code');
  const text = optionalText(raw.text, 'lab result');
  const collected = dateTime(raw.collected, 'specimen collection');
  const issued = dateTime(raw.issued, 'lab report', true);
  if (collected && issued && (collected.length === 10
    ? issued.slice(0, 10) < collected : Date.parse(issued) < Date.parse(collected))) {
    throw new PatientEntryError('The lab report cannot precede specimen collection.');
  }
  const range = optionalText(raw.reference_range, 'reference range');
  const specimenText = optionalText(raw.specimen, 'specimen');
  const laboratory = optionalText(raw.laboratory, 'laboratory');
  const note = optionalText(raw.note, 'lab note');
  const observation: Observation = {
    resourceType: 'Observation', status: raw.status,
    category: [{coding: [{system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory'}]}],
    code: {coding: [{system: LOINC, code, display}], text: display},
    subject: encounter.subject, encounter: {reference: '#'},
    ...(collected ? {effectiveDateTime: collected} : {}),
    ...(issued ? {issued} : {}),
    ...(range ? {referenceRange: [{text: range}]} : {}),
    ...(laboratory ? {performer: [{display: laboratory}]} : {}),
    ...(note ? {note: [{text: note}]} : {}),
  };
  if (raw.result_type === 'quantity') {
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || text) throw new PatientEntryError('Enter one finite numeric lab result, not a text result.');
    if (raw.comparator !== undefined && !['<', '<=', '>=', '>'].includes(raw.comparator)) throw new PatientEntryError('Choose a valid numeric comparator.');
    observation.valueQuantity = {value: raw.value, ...(unit ? {unit} : {}),
      ...(ucum ? {system: UCUM, code: ucum} : {}), ...(raw.comparator ? {comparator: raw.comparator} : {})};
  } else if (raw.result_type === 'text') {
    if (!text || raw.value !== undefined || unit || ucum || raw.comparator !== undefined) throw new PatientEntryError('Enter a qualitative lab result without numeric values or units.');
    observation.valueString = text;
  } else {
    throw new PatientEntryError('Choose a numeric or qualitative lab result.');
  }
  stamp(observation, []);
  observation.id = `visit-lab-${index + 1}`;
  if (!specimenText) return {observation};
  const specimen: Specimen = {
    resourceType: 'Specimen', id: `visit-lab-specimen-${index + 1}`, subject: encounter.subject,
    type: {text: specimenText}, ...(collected ? {collection: {collectedDateTime: collected}} : {}),
  };
  observation.specimen = {reference: `#${specimen.id}`, display: specimenText};
  return {observation, specimen};
}

export function parseVisitNotes(value: unknown): VisitNoteEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PatientEntryError('Enter valid visit notes.');
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.note !== 'string' || !entry.note.trim()) {
      throw new PatientEntryError('Enter text for every additional visit note.');
    }
    if (entry.note_format !== undefined && !['plain', 'markdown'].includes(entry.note_format)) {
      throw new PatientEntryError('Choose a supported visit note format.');
    }
    return {note: entry.note.trim(), note_format: entry.note_format, authored: dateTime(entry.authored, 'note authored'),
      authors: parseNoteAuthors(entry.authors, true)};
  });
}

function parseNoteAuthors(value: unknown, requireProviders = false): VisitNoteAuthor[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PatientEntryError('Choose valid note authors.');
  return value.map(author => {
    if (!author || typeof author !== 'object' || Array.isArray(author)
      || ((requireProviders || author.provider_id !== undefined)
        && (typeof author.provider_id !== 'string' || !/^[A-Za-z0-9.-]{1,64}$/.test(author.provider_id)))) {
      throw new PatientEntryError('Choose valid note authors from your providers.');
    }
    const name = optionalText(author.name, 'note author');
    if (!author.provider_id && !name) throw new PatientEntryError('Choose valid note authors from your providers.');
    return {name, ...(author.provider_id ? {provider_id: author.provider_id} : {})};
  });
}

const plainNarrative = (text: string): string => `<div xmlns="http://www.w3.org/1999/xhtml">${text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, '<br />')}</div>`;

export function addVisitClinicalContent(encounter: Encounter, request: PatientEntryRequest, now: Date, noteNarratives: (string | undefined)[] = []): void {
  if (request.visit_labs !== undefined) {
    if (!Array.isArray(request.visit_labs)) throw new PatientEntryError('Enter valid lab results.');
    for (const [index, entry] of request.visit_labs.entries()) {
      const {observation, specimen} = labObservation(entry, index, encounter);
      encounter.contained = [...(encounter.contained ?? []), observation, ...(specimen ? [specimen] : [])];
      encounter.extension = [...(encounter.extension ?? []), {
        url: terminology.labs.extension, valueReference: {reference: `#${observation.id}`},
      }];
    }
  }
  const authored = dateTime(request.visit_note_authored, 'note authored');
  const authors = parseNoteAuthors(request.visit_note_authors);
  if (!request.note?.trim()) {
    if (authors.length || authored) throw new PatientEntryError('Enter a note before attributing its author or authored date.');
  }
  const notes = [
    ...(request.note?.trim() ? [{note: request.note, authors, authored, narrative: encounter.text?.div}] : []),
    ...parseVisitNotes(request.visit_notes).map((note, index) => ({...note, narrative: noteNarratives[index] ?? plainNarrative(note.note)})),
  ];
  for (const [index, note] of notes.entries()) {
    // Encounter narrative has no author field; the document owns note authorship.
    const document: DocumentReference = {
      resourceType: 'DocumentReference', status: 'current', subject: encounter.subject,
      date: now.toISOString(), description: 'Visit note transcribed by the patient',
      ...(note.authors?.length ? {author: note.authors.map(author => ({
        ...(author.name ? {display: author.name} : {}), ...(author.provider_id ? {reference: `Practitioner/${author.provider_id}`} : {}),
      }))} : {}),
      text: {status: 'additional', div: note.narrative ?? plainNarrative(note.note)},
      content: [{attachment: {
        contentType: 'application/xhtml+xml',
        data: Buffer.from(note.narrative ?? plainNarrative(note.note), 'utf8').toString('base64'),
        ...(note.authored ? {creation: note.authored} : {}),
        title: 'Visit note',
      }}],
      context: {encounter: [{reference: '#'}]},
    };
    stamp(document, []);
    document.id = index === 0 ? 'visit-note' : `visit-note-${index + 1}`;
    encounter.contained = [...(encounter.contained ?? []), document];
    encounter.extension = [...(encounter.extension ?? []), {
      url: terminology.note.extension, valueReference: {reference: `#${document.id}`},
    }];
  }
}
