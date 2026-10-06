import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {NgbTypeahead, NgbTypeaheadModule, NgbTypeaheadSelectItemEvent} from '@ng-bootstrap/ng-bootstrap';
import {Observable, of, Subject, timer} from 'rxjs';
import {catchError, switchMap, takeUntil, tap} from 'rxjs/operators';
import {IcdCatalogService, IcdSuggestion} from '../../services/icd-catalog.service';

@Component({
  selector: 'app-icd-diagnosis-search',
  standalone: true,
  imports: [FormsModule, NgbTypeaheadModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <label class="form-label" [for]="inputId">Search code or description</label>
    <input [id]="inputId" type="text" class="form-control" autocomplete="off"
      [(ngModel)]="query" [ngModelOptions]="{standalone: true}"
      [ngbTypeahead]="search" [inputFormatter]="formatter" [resultFormatter]="formatter"
      (selectItem)="select($event)" placeholder="e.g. J06.9 or respiratory infection"
      [attr.aria-describedby]="inputId + '-help'" />
    <small [id]="inputId + '-help'" class="form-text text-muted">
      Searches bundled {{system.endsWith('icd-9-cm') ? 'ICD-9-CM v32 (final)' : 'ICD-10-CM FY2027'}} codes locally.
      Type at least two characters; select a result to fill the code and description.
    </small>
    @if (searching) { <small role="status">Searching codes...</small> }
    @if (searched && !searching && !failed && !matches) {
      <small role="status">No matching codes. You can still enter a code manually.</small>
    }
    @if (failed) {
      <div role="alert" class="text-danger">Could not load code suggestions. Enter a code manually or try again.</div>
    }
  `,
})
export class IcdDiagnosisSearchComponent implements OnChanges, OnDestroy {
  @Input() system = '';
  @Input() inputId = '';
  @Output() selected = new EventEmitter<IcdSuggestion>();
  @ViewChild(NgbTypeahead) typeahead?: NgbTypeahead;
  query: string | IcdSuggestion = '';
  searching = false;
  searched = false;
  failed = false;
  matches = 0;
  private reset = new Subject<void>();

  constructor(private catalog: IcdCatalogService) {}

  formatter = (value: IcdSuggestion | string): string =>
    typeof value === 'string' ? value : `${value.code} - ${value.display}`;

  search = (text$: Observable<string>): Observable<IcdSuggestion[]> => text$.pipe(
    tap(() => { this.reset.next(); this.searching = false; this.searched = false; this.failed = false; }),
    switchMap((terms) => timer(200).pipe(
      takeUntil(this.reset),
      switchMap(() => {
        this.searched = terms.trim().length >= 2;
        this.searching = this.searched;
        return this.catalog.search(this.system, terms).pipe(
          takeUntil(this.reset),
          catchError(() => { this.failed = true; return of([]); }),
          tap((results) => { this.searching = false; this.matches = results.length; }),
        );
      }),
    )),
  );

  select(event: NgbTypeaheadSelectItemEvent<IcdSuggestion>): void {
    this.selected.emit(event.item);
  }

  ngOnChanges(): void {
    this.reset.next();
    this.typeahead?.dismissPopup();
    this.query = '';
    this.searching = false;
    this.searched = false;
    this.failed = false;
  }

  ngOnDestroy(): void {
    this.reset.next();
    this.reset.complete();
  }
}
