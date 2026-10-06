import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of, throwError} from 'rxjs';
import {By} from '@angular/platform-browser';
import {NgbModal, NgbModalConfig, NgbTooltip} from '@ng-bootstrap/ng-bootstrap';

import {PatientEntryComponent} from './patient-entry.component';
import {FastenApiService} from '../../services/fasten-api.service';
import {ResourceFhir} from '../../models/fasten/resource_fhir';
import {IcdCatalogService} from '../../services/icd-catalog.service';

describe('PatientEntryComponent', () => {
  let component: PatientEntryComponent;
  let fixture: ComponentFixture<PatientEntryComponent>;
  let api: jasmine.SpyObj<FastenApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('FastenApiService', ['createPatientEntry', 'getOwnDevices', 'getResources', 'getSources']);
    api.getOwnDevices.and.returnValue(of([{id: 'cuff-1', name: 'Omron cuff'}]));
    api.getResources.and.callFake((type, sourceId) => of(type === 'Condition' && sourceId === 'source-manual'
      ? [{
        source_id: 'source-manual',
        source_resource_type: 'Condition',
        source_resource_id: 'condition-1',
        sort_title: 'Hypertension',
      } as ResourceFhir]
      : []));
    api.getSources.and.returnValue(of([{id: 'source-manual', platform_type: 'manual'} as any]));
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'Observation',
      source_resource_id: 'obs-1',
      source_id: 'src-1',
      sort_title: 'Body weight 70 kg',
    }));

    await TestBed.configureTestingModule({
      imports: [PatientEntryComponent, RouterTestingModule],
      providers: [
        {provide: FastenApiService, useValue: api},
        {provide: IcdCatalogService, useValue: {search: () => of([])}},
      ],
    }).compileComponents();

    TestBed.inject(NgbModalConfig).animation = false;
    fixture = TestBed.createComponent(PatientEntryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.inject(NgbModal).dismissAll());

  it('groups optional clinical summaries and keeps populated metadata expanded', async () => {
    component.kind = 'visit';
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    expect(form.querySelectorAll('.visit-clinical-grid > .visit-summary').length).toBe(5);
    const details = form.querySelector<HTMLDetailsElement>('.visit-details')!;
    expect(details.open).toBeFalse();
    expect(form.querySelector('#visit-location')).not.toBeNull();
    component.visitLocation = 'Synthetic location';
    fixture.detectChanges();
    expect(details.open).toBeTrue();
    expect(form.querySelectorAll('.visit-summary-actions').length).toBeGreaterThan(0);
  });

  it('restores reason text, coding and primary assignment when the reasons modal is dismissed', async () => {
    component.kind = 'visit';
    component.name = 'Original complaint';
    component.additionalVisitReasons = [{text: 'Second complaint', code: ''}];
    component.primaryVisitReason = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#entry-name')).toBeNull();
    fixture.nativeElement.querySelector('#edit-visit-reasons').click();
    fixture.detectChanges();
    component.name = 'Changed complaint';
    component.visitReasonCode = '25064002';
    component.removeVisitReason(0);
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.name).toBe('Original complaint');
    expect(component.visitReasonCode).toBe('');
    expect(component.additionalVisitReasons).toEqual([{text: 'Second complaint', code: ''}]);
    expect(component.primaryVisitReason).toBe(1);
  });

  it('restores the first note and billing rows on dismissal', async () => {
    component.kind = 'visit';
    component.visitNote = 'Original note';
    component.visitBilling = [{kind: 'revenue', code: '0999', description: 'Synthetic'}];
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent.trim() === 'Edit visit note')!.click();
    component.visitNote = 'Changed note';
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.visitNote).toBe('Original note');
    Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent.trim() === 'Edit billing codes')!.click();
    component.visitBilling[0].code = '9999';
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.visitBilling[0].code).toBe('0999');
  });

  it('preserves detailed complaint wording when optional terminology is selected or cleared', () => {
    component.name = 'Synthetic headache, onset and duration as documented';
    component.selectVisitReason('25064002');
    expect(component.name).toBe('Synthetic headache, onset and duration as documented');
    component.selectVisitReason('');
    expect(component.name).toBe('Synthetic headache, onset and duration as documented');
    component.additionalVisitReasons = [{text: '', code: '25064002'}];
    component.selectVisitReason('25064002', 0);
    expect(component.additionalVisitReasons[0].text).toBe('Headache');
  });

  it('restores linked and catalog-selected diagnoses and their dates on modal dismissal', async () => {
    component.kind = 'visit';
    component.visitDiagnosisIds = ['condition-1'];
    component.visitDiagnosisEndDates = {'condition-1': '2020-05-01'};
    component.addVisitDiagnosis();
    component.selectVisitDiagnosis(component.visitDiagnoses[0], {code: 'J06.9', display: 'Synthetic diagnosis'});
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#edit-visit-diagnoses').click();
    component.visitDiagnosisIds = [];
    component.visitDiagnosisEndDates['condition-1'] = '2020-06-01';
    component.clearVisitDiagnosisSelection(component.visitDiagnoses[0]);
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.visitDiagnosisIds).toEqual(['condition-1']);
    expect(component.visitDiagnosisEndDates['condition-1']).toBe('2020-05-01');
    expect(component.visitDiagnoses[0].code).toBe('J06.9');
    expect(component.visitDiagnoses[0].selectedFromCatalog).toBeTrue();
  });

  it('submits optional local visit times without inventing times for date-only entries', () => {
    component.kind = 'visit';
    component.name = 'Synthetic';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.effectiveDate = '2020-04-20';
    component.visitEndDate = '2020-04-20';
    component.visitStartTime = '09:30';
    component.visitEndTime = '10:15';
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Failed'}})));
    component.submit();
    expect(api.createPatientEntry.calls.mostRecent().args[0].effective_date_time).toBe(new Date('2020-04-20T09:30').toISOString());
    expect(api.createPatientEntry.calls.mostRecent().args[0].visit_end_date_time).toBe(new Date('2020-04-20T10:15').toISOString());
    component.visitStartTime = '';
    component.visitEndTime = '';
    component.submit();
    expect(api.createPatientEntry.calls.mostRecent().args[0].effective_date_time).toBe('2020-04-20');
    api.createPatientEntry.calls.reset();
    component.visitEndDate = '';
    component.visitEndTime = '10:15';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('visit end date and time');
  });

  it('keeps detailed editors out of the main page and restores lab drafts on Cancel', async () => {
    component.kind = 'visit';
    component.addVisitLab();
    component.visitLabs[0].selection = '2345-7';
    component.selectVisitLab(0);
    component.visitLabs[0].numericValue = 0;
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    expect(form.querySelector('#visit-lab-value-0')).toBeNull();
    expect(form.querySelector('#visit-observation-kind-0')).toBeNull();
    expect(form.querySelector('#visit-note-author-0')).toBeNull();
    expect(form.textContent).toContain('0');
    Array.from(form.querySelectorAll('button')).find(button => button.textContent.trim() === 'Edit lab results')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = document.querySelector<HTMLInputElement>('#visit-lab-value-0')!;
    expect(input).not.toBeNull();
    input.value = '12';
    input.dispatchEvent(new Event('input'));
    component.addVisitLab();
    fixture.detectChanges();
    expect(component.visitLabs[0].numericValue).toBe(12);
    Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-footer button')).find(button => button.textContent.trim() === 'Cancel')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.visitLabs.length).toBe(1);
    expect(component.visitLabs[0].numericValue).toBe(0);
    expect(api.createPatientEntry).not.toHaveBeenCalled();
  });

  it('dismisses measurement and author changes without touching the note or other visit draft fields', async () => {
    component.kind = 'visit';
    component.visitNote = 'Keep my note';
    component.visitNoteAuthors = [{name: 'Synthetic author'}];
    component.visitNoteAuthored = '2020-04-20';
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    Array.from(form.querySelectorAll('button')).find(button => button.textContent.trim() === 'Add visit measurement')!.click();
    fixture.detectChanges();
    expect(component.visitObservations.length).toBe(1);
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.visitObservations).toEqual([]);
    expect(Array.from(form.querySelectorAll('button')).some(button => button.textContent.trim() === 'Edit note attribution')).toBeFalse();
    Array.from(form.querySelectorAll('button')).find(button => button.textContent.trim() === 'Edit visit note')!.click();
    fixture.detectChanges();
    expect(document.querySelector('#visit-note-author-0')!.closest('[role="dialog"]')).not.toBeNull();
    component.visitNote = 'Changed note';
    component.visitNoteAuthors[0].name = 'Changed';
    component.visitNoteAuthored = '2020-04-25';
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.visitNoteAuthors).toEqual([{name: 'Synthetic author'}]);
    expect(component.visitNoteAuthored).toBe('2020-04-20');
    expect(component.visitNote).toBe('Keep my note');
  });

  it('validates Done, preserves zero values in summaries and allows partial blood pressure', () => {
    const close = jasmine.createSpy('close');
    component.addVisitObservation();
    component.finishVisitEditor('measurements', close);
    expect(close).not.toHaveBeenCalled();
    expect(component.dialogError).toBeTruthy();
    component.visitObservations[0].kind = 'phq2';
    component.changeVisitObservation(component.visitObservations[0]);
    component.visitObservations[0].value = 0;
    component.finishVisitEditor('measurements', close);
    expect(close).toHaveBeenCalled();
    expect(component.measurementSummary(component.visitObservations[0])).toContain('0');
    close.calls.reset();
    component.visitObservations[0].kind = 'blood_pressure';
    component.changeVisitObservation(component.visitObservations[0]);
    component.visitObservations[0].systolic = 122;
    component.finishVisitEditor('measurements', close);
    expect(close).toHaveBeenCalled();
    expect(component.measurementSummary(component.visitObservations[0])).toContain('Not entered');
    component.addVisitLab();
    close.calls.reset();
    component.finishVisitEditor('labs', close);
    expect(close).not.toHaveBeenCalled();
    expect(component.dialogError).toContain('LOINC');
  });

  it('validates note content and attribution together before accepting the draft', () => {
    const close = jasmine.createSpy('close');
    component.visitNoteAuthored = '2020-04-20';
    component.finishVisitEditor('note', close);
    expect(close).not.toHaveBeenCalled();
    expect(component.dialogError).toContain('note content');
    component.visitNote = 'Synthetic note';
    component.visitNoteAuthors = [{name: ''}];
    component.finishVisitEditor('note', close);
    expect(close).not.toHaveBeenCalled();
    expect(component.dialogError).toContain('Choose a provider');
    component.visitNoteAuthors = [{name: 'Synthetic provider', provider_id: 'synthetic-provider'}];
    component.finishVisitEditor('note', close);
    expect(close).toHaveBeenCalled();
  });

  it('creates and submits a weight vital', () => {
    component.vital = 'body_weight';
    component.value = 70;
    component.submit();
    expect(api.createPatientEntry).toHaveBeenCalled();
    const arg = api.createPatientEntry.calls.mostRecent().args[0];
    expect(arg.vital).toBe('body_weight');
    expect(arg.value).toBe(70);
    expect(component.successMsg).toContain('Body weight');
  });

  it('submits numeric and qualitative labs and explicit note authors, preserving them on failure', () => {
    component.kind = 'visit';
    component.name = 'Synthetic lab visit';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.visitNote = '**Synthetic note**';
    component.visitNoteAuthors = [{name: 'Synthetic Author, MD', provider_id: 'synthetic-author'}, {name: 'Synthetic Contributor, RN', provider_id: 'synthetic-contributor'}];
    component.visitNoteAuthored = '2020-04-20';
    component.addVisitLab();
    component.visitLabs[0].selection = '2345-7';
    component.selectVisitLab(0);
    component.visitLabs[0].numericValue = 0;
    component.visitLabs[0].unit = 'mg/dL';
    component.visitLabs[0].collected = '2020-04-21';
    component.visitLabs[0].reportDate = '2020-04-23T12:30:00';
    component.addVisitLab();
    component.visitLabs[1].code = '2160-0';
    component.visitLabs[1].display = 'Synthetic test';
    component.visitLabs[1].result_type = 'text';
    component.visitLabs[1].text = 'Not detected';
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Failed'}})));
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_labs?.[0]).toEqual(jasmine.objectContaining({
      code: '2345-7', value: 0, unit: 'mg/dL', collected: '2020-04-21',
      issued: new Date('2020-04-23T12:30:00').toISOString(), status: 'unknown',
    }));
    expect(payload.visit_labs?.[1]).toEqual(jasmine.objectContaining({result_type: 'text', text: 'Not detected', value: undefined}));
    expect(payload.visit_note_authors).toEqual(component.visitNoteAuthors);
    expect(payload.visit_note_authored).toBe('2020-04-20');
    expect(component.visitLabs.length).toBe(2);
    expect(component.visitNoteAuthors.length).toBe(2);
    api.createPatientEntry.and.returnValue(of({resource_type: 'Encounter', source_id: 'manual', source_resource_id: 'visit', sort_title: 'Synthetic'}));
    component.submit();
    expect(component.visitLabs).toEqual([]);
    expect(component.visitNoteAuthors).toEqual([]);
    expect(component.visitNoteAuthored).toBe('');
  });

  it('refuses incomplete labs and orphan note attribution, and clears numeric fields on qualitative selection', () => {
    component.kind = 'visit';
    component.name = 'Synthetic';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.addVisitLab();
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('LOINC code');
    const lab = component.visitLabs[0];
    lab.numericValue = 5;
    lab.unit = 'mg/dL';
    lab.ucum_code = 'mg/dL';
    lab.comparator = '<';
    lab.result_type = 'text';
    component.changeVisitLabResult(0);
    expect(lab.numericValue).toBeNull();
    expect(lab.unit).toBeUndefined();
    expect(lab.ucum_code).toBeUndefined();
    expect(lab.comparator).toBeUndefined();
    component.visitLabs = [];
    component.visitNoteAuthors = [{name: 'Synthetic author'}];
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('Enter the note');
  });

  it('refuses impossible local report dates instead of normalizing them before the API sees them', () => {
    component.kind = 'visit';
    component.name = 'Synthetic';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.addVisitLab();
    const lab = component.visitLabs[0];
    lab.selection = '2345-7';
    component.selectVisitLab(0);
    lab.numericValue = 5;
    lab.reportDate = '2020-02-30T12:30';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('valid lab report timestamp');
  });

  it('sources note authors from providers and submits independent additional notes', () => {
    component.kind = 'visit';
    component.name = 'Synthetic';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.visitNote = 'First note';
    component.practitioners = [{id: 'provider-one', name: 'Provider One'}, {id: 'provider-two', name: 'Provider Two'}];
    component.visitNoteAuthors = [{provider_id: 'provider-one', name: ''}];
    component.selectNoteAuthor(component.visitNoteAuthors[0]);
    const second = {note: '**Second note**', authored: '2020-04-22', authors: [{provider_id: 'provider-two', name: ''}]};
    component.selectNoteAuthor(second.authors[0]);
    component.additionalVisitNotes = [second];
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Failed'}})));
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_note_authors).toEqual([{provider_id: 'provider-one', name: 'Provider One'}]);
    expect(payload.visit_notes).toEqual([{note: '**Second note**', authored: '2020-04-22', note_format: 'markdown',
      authors: [{provider_id: 'provider-two', name: 'Provider Two'}]}]);
    expect(component.additionalVisitNotes.length).toBe(1);
    expect(component.visitNote).toBe('First note');
    api.createPatientEntry.and.returnValue(of({resource_type: 'Encounter', source_id: 'manual', source_resource_id: 'visit', sort_title: 'Synthetic'}));
    component.submit();
    expect(component.additionalVisitNotes).toEqual([]);
    expect(component.visitNote).toBe('');
  });

  it('formats an additional note without changing the first note', () => {
    component.visitNote = 'Keep first note';
    const note = {note: 'Second'};
    const editor = document.createElement('textarea');
    editor.value = note.note;
    editor.setSelectionRange(0, 6);
    component.formatVisitNote(editor, '**', '**', 'text', note);
    expect(note.note).toBe('**Second**');
    expect(component.visitNote).toBe('Keep first note');
  });

  it('rolls back additional notes and nested provider authors when their modal is canceled', async () => {
    component.kind = 'visit';
    component.additionalVisitNotes = [{note: 'Keep note', authored: '2020-04-20', authors: [{name: 'Provider One', provider_id: 'one'}]}];
    fixture.detectChanges();
    await fixture.whenStable();
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    buttons.find(button => button.textContent.trim() === 'Edit additional notes')!.click();
    component.additionalVisitNotes[0].authors[0].name = 'Changed';
    component.additionalVisitNotes[0].note = 'Changed';
    component.additionalVisitNotes.push({note: 'New', authors: [], authored: ''});
    TestBed.inject(NgbModal).dismissAll();
    await fixture.whenStable();
    expect(component.additionalVisitNotes).toEqual([{note: 'Keep note', authored: '2020-04-20', authors: [{name: 'Provider One', provider_id: 'one'}]}]);
  });

  it('reports provider load errors and refreshes the directory without losing visit drafts', () => {
    component.visitNote = 'Keep this draft';
    component.additionalVisitNotes = [{note: 'Another draft', authored: '', authors: []}];
    api.getResources.and.returnValue(throwError(() => new Error('Unavailable')));
    component.loadProviders();
    expect(component.providerLoadError).toContain('Could not load providers');
    expect(component.practitioners).toEqual([]);
    const practitioner = {resourceType: 'Practitioner', name: [{text: 'Synthetic Provider'}]};
    api.getResources.and.returnValue(of([{source_id: 'source-manual', fhir_version: '4.0.1', sort_date: null,
      resource_raw: practitioner, source_resource_type: 'Practitioner',
      source_resource_id: 'synthetic-provider', sort_title: 'Synthetic Provider'}]));
    component.loadProviders();
    expect(component.providerLoadError).toBe('');
    expect(component.practitioners).toEqual([{id: 'synthetic-provider', name: 'Synthetic Provider'}]);
    expect(component.visitNote).toBe('Keep this draft');
    expect(component.additionalVisitNotes[0].note).toBe('Another draft');
  });

  // yourphr#696: half a reading is a fact. The form no longer refuses it — the server keeps what
  // was measured and asks the person to confirm it. Only an empty reading is refused.
  it('sends half a blood pressure rather than refusing it, and says what is waiting', () => {
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'Observation', source_resource_id: 'o-1', source_id: 'source-1',
      sort_title: 'Blood pressure 128 systolic mmHg',
      needs_review: ['only the systolic half of this blood pressure was given'],
    }));
    component.vital = 'blood_pressure';
    component.systolic = 128;
    component.diastolic = null;
    component.submit();
    expect(api.createPatientEntry).toHaveBeenCalled();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['systolic']).toBe(128);
    expect(arg['diastolic']).toBeUndefined(); // nothing invented for the half that was not given
    expect(component.needsReview).toEqual(['only the systolic half of this blood pressure was given']);
    expect(component.successMsg).toContain('not part of your records yet');
  });

  it('refuses only an empty blood pressure — nothing to record', () => {
    component.vital = 'blood_pressure';
    component.systolic = null;
    component.diastolic = null;
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('blood pressure reading');
  });

  // yourphr#763: the form offers the kinds the server can store in a record type of their own.
  it('sends an allergy as an allergy, with the substance in the person\'s words', () => {
    api.createPatientEntry.and.returnValue(of({
      resource_type: 'AllergyIntolerance', source_resource_id: 'a-1', source_id: 'source-1',
      sort_title: 'Allergy to penicillin',
      needs_review: ['"penicillin" is stored exactly as you wrote it — nothing has matched it to a known substance yet'],
    }));
    component.kind = 'allergy';
    component.name = ' penicillin ';
    component.submit();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('allergy');
    expect(arg['name']).toBe('penicillin');
    expect(arg['vital']).toBeUndefined(); // an allergy is not a measurement
    expect(component.successMsg).toContain('Allergy to penicillin');
    expect(component.lastResourceType).toBe('AllergyIntolerance');
  });

  it('sends a medication, and says nothing about whether it is taken unless the person did', () => {
    component.kind = 'medication';
    component.name = 'metformin 500mg';
    component.submit();
    let arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('medication');
    expect(arg['status']).toBeUndefined(); // they did not say; the server records that, not a guess

    component.medicationStatus = 'active';
    component.name = 'metformin 500mg';
    component.submit();
    arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['status']).toBe('active');
  });

  it('sends an implant as its own FHIR record with the identifiers the patient entered', () => {
    component.kind = 'implant';
    component.name = 'Coronary artery stent';
    component.implantStatus = 'active';
    component.implantDeviceIdentifier = '00844588003288';
    component.implantSerialNumber = 'SN456';
    component.submit();

    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('implant');
    expect(arg['name']).toBe('Coronary artery stent');
    expect(arg['implant_status']).toBe('active');
    expect(arg['implant_device_identifier']).toBe('00844588003288');
    expect(arg['implant_serial_number']).toBe('SN456');
    expect(arg['vital']).toBeUndefined();
  });

  it('sends a manually entered visit with the selected setting, provider, and facility', () => {
    component.kind = 'visit';
    component.name = 'Cardiology follow-up';
    component.visitType = 'Outpatient visit';
    component.visitClass = 'AMB';
    component.visitStatus = 'finished';
    component.visitIdentifier = ' VISIT-42 ';
    component.visitEndDate = '2026-09-20';
    component.visitLocation = 'Cardiology clinic';
    component.visitLocationCode = '33022008';
    component.visitDisposition = 'Discharged home';
    component.visitDispositionCode = '306689006';
    component.visitDiagnosisIds = ['condition-1'];
    component.providerId = 'practitioner-123';
    component.organizationId = 'org-4';
    component.visitNote = 'Annual follow-up';
    component.practitioners = [{id: 'practitioner-123', name: 'Dr. Patel'}];
    component.organizations = [{id: 'org-4', name: 'Heart Clinic'}];
    component.submit();

    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['kind']).toBe('visit');
    expect(arg['name']).toBe('Cardiology follow-up');
    expect(arg['visit_type']).toBe('Outpatient visit');
    expect(arg['visit_class']).toBe('AMB');
    expect(arg['visit_status']).toBe('finished');
    expect(arg['visit_identifier']).toBe('VISIT-42');
    expect(arg['visit_end_date_time']).toBe('2026-09-20');
    expect(arg['visit_location']).toBe('Cardiology clinic');
    expect(arg['visit_location_code']).toBe('33022008');
    expect(arg['visit_disposition']).toBe('Discharged home');
    expect(arg['visit_disposition_code']).toBe('306689006');
    expect(arg['visit_diagnosis_ids']).toEqual(['condition-1']);
    expect(arg['provider_id']).toBe('practitioner-123');
    expect(arg['provider_name']).toBe('Dr. Patel');
    expect(arg['organization_id']).toBe('org-4');
    expect(arg['organization_name']).toBe('Heart Clinic');
    expect(arg['note']).toBe('Annual follow-up');
    expect(arg['note_format']).toBe('markdown');
  });

  it('submits reasons with only the chosen primary and preserves them on save failure', () => {
    component.kind = 'visit';
    component.name = 'Review results';
    component.visitTypeCode = '185389009';
    component.selectVisitType(component.visitTypeCode);
    component.visitClass = 'AMB';
    component.additionalVisitReasons = [{text: 'My head hurts', code: '25064002'}, {text: 'Sleep concerns', code: ''}];
    component.primaryVisitReason = 1;
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Failed'}})));
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_type_code).toBe('185389009');
    expect(payload.visit_type).toBe('Follow-up consultation');
    expect(payload.visit_reasons).toEqual([
      {text: 'Review results', code: undefined, primary: false},
      {text: 'My head hurts', code: '25064002', primary: true},
      {text: 'Sleep concerns', code: undefined, primary: false},
    ]);
    expect(component.additionalVisitReasons.length).toBe(2);
    expect(component.primaryVisitReason).toBe(1);
    component.removeVisitReason(0);
    expect(component.primaryVisitReason).toBe(-1);
  });

  it('rejects empty additional reasons and keeps primary identity when removing another row', () => {
    component.kind = 'visit';
    component.name = 'Review';
    component.visitType = 'Office';
    component.visitClass = 'AMB';
    component.additionalVisitReasons = [{text: '', code: ''}, {text: 'Pain', code: '22253000'}];
    component.primaryVisitReason = 2;
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('every visit reason');
    component.removeVisitReason(0);
    expect(component.primaryVisitReason).toBe(1);
    component.submit();
    expect(api.createPatientEntry.calls.mostRecent().args[0].visit_reasons?.[1]?.primary).toBeTrue();
    expect(component.additionalVisitReasons).toEqual([]);
    expect(component.primaryVisitReason).toBe(-1);
  });

  it('retains zero PHQ scores and LNMP dates on save failure, then clears measurements only on success', () => {
    component.kind = 'visit';
    component.name = 'Synthetic screening';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    component.addVisitObservation();
    const score = component.visitObservations[0];
    score.kind = 'phq2';
    component.changeVisitObservation(score);
    score.value = 0;
    component.addVisitObservation();
    const date = component.visitObservations[1];
    date.kind = 'lnmp';
    component.changeVisitObservation(date);
    date.date = '2020-04-04';
    date.measured_at = '2020-04-20';
    date.note = 'Reported date';
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Failed'}})));
    component.submit();
    expect(api.createPatientEntry.calls.mostRecent().args[0].visit_observations).toEqual([
      {kind: 'phq2', value: 0, systolic: undefined, diastolic: undefined, unit: '{score}', date: undefined, measured_at: undefined, note: undefined},
      {kind: 'lnmp', value: undefined, systolic: undefined, diastolic: undefined, unit: undefined, date: '2020-04-04', measured_at: '2020-04-20', note: 'Reported date'},
    ]);
    expect(component.visitObservations.length).toBe(2);
    api.createPatientEntry.and.returnValue(of({resource_type: 'Encounter', source_id: 'manual', source_resource_id: 'visit', sort_title: 'Screening'}));
    component.submit();
    expect(component.visitObservations).toEqual([]);
  });

  it('refuses empty measurements and out-of-range PHQ scores without submitting', () => {
    component.kind = 'visit';
    component.name = 'Synthetic visit';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    component.addVisitObservation();
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('every visit measurement');
    const entry = component.visitObservations[0];
    entry.kind = 'phq9';
    component.changeVisitObservation(entry);
    for (const value of [-1, 28, 1.5]) {
      entry.value = value;
      component.submit();
      expect(api.createPatientEntry).not.toHaveBeenCalled();
      expect(component.error).toContain('0 to 27');
    }
  });

  it('clears incompatible values when changing measurement kind without losing details or measurement date', () => {
    component.addVisitObservation();
    const entry = component.visitObservations[0];
    entry.value = 68;
    entry.systolic = 120;
    entry.date = '2020-04-04';
    entry.note = 'Synthetic details';
    entry.measured_at = '2020-04-20';
    entry.kind = 'lnmp';
    component.changeVisitObservation(entry);
    expect(entry.value).toBeNull();
    expect(entry.systolic).toBeNull();
    expect(entry.date).toBe('');
    expect(entry.unit).toBe('');
    expect(entry.note).toBe('Synthetic details');
    expect(entry.measured_at).toBe('2020-04-20');
  });

  it('places visit dates before the reason and provides a tall note editor with a working toolbar', async () => {
    component.kind = 'visit';
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    const start = form.querySelector('#vital-date')!;
    const end = form.querySelector('#visit-end-date')!;
    const reason = form.querySelector('#edit-visit-reasons')!;
    expect(start.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(end.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.querySelectorAll('#vital-date').length).toBe(1);
    expect(form.querySelector('#visit-note')).toBeNull();
    Array.from(form.querySelectorAll('button')).find(button => button.textContent.trim() === 'Add visit note')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const editor = document.querySelector<HTMLTextAreaElement>('#visit-note')!;
    expect(editor.rows).toBe(14);
    expect(editor.style.minHeight).toBe('320px');
    editor.value = 'Follow-up';
    editor.dispatchEvent(new Event('input'));
    editor.setSelectionRange(0, 9);
    document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!.click();
    expect(component.visitNote).toBe('**Follow-up**');
    expect(editor.value).toBe('**Follow-up**');
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(11);
    expect(document.activeElement).toBe(editor);
  });

  it('loads diagnosis choices only from the patient-owned manual source', () => {
    expect(api.getResources).toHaveBeenCalledWith('Condition', 'source-manual');
    expect(component.manualConditions).toEqual([{id: 'condition-1', title: 'Hypertension'}]);
  });

  it('submits multiple ICD diagnoses and expected dates for selected Conditions separately from visit end', () => {
    component.kind = 'visit';
    component.name = 'Follow-up';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    component.visitEndDate = '2026-10-05';
    component.visitDiagnosisIds = ['condition-1'];
    component.visitDiagnosisEndDates['condition-1'] = '2026-11-01';
    component.addVisitDiagnosis();
    component.visitDiagnoses[0].code = ' J06.9 ';
    component.visitDiagnoses[0].display = ' URI ';
    component.visitDiagnoses[0].expected_end_date = '2026-10-12';
    component.addVisitDiagnosis();
    component.visitDiagnoses[1].system = 'http://hl7.org/fhir/sid/icd-9-cm';
    component.visitDiagnoses[1].code = '465.9';
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_end_date_time).toBe('2026-10-05');
    expect(payload.visit_diagnoses).toEqual([
      {condition_id: 'condition-1', expected_end_date: '2026-11-01'},
      {system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J06.9', display: 'URI', expected_end_date: '2026-10-12'},
      {system: 'http://hl7.org/fhir/sid/icd-9-cm', code: '465.9', display: undefined, expected_end_date: undefined},
    ]);
    expect(component.visitDiagnoses).toEqual([]);
    expect(component.visitDiagnosisIds).toEqual([]);
  });

  it('locks only the catalog-selected row, preserves its date, and unlocks on clear', async () => {
    component.kind = 'visit';
    component.addVisitDiagnosis();
    component.addVisitDiagnosis();
    fixture.detectChanges();
    await fixture.whenStable();
    const diagnosis = component.visitDiagnoses[0];
    diagnosis.expected_end_date = '2026-10-12';
    component.selectVisitDiagnosis(diagnosis, {code: 'J06.9', display: 'Acute upper respiratory infection, unspecified'});
    fixture.nativeElement.querySelector('#edit-visit-diagnoses').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const form: HTMLElement = document.querySelector('[role="dialog"]')!;
    for (const field of ['system', 'code', 'description']) {
      expect(form.querySelector<HTMLInputElement>(`#diagnosis-${field}-0`)!.disabled).toBeTrue();
      expect(form.querySelector<HTMLInputElement>(`#diagnosis-${field}-1`)!.disabled).toBeFalse();
    }
    expect(form.querySelector<HTMLInputElement>('#diagnosis-end-new-0')!.disabled).toBeFalse();
    component.name = 'Follow-up';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Try again'}})));
    component.submit();
    expect(api.createPatientEntry.calls.mostRecent().args[0].visit_diagnoses).toEqual([
      {system: diagnosis.system, code: 'J06.9', display: diagnosis.display, expected_end_date: '2026-10-12'},
      {system: component.visitDiagnoses[1].system, code: '', display: undefined, expected_end_date: undefined},
    ]);
    expect(diagnosis.selectedFromCatalog).toBeTrue();
    form.querySelector<HTMLButtonElement>('[aria-label="Clear selection for diagnosis 1"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(diagnosis.code).toBe('');
    expect(diagnosis.display).toBe('');
    expect(diagnosis.expected_end_date).toBe('2026-10-12');
    expect(form.querySelector<HTMLInputElement>('#diagnosis-code-0')!.disabled).toBeFalse();
    expect(form.querySelector('#diagnosis-search-0')).not.toBeNull();
  });

  it('adds and removes discrete diagnosis rows and only offers dates for selected Conditions', async () => {
    component.kind = 'visit';
    component.visitDiagnosisIds = ['condition-1'];
    component.addVisitDiagnosis();
    component.addVisitDiagnosis();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#edit-visit-diagnoses').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = document.querySelector('[role="dialog"]')!;
    expect(form.querySelector('#diagnosis-end-condition-1')).not.toBeNull();
    expect(form.querySelectorAll('.diagnosis-entry').length).toBe(2);
    form.querySelector<HTMLButtonElement>('[aria-label="Remove diagnosis 1"]')!.click();
    fixture.detectChanges();
    expect(component.visitDiagnoses.length).toBe(1);
    expect(form.querySelectorAll('.diagnosis-entry').length).toBe(1);
    const select = form.querySelector<HTMLSelectElement>('#visit-diagnoses')!;
    Array.from(select.options).forEach((option) => option.selected = false);
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(form.querySelector('#diagnosis-end-condition-1')).toBeNull();
  });

  it('retains diagnosis rows and dates when saving fails', () => {
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'Invalid code'}})));
    component.kind = 'visit';
    component.name = 'Follow-up';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    component.addVisitDiagnosis();
    component.visitDiagnoses[0].code = 'INVALID';
    component.visitDiagnoses[0].expected_end_date = '2026-10-12';
    component.submit();
    expect(component.error).toBeTruthy();
    expect(component.visitDiagnoses[0].expected_end_date).toBe('2026-10-12');
  });

  it('offers the server terminology codes and identifies their systems in the Visit form', () => {
    component.kind = 'visit';
    fixture.detectChanges();
    const form: HTMLElement = fixture.nativeElement;
    for (const [selector, options] of [
      ['#visit-setting', component.visitTerminology.class.options],
      ['#visit-status', component.visitTerminology.status.options],
      ['#visit-location-type', component.visitTerminology.location.options],
      ['#visit-disposition', component.visitTerminology.disposition.options],
    ] as const) {
      const select = form.querySelector<HTMLSelectElement>(selector);
      expect(select).not.toBeNull();
      for (const option of options) {
        expect(select?.querySelector<HTMLOptionElement>(`option[value="${option.code}"]`)?.textContent).toContain(option.code);
      }
    }
    const hints = fixture.debugElement.queryAll(By.directive(NgbTooltip))
      .map((element) => element.injector.get(NgbTooltip).ngbTooltip).join(' ');
    expect(hints).toContain('HL7 ActCode');
    expect(hints).toContain('FHIR EncounterStatus');
    expect(hints).toContain('SNOMED CT');
  });

  it('sends selected terminology codes through the actual dropdowns', async () => {
    component.kind = 'visit';
    component.name = 'Follow-up';
    component.visitType = 'Consultation';
    component.visitClass = 'AMB';
    fixture.detectChanges();
    await fixture.whenStable();
    const form: HTMLElement = fixture.nativeElement;
    for (const [selector, code] of [['#visit-location-type', '22232009'], ['#visit-disposition', '306699001']]) {
      const select = form.querySelector<HTMLSelectElement>(selector)!;
      select.value = code;
      select.dispatchEvent(new Event('change'));
    }
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_location_code).toBe('22232009');
    expect(payload.visit_disposition_code).toBe('306699001');
    expect(payload.visit_location).toBeUndefined();
    expect(payload.visit_disposition).toBeUndefined();
  });

  it('does not send Visit terminology when entering another record kind', () => {
    component.visitLocationCode = '22232009';
    component.visitDispositionCode = '306689006';
    component.kind = 'implant';
    component.name = 'Pacemaker';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#visit-disposition')).toBeNull();
    component.submit();
    const payload = api.createPatientEntry.calls.mostRecent().args[0];
    expect(payload.visit_location_code).toBeUndefined();
    expect(payload.visit_disposition_code).toBeUndefined();
  });

  it('requires a visit setting instead of guessing one', () => {
    component.kind = 'visit';
    component.name = 'Annual visit';
    component.visitType = 'Outpatient visit';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('visit setting');
  });

  it('refuses an unnamed allergy or medication, and sends nothing', () => {
    component.kind = 'allergy';
    component.name = '   ';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('allergic to');

    component.kind = 'medication';
    component.submit();
    expect(api.createPatientEntry).not.toHaveBeenCalled();
    expect(component.error).toContain('medication');
  });

  // yourphr#764: what measured it is evidence, and only when they said so.
  it('sends the device they picked, and nothing when they picked none', () => {
    component.vital = 'heart_rate';
    component.value = 64;
    component.submit();
    let arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device']).toBeUndefined(); // no device named is an answer, not a gap to fill
    expect(arg['device_name']).toBeUndefined();

    component.deviceId = 'cuff-1';
    component.value = 64;
    component.submit();
    arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device']).toBe('cuff-1');
  });

  it('sends a device named for the first time by name, and offers it next time', () => {
    component.vital = 'body_weight';
    component.value = 70;
    component.deviceId = '__new';
    component.newDeviceName = ' Withings scale ';
    component.submit();
    const arg = api.createPatientEntry.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(arg['device_name']).toBe('Withings scale');
    expect(arg['device']).toBeUndefined(); // it has no id yet — the server makes or finds it
    expect(api.getOwnDevices).toHaveBeenCalledTimes(2); // re-read, so the new one is a choice now
  });

  it('offers the devices the person already named', () => {
    expect(component.devices).toEqual([{id: 'cuff-1', name: 'Omron cuff'}]);
  });

  it('surfaces API errors', () => {
    api.createPatientEntry.and.returnValue(throwError(() => ({error: {error: 'boom'}})));
    component.vital = 'heart_rate';
    component.value = 60;
    component.submit();
    expect(component.error).toBeTruthy();
  });
});
