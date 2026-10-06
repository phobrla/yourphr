import {fakeAsync, TestBed, tick} from '@angular/core/testing';
import {of, Subject, throwError} from 'rxjs';
import {IcdCatalogService, IcdSuggestion} from '../../services/icd-catalog.service';
import {IcdDiagnosisSearchComponent} from './icd-diagnosis-search.component';

describe('IcdDiagnosisSearchComponent', () => {
  let catalog: jasmine.SpyObj<IcdCatalogService>;
  let component: IcdDiagnosisSearchComponent;
  const suggestion = {code: 'J06.9', display: 'Acute upper respiratory infection, unspecified'};

  beforeEach(() => {
    catalog = jasmine.createSpyObj('IcdCatalogService', ['search']);
    catalog.search.and.returnValue(of([suggestion]));
    TestBed.configureTestingModule({providers: [{provide: IcdCatalogService, useValue: catalog}]});
    component = TestBed.createComponent(IcdDiagnosisSearchComponent).componentInstance;
    component.system = 'http://hl7.org/fhir/sid/icd-10-cm';
  });

  it('debounces typing and clears stale results when the code system changes', fakeAsync(() => {
    const terms = new Subject<string>();
    const results: IcdSuggestion[][] = [];
    component.search(terms).subscribe((answer) => results.push(answer));
    terms.next('j0');
    tick(100);
    terms.next('j06');
    tick(200);
    expect(catalog.search).toHaveBeenCalledOnceWith(component.system, 'j06');
    expect(results).toEqual([[suggestion]]);
    terms.next('j069');
    component.system = 'http://hl7.org/fhir/sid/icd-9-cm';
    component.ngOnChanges();
    tick(200);
    expect(catalog.search.calls.count()).toBe(1);
    expect(component.query).toBe('');
    terms.next('465');
    tick(200);
    expect(catalog.search).toHaveBeenCalledWith(component.system, '465');
  }));

  it('cancels an in-flight search when another term is typed', fakeAsync(() => {
    const response = new Subject<IcdSuggestion[]>();
    catalog.search.and.returnValue(response);
    const terms = new Subject<string>();
    const results: IcdSuggestion[][] = [];
    component.search(terms).subscribe((answer) => results.push(answer));
    terms.next('old');
    tick(200);
    terms.next('new');
    response.next([suggestion]);
    expect(results).toEqual([]);
    component.ngOnDestroy();
    tick(200);
  }));

  it('shows failures explicitly while allowing another search', fakeAsync(() => {
    catalog.search.and.returnValue(throwError(() => new Error('Catalog unavailable')));
    const terms = new Subject<string>();
    component.search(terms).subscribe();
    terms.next('j06');
    tick(200);
    expect(component.failed).toBeTrue();
    expect(component.searching).toBeFalse();
    catalog.search.and.returnValue(of([]));
    terms.next('no match');
    tick(200);
    expect(component.failed).toBeFalse();
    expect(component.matches).toBe(0);
    expect(component.searched).toBeTrue();
  }));

  it('emits the selected code and description together', () => {
    spyOn(component.selected, 'emit');
    component.select({item: suggestion, preventDefault: () => undefined});
    expect(component.selected.emit).toHaveBeenCalledWith(suggestion);
  });
});
