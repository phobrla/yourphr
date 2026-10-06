import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EncounterComponent } from './encounter.component';
import {RouterTestingModule} from '@angular/router/testing';
import {EncounterModel} from '../../../../../lib/models/resources/encounter-model';

describe('EncounterComponent', () => {
  let component: EncounterComponent;
  let fixture: ComponentFixture<EncounterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ EncounterComponent, RouterTestingModule ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EncounterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders additional notes independently and strips remote media from each note', () => {
    const model = new EncounterModel({text: {div: '<div>First note</div>'}});
    model.additionalNotes = [{authors: ['Second Provider'], authored: '2020-04-22',
      narrative: '<div><strong>Second note</strong><img src="https://example.org/private" alt="Omitted image"></div>'}];
    fixture.componentRef.setInput('displayModel', model);
    fixture.detectChanges();
    const second: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Additional visit note 1"]');
    expect(second.textContent).toContain('Second Provider');
    expect(second.querySelector('strong')?.textContent).toBe('Attributed authors:');
    expect(second.textContent).toContain('Second note');
    expect(second.querySelector('img')).toBeNull();
    expect(second.textContent).toContain('Omitted image');
  });

  it('shows lab results and note attribution as escaped text, not authenticated authorship', () => {
    const model = new EncounterModel({text: {div: '<div>Note</div>'}});
    model.noteAuthors = ['Synthetic Author, MD'];
    model.noteAuthored = '2020-04-20';
    model.labs = [{label: 'Synthetic test', value: 'Not detected', code: '2345-7', notes: ['<img src="https://example.org/private">'],
      laboratory: ['Synthetic lab'], referenceRange: ['Negative'], collected: '2020-04-21', issued: '2020-04-23T12:00:00Z'}];
    fixture.componentRef.setInput('displayModel', model);
    component.ngOnInit();
    fixture.detectChanges();
    const note: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Visit note"]');
    expect(note.textContent).toContain('Synthetic Author, MD');
    expect(note.textContent).toContain('not a verified provider signature');
    const labs: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Visit laboratory results"]');
    expect(labs.textContent).toContain('Not detected');
    expect(labs.textContent).toContain('LOINC 2345-7');
    expect(labs.querySelector('img')).toBeNull();
  });

  it('displays encounter measurements without hiding zero or injecting note HTML', () => {
    const model = new EncounterModel({});
    model.measurements = [
      {label: 'PHQ-2', value: '0 score', code: '55758-7', measuredAt: '2020-04-20', notes: ['<img src="https://example.org/private">'], needsReview: false},
      {label: 'LNMP', value: '2020-04-04', notes: ['Reported normal period'], needsReview: false},
      {label: 'Blood pressure', value: 'Systolic blood pressure: 122 mm[Hg]', notes: [], needsReview: true},
    ];
    fixture.componentRef.setInput('displayModel', model);
    fixture.detectChanges();
    const section: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Visit measurements"]');
    expect(section.textContent).toContain('0 score');
    expect(section.textContent).toContain('2020-04-04');
    expect(section.textContent).toContain('Needs review');
    expect(section.querySelector('img')).toBeNull();
  });

  it('shows all reasons and a distinct primary chief complaint', () => {
    const model = new EncounterModel({
      reasonCode: [{text: 'Review my results'}, {text: 'My head hurts'}],
      reasonReference: [{reference: '#chief'}],
      contained: [{resourceType: 'Observation', id: 'chief', valueString: 'My head hurts',
        code: {coding: [{system: 'http://loinc.org', code: '10154-3'}]}}],
    });
    fixture.componentRef.setInput('displayModel', model);
    component.ngOnInit();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Review my results');
    expect(text).toContain('My head hurts');
    expect(text).toContain('Primary chief complaint');
  });

  it('renders FHIR narrative formatting through Angular sanitization', () => {
    fixture.componentRef.setInput('displayModel', new EncounterModel({
      text: {status: 'additional', div: '<div xmlns="http://www.w3.org/1999/xhtml"><h2>Plan</h2><p><strong>Follow-up</strong></p><ul><li>Rest</li></ul><img src="https://example.org/private-image" alt="Image description" /><script>alert(1)</script></div>'},
    }));
    fixture.detectChanges();
    const note: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Visit note"]');
    expect(note.querySelector('h2')?.textContent).toBe('Plan');
    expect(note.querySelector('strong')?.textContent).toBe('Follow-up');
    expect(note.querySelector('li')?.textContent).toBe('Rest');
    expect(note.querySelector('script')).toBeNull();
    expect(note.querySelector('img')).toBeNull();
    expect(note.textContent).toContain('Image description');
  });

  it('renders discrete codes and dates as estimated, not resolved', () => {
    const model = new EncounterModel({});
    model.diagnoses = [
      {display: 'URI', codes: ['ICD-10-CM J06.9'], expectedEndDate: '2026-10-12'},
      {display: 'Legacy URI', codes: ['ICD-9-CM 465.9']},
    ];
    fixture.componentRef.setInput('displayModel', model);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('ICD-10-CM J06.9');
    expect(text).toContain('ICD-9-CM 465.9');
    expect(text).toContain('Expected end date: 2026-10-12 (estimated)');
  });
});
