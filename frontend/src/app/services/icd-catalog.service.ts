import {Inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable, of} from 'rxjs';
import {map, shareReplay} from 'rxjs/operators';
import {HTTP_CLIENT_TOKEN} from '../dependency-injection';

export interface IcdSuggestion {
  code: string;
  display: string;
}

interface IcdCatalog {
  system: string;
  version: string;
  entries: [string, string][];
}

export function searchIcdEntries(entries: IcdSuggestion[], terms: string): IcdSuggestion[] {
  const query = terms.trim().toLowerCase();
  if (query.length < 2) return [];
  const codeQuery = query.replace(/\./g, '');
  const words = query.split(/\s+/);
  return entries
    .filter((entry) => entry.code.replace(/\./g, '').toLowerCase().startsWith(codeQuery) ||
      words.every((word) => entry.display.toLowerCase().includes(word)))
    .sort((a, b) => {
      const rank = (entry: IcdSuggestion) => {
        const code = entry.code.replace(/\./g, '').toLowerCase();
        return code === codeQuery ? 0 : code.startsWith(codeQuery) ? 1 : 2;
      };
      return rank(a) - rank(b) || a.code.localeCompare(b.code);
    })
    .slice(0, 12);
}

@Injectable({providedIn: 'root'})
export class IcdCatalogService {
  private catalogs = new Map<string, Observable<IcdSuggestion[]>>();

  constructor(@Inject(HTTP_CLIENT_TOKEN) private http: HttpClient) {}

  search(system: string, terms: string): Observable<IcdSuggestion[]> {
    if (terms.trim().length < 2) return of([]);
    const name = system === 'http://hl7.org/fhir/sid/icd-10-cm' ? 'icd-10-cm'
      : system === 'http://hl7.org/fhir/sid/icd-9-cm' ? 'icd-9-cm' : undefined;
    if (!name) throw new Error('Unsupported ICD code system');
    let catalog = this.catalogs.get(system);
    if (!catalog) {
      catalog = this.http.get<IcdCatalog>(`assets/terminology/${name}.json`).pipe(
        map((data) => {
          if (data.system !== system || !Array.isArray(data.entries) || data.entries.length === 0) {
            throw new Error('Invalid ICD catalog');
          }
          return data.entries.map(([code, display]) => ({code, display}));
        }),
        shareReplay({bufferSize: 1, refCount: false}),
      );
      this.catalogs.set(system, catalog);
    }
    return catalog.pipe(map((entries) => searchIcdEntries(entries, terms)));
  }
}
