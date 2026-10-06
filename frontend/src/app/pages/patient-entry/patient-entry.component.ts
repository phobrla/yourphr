import {Component, ChangeDetectionStrategy, OnInit, TemplateRef} from '@angular/core';

import {FormsModule} from '@angular/forms';
import {NgTemplateOutlet} from '@angular/common';
import {NgbModal, NgbModalModule, NgbTooltipModule} from '@ng-bootstrap/ng-bootstrap';
import {Router, RouterModule} from '@angular/router';
import {FastenApiService} from '../../services/fasten-api.service';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {extractErrorFromResponse} from '../../../lib/utils/error_extract';
import visitTerminology from '../../../../../src/patient-entry/visit-terminology.json';
import {IcdDiagnosisSearchComponent} from '../../components/icd-diagnosis-search/icd-diagnosis-search.component';
import {IcdSuggestion} from '../../services/icd-catalog.service';

type VisitEditorSection = 'measurements' | 'labs' | 'notes' | 'reasons' | 'note' | 'diagnoses' | 'billing';

/**
 * What a person adds about themselves (#313, #696, #763).
 *
 * The kinds offered here are exactly the kinds the server can store in a record type of their own:
 * a home vital as an Observation, an allergy as an AllergyIntolerance, a medication as a
 * MedicationStatement, a visit as an Encounter, and an implant as a Device. Offering a kind the
 * server would have to reshape would be offering to misfile it.
 */
@Component({
  standalone: true,
  imports: [FormsModule, RouterModule, IcdDiagnosisSearchComponent, NgbTooltipModule, NgbModalModule, NgTemplateOutlet],
  selector: 'app-patient-entry',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './patient-entry.component.html',
  styleUrl: './patient-entry.component.scss',
})
export class PatientEntryComponent implements OnInit {
  kind: 'vital' | 'visit' | 'allergy' | 'medication' | 'implant' = 'vital';
  /**
   * What measured it (#764). '' means they named no device, which is the honest answer and not a
   * default; '__new' reveals the box for one they have not named here before.
   */
  deviceId = '';
  newDeviceName = '';
  devices: {id: string, name: string}[] = [];
  /** The substance or the medicine, in the person's own words. */
  name = '';
  /** Medication only. Empty means they did not say, and the record says so rather than guessing. */
  medicationStatus: '' | 'active' | 'stopped' = '';
  visitType = '';
  visitTypeCode = '';
  visitReasonCode = '';
  additionalVisitReasons: {text: string; code: string}[] = [];
  primaryVisitReason = -1;
  visitObservations: {
    kind: string; value: number | null; systolic: number | null; diastolic: number | null;
    unit: string; date: string; measured_at: string; note: string;
  }[] = [];
  visitLabs: (NonNullable<Parameters<FastenApiService['createPatientEntry']>[0]['visit_labs']>[number] & {
    selection: string; numericValue: number | null; reportDate: string;
  })[] = [];
  visitNoteAuthors: {name: string; provider_id?: string}[] = [];
  visitNoteAuthored = '';
  additionalVisitNotes: {note: string; authors: {name: string; provider_id?: string}[]; authored: string}[] = [];
  providerLoadError = '';
  dialogError = '';
  visitBilling: {kind: 'revenue' | 'type-of-bill'; code: string; description: string}[] = [];

  openVisitEditor(template: TemplateRef<unknown>, section: VisitEditorSection, add = false): void {
    const noteText = this.visitNote;
    const diagnoses = this.visitDiagnoses.map(diagnosis => ({...diagnosis}));
    const diagnosisIds = [...this.visitDiagnosisIds];
    const diagnosisDates = {...this.visitDiagnosisEndDates};
    const billing = this.visitBilling.map(entry => ({...entry}));
    const firstReason = this.name;
    const firstReasonCode = this.visitReasonCode;
    const reasons = this.additionalVisitReasons.map(reason => ({...reason}));
    const primaryReason = this.primaryVisitReason;
    const observations = this.visitObservations.map(entry => ({...entry}));
    const labs = this.visitLabs.map(entry => ({...entry}));
    const authors = this.visitNoteAuthors.map(entry => ({...entry}));
    const authored = this.visitNoteAuthored;
    const notes = this.additionalVisitNotes.map(note => ({...note, authors: note.authors.map(author => ({...author}))}));
    this.dialogError = '';
    if (add) {
      if (section === 'measurements') this.addVisitObservation();
      else if (section === 'labs') this.addVisitLab();
      else if (section === 'notes') this.additionalVisitNotes.push({note: '', authors: [], authored: ''});
      else if (section === 'diagnoses') this.addVisitDiagnosis();
      else if (section === 'billing') this.visitBilling.push({kind: 'revenue', code: '', description: ''});
      else if (section === 'reasons' && this.name.trim()) this.additionalVisitReasons.push({text: '', code: ''});
    }
    const modal = this.modalService.open(template, {
      size: 'xl', scrollable: true,
      ariaLabelledBy: `visit-${section}-dialog-title`,
    });
    modal.dismissed.subscribe(() => {
      if (section === 'measurements') this.visitObservations = observations;
      else if (section === 'labs') this.visitLabs = labs;
      else if (section === 'note') {
        this.visitNote = noteText;
        this.visitNoteAuthors = authors;
        this.visitNoteAuthored = authored;
      } else if (section === 'notes') this.additionalVisitNotes = notes;
      else if (section === 'billing') this.visitBilling = billing;
      else if (section === 'diagnoses') {
        this.visitDiagnoses = diagnoses;
        this.visitDiagnosisIds = diagnosisIds;
        this.visitDiagnosisEndDates = diagnosisDates;
      } else {
        this.name = firstReason;
        this.visitReasonCode = firstReasonCode;
        this.additionalVisitReasons = reasons;
        this.primaryVisitReason = primaryReason;
      }
    });
  }

  finishVisitEditor(section: VisitEditorSection, close: () => void): void {
    this.dialogError = '';
    if (section === 'reasons' && (!this.name.trim() || this.additionalVisitReasons.some(reason => !reason.text.trim()))) {
      this.dialogError = 'Enter every visit reason or remove the empty additional row.';
    }
    if (section === 'diagnoses' && this.visitDiagnoses.some(diagnosis => !diagnosis.code.trim())) {
      this.dialogError = 'Choose or enter every diagnosis code, or remove the empty row.';
    }
    if (section === 'billing' && this.visitBilling.some(entry => !/^\d{4}$/.test(entry.code.trim()))) {
      this.dialogError = 'Enter each four-digit UB-04 code exactly as printed, including leading zeros, or remove the row.';
    }
    if (section === 'measurements' && this.visitObservations.some(entry => {
      const option = this.visitTerminology.observations.options.find(item => item.key === entry.kind);
      return !option || (entry.kind === 'lnmp' ? !entry.date
        : entry.kind === 'blood_pressure' ? entry.systolic === null && entry.diastolic === null
          : entry.value === null || !Number.isFinite(entry.value))
        || (typeof option.max === 'number' && (entry.value === null || !Number.isInteger(entry.value)
          || entry.value < 0 || entry.value > option.max));
    })) this.dialogError = 'Enter each measurement value or remove the empty row. PHQ scores must be whole numbers in the stated range.';
    if (section === 'labs' && this.visitLabs.some(entry => !entry.code.trim() || !/^\d{1,7}-\d$/.test(entry.code.trim())
      || !entry.display.trim() || (entry.result_type === 'text' ? !entry.text?.trim()
        : entry.numericValue === null || !Number.isFinite(entry.numericValue)))) {
      this.dialogError = 'Enter a valid LOINC code, test name and result for every lab, or remove the empty row.';
    }
    if (section === 'note' && this.visitNoteAuthors.some(author => !author.provider_id)) {
      this.dialogError = 'Choose a provider for every note author, or remove the empty row.';
    }
    if (section === 'note' && !this.visitNote.trim() && (this.visitNoteAuthors.length || this.visitNoteAuthored)) {
      this.dialogError = 'Enter the note content or remove its attribution.';
    }
    if (section === 'notes' && this.additionalVisitNotes.some(note => !note.note.trim()
      || note.authors.some(author => !author.provider_id))) this.dialogError = 'Enter every note and choose its authors, or remove the empty row.';
    if (!this.dialogError) close();
  }

  removeVisitEditorRow(entries: unknown[], index: number, event: Event): void {
    // Keep keyboard focus inside the modal before the focused Remove button disappears.
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    }
    entries.splice(index, 1);
  }

  measurementSummary(entry: typeof this.visitObservations[number]): string {
    const label = this.visitTerminology.observations.options.find(option => option.key === entry.kind)?.label || 'Measurement';
    const value = entry.kind === 'lnmp' ? entry.date
      : entry.kind === 'blood_pressure' ? `${entry.systolic ?? 'Not entered'} / ${entry.diastolic ?? 'Not entered'} mmHg`
        : `${entry.value ?? 'Not entered'} ${entry.unit}`.trim();
    return `${label}: ${value}`;
  }

  labSummary(entry: typeof this.visitLabs[number]): string {
    const value = entry.result_type === 'text' ? entry.text || 'Not entered'
      : `${entry.comparator || ''}${entry.numericValue ?? 'Not entered'} ${entry.unit || ''}`.trim();
    return `${entry.display || 'Lab result'} (${entry.code || 'No LOINC code'}): ${value}`;
  }

  selectNoteAuthor(author: {name: string; provider_id?: string}): void {
    author.name = this.practitioners.find(provider => provider.id === author.provider_id)?.name || '';
  }

  loadProviders(): void {
    this.api.getResources('Practitioner').subscribe({
      next: (rows) => {this.practitioners = this.directoryOptions(rows, 'Practitioner'); this.providerLoadError = '';},
      error: () => {this.practitioners = []; this.providerLoadError = 'Could not load providers. Note author selection is unavailable; please try again.';},
    });
  }

  addVisitLab(): void {
    this.visitLabs.push({selection: '', code: '', display: '', result_type: 'quantity',
      numericValue: null, reportDate: '', status: 'unknown'});
  }

  selectVisitLab(index: number): void {
    const lab = this.visitLabs[index];
    const choice = this.visitTerminology.labs.options.find(option => option.code === lab.selection);
    lab.code = choice?.code ?? '';
    lab.display = choice?.display ?? '';
  }

  changeVisitLabResult(index: number): void {
    const lab = this.visitLabs[index];
    lab.numericValue = null;
    lab.text = undefined;
    lab.unit = undefined;
    lab.ucum_code = undefined;
    lab.comparator = undefined;
  }

  addVisitObservation(): void {
    this.visitObservations.push({
      kind: 'body_weight', value: null, systolic: null, diastolic: null, unit: 'kg', date: '', measured_at: '', note: '',
    });
  }

  changeVisitObservation(observation: typeof this.visitObservations[number]): void {
    observation.value = null;
    observation.systolic = null;
    observation.diastolic = null;
    observation.date = '';
    observation.unit = this.visitTerminology.observations.options.find((option) => option.key === observation.kind)?.unit || '';
  }
  visitClass = '';
  visitStatus = 'finished';
  visitIdentifier = '';
  visitEndDate = '';
  visitStartTime = '';
  visitEndTime = '';

  private visitTimestamp(date: string, time: string, label: string): string | undefined {
    if (!time) return date || undefined;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)
      || !Number.isFinite(Date.parse(`${date}T${time}`))
      || new Date(`${date}T${time}`).getHours() !== Number(time.slice(0, 2))
      || new Date(`${date}T${time}`).getMinutes() !== Number(time.slice(3, 5))
      || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new RangeError(`Enter a valid ${label} date and time. Times use your local timezone.`);
    }
    return new Date(`${date}T${time}`).toISOString();
  }
  visitLocation = '';
  visitLocationCode = '';
  visitDisposition = '';
  visitDispositionCode = '';
  readonly visitTerminology = visitTerminology;
  selectVisitType(code: string): void {
    this.visitType = this.visitTerminology.type.options.find((item) => item.code === code)?.display || '';
  }

  selectVisitReason(code: string, index = -1): void {
    const text = this.visitTerminology.reason.options.find((item) => item.code === code)?.display || '';
    if (index === -1) {
      if (!this.name.trim()) this.name = text;
    } else {
      const reason = this.additionalVisitReasons[index];
      if (reason && !reason.text.trim()) reason.text = text;
    }
  }

  removeVisitReason(index: number, event?: Event): void {
    if (event?.currentTarget instanceof HTMLElement) {
      event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
    }
    this.additionalVisitReasons.splice(index, 1);
    if (this.primaryVisitReason === index + 1) this.primaryVisitReason = -1;
    else if (this.primaryVisitReason > index + 1) this.primaryVisitReason--;
  }
  visitDiagnosisIds: string[] = [];
  visitDiagnosisEndDates: Record<string, string> = {};
  visitDiagnoses: {system: string; code: string; display: string; expected_end_date: string; selectedFromCatalog?: boolean}[] = [];
  manualConditions: {id: string; title: string}[] = [];
  diagnosisLoadError = '';
  implantStatus: 'active' | 'inactive' | 'unknown' = 'unknown';
  implantDeviceIdentifier = '';
  implantDistinctIdentifier = '';
  implantSerialNumber = '';
  implantLotNumber = '';
  implantManufactureDate = '';
  implantExpirationDate = '';
  providerId = '';
  organizationId = '';
  visitNote = '';
  practitioners: {id: string; name: string}[] = [];
  organizations: {id: string; name: string}[] = [];
  vital: 'body_weight' | 'heart_rate' | 'body_temperature' | 'oxygen_saturation' | 'blood_pressure' = 'body_weight';
  value: number | null = null;
  systolic: number | null = null;
  diastolic: number | null = null;
  unit = '';
  effectiveDate = ''; // yyyy-mm-dd optional
  saving = false;
  error = '';
  successMsg = '';
  /** Why the last entry is waiting, in the words the server used (#762). */
  needsReview: string[] = [];
  lastSourceId = '';
  lastResourceId = '';
  lastResourceType = 'Observation';

  constructor(private api: FastenApiService, private router: Router, private modalService: NgbModal) {
    const today = new Date();
    this.effectiveDate = today.toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    // Their own devices, so a cuff named once is a choice from then on. A failure here costs the
    // convenience, not the entry: they can still type a name.
    this.api.getOwnDevices().subscribe({next: (devices) => this.devices = devices, error: () => this.devices = []});
    this.loadProviders();
    this.api.getResources('Organization').subscribe({next: (rows) => this.organizations = this.directoryOptions(rows, 'Organization'), error: () => this.organizations = []});
    this.api.getSources().subscribe({
      next: (sources) => {
        const manualSource = sources.find((source) => source.platform_type === 'manual' && source.id);
        if (!manualSource?.id) return;
        this.api.getResources('Condition', manualSource.id).subscribe({
          next: (rows) => {
            this.manualConditions = rows
              .filter((row) => row.source_id === manualSource.id && row.source_resource_id)
              .map((row) => ({id: row.source_resource_id, title: row.sort_title || 'Condition'}))
              .sort((left, right) => left.title.localeCompare(right.title));
          },
          error: () => {
            this.manualConditions = [];
            this.diagnosisLoadError = 'Could not load your diagnoses. You can still save the visit without linking one.';
          },
        });
      },
      error: () => {
        this.manualConditions = [];
        this.diagnosisLoadError = 'Could not load your diagnoses. You can still save the visit without linking one.';
      },
    });
  }

  get needsSingleValue(): boolean {
    return this.vital !== 'blood_pressure';
  }

  addVisitDiagnosis(): void {
    this.visitDiagnoses.push({
      system: this.visitTerminology.diagnosis.systems[0].system, code: '', display: '', expected_end_date: '',
    });
  }

  removeVisitDiagnosis(index: number): void {
    this.visitDiagnoses.splice(index, 1);
  }

  selectVisitDiagnosis(diagnosis: typeof this.visitDiagnoses[number], suggestion: IcdSuggestion): void {
    diagnosis.code = suggestion.code;
    diagnosis.display = suggestion.display;
    diagnosis.selectedFromCatalog = true;
  }

  clearVisitDiagnosisSelection(diagnosis: typeof this.visitDiagnoses[number]): void {
    diagnosis.code = '';
    diagnosis.display = '';
    diagnosis.selectedFromCatalog = false;
  }

  formatVisitNote(editor: HTMLTextAreaElement, prefix: string, suffix = '', placeholder = 'text', entry?: {note: string}): void {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = entry ? entry.note : this.visitNote;
    const selection = text.slice(start, end) || placeholder;
    const formatted = text.slice(0, start) + prefix + selection + suffix + text.slice(end);
    if (entry) entry.note = formatted;
    else this.visitNote = formatted;
    editor.value = formatted;
    editor.focus();
    editor.setSelectionRange(start + prefix.length, start + prefix.length + selection.length);
  }

  get isVital(): boolean {
    return this.kind === 'vital';
  }

  get namingNewDevice(): boolean {
    return this.deviceId === '__new';
  }

  get nameLabel(): string {
    if (this.kind === 'allergy') return 'What are you allergic to?';
    if (this.kind === 'visit') return 'Reason for visit';
    if (this.kind === 'implant') return 'What implant or device is it?';
    if (this.kind === 'medication') return 'Which medication?';
    return 'Which medication?';
  }

  get namePlaceholder(): string {
    if (this.kind === 'allergy') return 'Penicillin';
    if (this.kind === 'visit') return 'Annual checkup';
    if (this.kind === 'implant') return 'Coronary artery stent';
    return 'Medication name';
  }

  private directoryOptions(rows: ResourceFhir[], resourceType: 'Practitioner' | 'Organization'): {id: string; name: string}[] {
    return rows.map((row) => {
      const raw = (row.resource_raw ?? {}) as Record<string, unknown>;
      const rawId = typeof raw['id'] === 'string' ? raw['id'] : row.source_resource_id;
      let name = '';
      if (resourceType === 'Organization') {
        name = typeof raw['name'] === 'string' ? raw['name'] : '';
      } else {
        const names = Array.isArray(raw['name']) ? raw['name'] as Record<string, unknown>[] : [];
        const official = names.find((candidate) => candidate['use'] === 'official') ?? names[0];
        const given = Array.isArray(official?.['given']) ? (official['given'] as unknown[]).filter((part) => typeof part === 'string').join(' ') : '';
        const family = typeof official?.['family'] === 'string' ? official['family'] : '';
        name = typeof official?.['text'] === 'string' ? official['text'] : [given, family].filter(Boolean).join(' ');
      }
      return {id: rawId, name: name || 'Unnamed'};
    }).filter((option) => option.id !== '').sort((left, right) => left.name.localeCompare(right.name));
  }

  get defaultUnitHint(): string {
    switch (this.vital) {
      case 'body_weight': return 'kg (or set lb via unit)';
      case 'heart_rate': return '/min';
      case 'body_temperature': return 'Cel (or [degF])';
      case 'oxygen_saturation': return '%';
      case 'blood_pressure': return 'mmHg';
      default: return '';
    }
  }

  submit(): void {
    this.error = '';
    this.successMsg = '';
    this.needsReview = [];
    this.saving = true;

    const payload: Parameters<FastenApiService['createPatientEntry']>[0] = {
      kind: this.kind,
      effective_date_time: this.effectiveDate || undefined,
    };

    if (this.kind !== 'vital') {
      // An allergy or a medication is one stated thing. Nothing about it is coded yet and nothing
      // about it is guessed: what they typed is what is stored (#763).
      if (!this.name.trim()) {
        this.saving = false;
        this.error = this.kind === 'allergy'
          ? 'Name what you are allergic to.'
          : this.kind === 'implant' ? 'Name the implant.' : this.kind === 'visit' ? 'Name what the visit was for.' : 'Name the medication.';
        return;
      }
      payload.name = this.name.trim();
      if (this.kind === 'visit') {
        if (!this.visitType.trim()) {
          this.saving = false;
          this.error = 'Enter the visit type.';
          return;
        }
        if (!this.visitClass) {
          this.saving = false;
          this.error = 'Choose a visit setting.';
          return;
        }
        payload.visit_type = this.visitType.trim();
        payload.visit_type_code = this.visitTypeCode || undefined;
        if (this.additionalVisitReasons.some((reason) => !reason.text.trim())) {
          this.saving = false;
          this.error = 'Enter text for every visit reason, or remove the empty row.';
          return;
        }
        payload.visit_reasons = [
          {text: this.name.trim(), code: this.visitReasonCode || undefined, primary: this.primaryVisitReason === 0},
          ...this.additionalVisitReasons.map((reason, index) => ({
            text: reason.text.trim(), code: reason.code || undefined, primary: this.primaryVisitReason === index + 1,
          })),
        ];
        for (const observation of this.visitObservations) {
          const option = this.visitTerminology.observations.options.find((item) => item.key === observation.kind);
          if (!option || (observation.kind === 'lnmp' ? !observation.date
            : observation.kind === 'blood_pressure' ? observation.systolic === null && observation.diastolic === null
              : observation.value === null)) {
            this.saving = false;
            this.error = 'Enter a value for every visit measurement, or remove the empty row.';
            return;
          }
          if (typeof option.max === 'number' && (observation.value === null || !Number.isInteger(observation.value)
            || observation.value < 0 || observation.value > option.max)) {
            this.saving = false;
            this.error = `Enter a whole-number ${option.label} from 0 to ${option.max}.`;
            return;
          }
        }
        payload.visit_observations = this.visitObservations.length ? this.visitObservations.map((observation) => ({
          kind: observation.kind,
          value: observation.value ?? undefined,
          systolic: observation.systolic ?? undefined,
          diastolic: observation.diastolic ?? undefined,
          unit: observation.unit || undefined,
          date: observation.date || undefined,
          measured_at: observation.measured_at || undefined,
          note: observation.note.trim() || undefined,
        })) : undefined;
        if (this.visitLabs.some(lab => !lab.code.trim() || !lab.display.trim()
          || (lab.result_type === 'quantity' ? lab.numericValue === null : !lab.text?.trim()))) {
          this.saving = false;
          this.error = 'Enter a LOINC code, test name and result for every lab, or remove the empty row.';
          return;
        }
        if (this.visitLabs.some(lab => lab.reportDate && (
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(lab.reportDate)
          || !Number.isFinite(Date.parse(lab.reportDate))
          || new Date(lab.reportDate.slice(0, 10)).toISOString().slice(0, 10) !== lab.reportDate.slice(0, 10)))) {
          this.saving = false;
          this.error = 'Enter a valid lab report timestamp.';
          return;
        }
        if (this.visitNoteAuthors.some(author => !author.name.trim() || !author.provider_id)
          || ((this.visitNoteAuthors.length || this.visitNoteAuthored) && !this.visitNote.trim())) {
          this.saving = false;
          this.error = 'Enter the note and choose a provider for every attributed author.';
          return;
        }
        payload.visit_labs = this.visitLabs.length ? this.visitLabs.map(lab => ({
          code: lab.code.trim(), display: lab.display.trim(), result_type: lab.result_type,
          value: lab.result_type === 'quantity' ? lab.numericValue ?? undefined : undefined,
          text: lab.result_type === 'text' ? lab.text?.trim() : undefined,
          unit: lab.unit?.trim() || undefined, ucum_code: lab.ucum_code?.trim() || undefined,
          comparator: lab.comparator || undefined, status: lab.status,
          collected: lab.collected || undefined,
          issued: lab.reportDate ? new Date(lab.reportDate).toISOString() : undefined,
          reference_range: lab.reference_range?.trim() || undefined, specimen: lab.specimen?.trim() || undefined,
          laboratory: lab.laboratory?.trim() || undefined, note: lab.note?.trim() || undefined,
        })) : undefined;
        payload.visit_note_authors = this.visitNoteAuthors.length
          ? this.visitNoteAuthors.map(author => ({name: author.name.trim(), provider_id: author.provider_id})) : undefined;
        payload.visit_note_authored = this.visitNoteAuthored || undefined;
        if (this.additionalVisitNotes.some(note => !note.note.trim() || note.authors.some(author => !author.provider_id))) {
          this.saving = false;
          this.error = 'Enter each additional note and choose its providers.';
          return;
        }
        payload.visit_notes = this.additionalVisitNotes.length ? this.additionalVisitNotes.map(note => ({
          note: note.note.trim(), note_format: 'markdown', authored: note.authored || undefined,
          authors: note.authors.map(author => ({name: author.name, provider_id: author.provider_id})),
        })) : undefined;
        payload.visit_class = this.visitClass;
        payload.visit_status = this.visitStatus;
        payload.visit_identifier = this.visitIdentifier.trim() || undefined;
        try {
          payload.effective_date_time = this.visitTimestamp(this.effectiveDate, this.visitStartTime, 'visit start');
          payload.visit_end_date_time = this.visitTimestamp(this.visitEndDate, this.visitEndTime, 'visit end');
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          this.saving = false;
          this.error = error.message;
          return;
        }
        payload.visit_billing = this.visitBilling.length ? this.visitBilling.map(entry => ({
          kind: entry.kind, code: entry.code.trim(), description: entry.description.trim() || undefined,
        })) : undefined;
        payload.visit_location = this.visitLocation.trim() || undefined;
        payload.visit_location_code = this.visitLocationCode || undefined;
        payload.visit_disposition = this.visitDisposition.trim() || undefined;
        payload.visit_disposition_code = this.visitDispositionCode || undefined;
        payload.visit_diagnosis_ids = this.visitDiagnosisIds.length ? [...this.visitDiagnosisIds] : undefined;
        const diagnoses = [
          ...this.visitDiagnosisIds.filter((id) => this.visitDiagnosisEndDates[id]).map((id) => ({
            condition_id: id, expected_end_date: this.visitDiagnosisEndDates[id],
          })),
          ...this.visitDiagnoses.map((diagnosis) => ({
            system: diagnosis.system,
            code: diagnosis.code.trim(),
            display: diagnosis.display.trim() || undefined,
            expected_end_date: diagnosis.expected_end_date || undefined,
          })),
        ];
        payload.visit_diagnoses = diagnoses.length ? diagnoses : undefined;
        payload.provider_id = this.providerId || undefined;
        payload.provider_name = this.practitioners.find((provider) => provider.id === this.providerId)?.name;
        payload.organization_id = this.organizationId || undefined;
        payload.organization_name = this.organizations.find((organization) => organization.id === this.organizationId)?.name;
        payload.note = this.visitNote.trim() || undefined;
        payload.note_format = 'markdown';
      }
      if (this.kind === 'implant') {
        payload.implant_status = this.implantStatus;
        payload.implant_device_identifier = this.implantDeviceIdentifier.trim() || undefined;
        payload.implant_distinct_identifier = this.implantDistinctIdentifier.trim() || undefined;
        payload.implant_serial_number = this.implantSerialNumber.trim() || undefined;
        payload.implant_lot_number = this.implantLotNumber.trim() || undefined;
        payload.implant_manufacture_date = this.implantManufactureDate || undefined;
        payload.implant_expiration_date = this.implantExpirationDate || undefined;
      }
      if (this.kind === 'medication' && this.medicationStatus) {
        payload.status = this.medicationStatus;
      }
      this.send(payload);
      return;
    }

    payload.vital = this.vital;
    if (this.unit.trim()) {
      payload.unit = this.unit.trim();
    }
    // Only when they said so. No device is the honest answer for a reading they did not measure
    // with one, and nothing here guesses from the vital or the unit (#764).
    if (this.namingNewDevice && this.newDeviceName.trim()) {
      payload.device_name = this.newDeviceName.trim();
    } else if (this.deviceId && !this.namingNewDevice) {
      payload.device = this.deviceId;
    }
    if (this.vital === 'blood_pressure') {
      // Half a reading is still a fact (#696): the server keeps what was measured and asks you to
      // confirm it, rather than refusing the whole entry. Only an empty form is refused.
      if (this.systolic == null && this.diastolic == null) {
        this.saving = false;
        this.error = 'Enter a blood pressure reading.';
        return;
      }
      if (this.systolic != null) payload.systolic = Number(this.systolic);
      if (this.diastolic != null) payload.diastolic = Number(this.diastolic);
    } else {
      if (this.value == null || isNaN(Number(this.value))) {
        this.saving = false;
        this.error = 'Enter a numeric value.';
        return;
      }
      payload.value = Number(this.value);
    }

    this.send(payload);
  }

  private send(payload: Parameters<FastenApiService['createPatientEntry']>[0]): void {
    this.api.createPatientEntry(payload).subscribe({
      next: (data) => {
        this.saving = false;
        this.lastSourceId = data.source_id;
        this.lastResourceId = data.source_resource_id;
        this.lastResourceType = data.resource_type || 'Observation';
        // What was kept but still needs the person: they are told here AND it waits for them on
        // the review screen, rather than being announced once and forgotten (#762).
        this.needsReview = data.needs_review ?? [];
        this.successMsg = this.needsReview.length
          ? `Kept: ${data.sort_title}. It is not part of your records yet — see why below.`
          : `Saved: ${data.sort_title}. Stored as patient-reported on your YourPHR records.`;
        this.value = null;
        this.systolic = null;
        this.diastolic = null;
        this.name = '';
        if (payload.kind === 'visit') {
          this.additionalVisitReasons = [];
          this.visitReasonCode = '';
          this.primaryVisitReason = -1;
          this.visitObservations = [];
          this.visitLabs = [];
          this.visitNoteAuthors = [];
          this.visitNoteAuthored = '';
          this.additionalVisitNotes = [];
          this.visitNote = '';
          this.visitBilling = [];
          this.visitStartTime = '';
          this.visitEndTime = '';
          this.visitDiagnoses = [];
          this.visitDiagnosisIds = [];
          this.visitDiagnosisEndDates = {};
        }
        // A device named here is one they can pick next time, so the list is refreshed rather than
        // left a request behind.
        if (payload.device_name) {
          this.newDeviceName = '';
          this.deviceId = '';
          this.api.getOwnDevices().subscribe({next: (devices) => this.devices = devices, error: () => {}});
        }
      },
      error: (err) => {
        this.saving = false;
        this.error = extractErrorFromResponse(err) || 'Could not save this record.';
      },
    });
  }

  viewInExplore(): void {
    if (this.lastSourceId && this.lastResourceId) {
      // The type the server actually stored it as — an allergy is not an Observation (#763).
      this.router.navigate(['/explore', this.lastSourceId, 'resource', this.lastResourceType, this.lastResourceId]);
    }
  }
}
