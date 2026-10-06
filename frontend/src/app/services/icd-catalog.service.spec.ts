import {TestBed} from '@angular/core/testing';
import {HttpClient} from '@angular/common/http';
import {HttpClientTestingModule, HttpTestingController} from '@angular/common/http/testing';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';
import {IcdCatalogService, searchIcdEntries} from './icd-catalog.service';

describe('IcdCatalogService', () => {
  const icd10 = 'http://hl7.org/fhir/sid/icd-10-cm';
  const icd9 = 'http://hl7.org/fhir/sid/icd-9-cm';
  let service: IcdCatalogService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{provide: HTTP_CLIENT_TOKEN, useExisting: HttpClient}],
    });
    service = TestBed.inject(IcdCatalogService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('matches dotted/undotted codes, ranks exact codes first and matches all description words', () => {
    const entries = [
      {code: 'J06.9', display: 'Acute upper respiratory infection, unspecified'},
      {code: 'J06.0', display: 'Acute laryngopharyngitis'},
      {code: 'Z87.09', display: 'Personal history of other diseases of the respiratory system'},
    ];
    expect(searchIcdEntries(entries, 'j069')[0].code).toBe('J06.9');
    expect(searchIcdEntries(entries, 'J06.9')[0].code).toBe('J06.9');
    expect(searchIcdEntries(entries, 'infection upper')).toEqual([entries[0]]);
    expect(searchIcdEntries(entries, 'not a diagnosis')).toEqual([]);
    expect(searchIcdEntries(entries, 'j')).toEqual([]);
  });

  it('limits suggestions to twelve', () => {
    const entries = Array.from({length: 30}, (_, i) => ({code: `A${i}`, display: 'Matching description'}));
    expect(searchIcdEntries(entries, 'matching')).toHaveSize(12);
  });

  it('loads only local static assets without search terms and caches each system separately', () => {
    service.search(icd10, 'j069').subscribe((results) => expect(results[0].code).toBe('J06.9'));
    const request = http.expectOne('assets/terminology/icd-10-cm.json');
    expect(request.request.params.keys()).toEqual([]);
    request.flush({system: icd10, version: 'FY2027', entries: [['J06.9', 'Acute upper respiratory infection, unspecified']]});
    service.search(icd10, 'upper').subscribe((results) => expect(results[0].code).toBe('J06.9'));
    http.expectNone('assets/terminology/icd-10-cm.json');
    service.search(icd9, '4659').subscribe((results) => expect(results[0].code).toBe('465.9'));
    http.expectOne('assets/terminology/icd-9-cm.json').flush({
      system: icd9, version: 'v32', entries: [['465.9', 'Acute upper respiratory infections of unspecified site']],
    });
  });

  it('does not fetch anything for short terms and surfaces load failures with retry', () => {
    service.search(icd10, 'j').subscribe((results) => expect(results).toEqual([]));
    http.expectNone('assets/terminology/icd-10-cm.json');
    service.search(icd10, 'j06').subscribe({error: (error) => expect(error.status).toBe(503)});
    http.expectOne('assets/terminology/icd-10-cm.json').flush('Unavailable', {status: 503, statusText: 'Unavailable'});
    service.search(icd10, 'j06').subscribe();
    http.expectOne('assets/terminology/icd-10-cm.json').flush({
      system: icd10, version: 'FY2027', entries: [['J06.9', 'Acute upper respiratory infection, unspecified']],
    });
  });

  it('rejects a mismatched catalog rather than returning codes from the wrong system', () => {
    service.search(icd10, '465').subscribe({error: (error) => expect(error.message).toBe('Invalid ICD catalog')});
    http.expectOne('assets/terminology/icd-10-cm.json').flush({system: icd9, entries: [['465.9', 'Wrong catalog']]});
  });
});
