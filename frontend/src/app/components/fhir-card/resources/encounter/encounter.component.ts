import {ChangeDetectorRef, Component, EventEmitter, Inject, Input, OnInit, Output, ChangeDetectionStrategy, SecurityContext} from '@angular/core';
import {NgbCollapseModule} from '@ng-bootstrap/ng-bootstrap';
import {CommonModule, DOCUMENT} from '@angular/common';
import {DomSanitizer} from '@angular/platform-browser';
import {BadgeComponent} from '../../common/badge/badge.component';
import {TableComponent} from '../../common/table/table.component';
import {GlossaryLookupComponent} from '../../../glossary-lookup/glossary-lookup.component';
import {Router, RouterModule} from '@angular/router';
import {TableRowItem, TableRowItemDataType} from '../../common/table/table-row-item';
import {FhirCardEditableComponentInterface} from '../../fhir-card/fhir-card-component-interface';
import {EncounterModel} from '../../../../../lib/models/resources/encounter-model';
import { FastenDisplayModel } from 'src/lib/models/fasten/fasten-display-model';

@Component({
    imports: [NgbCollapseModule, CommonModule, BadgeComponent, TableComponent, GlossaryLookupComponent, RouterModule],
    selector: 'fhir-encounter',
    templateUrl: './encounter.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./encounter.component.scss']
})
export class EncounterComponent implements OnInit, FhirCardEditableComponentInterface {
  @Input() displayModel: EncounterModel | null
  @Input() showDetails = true
  @Input() isCollapsed = false
  @Input() isEditable = false

  @Output() unlinkRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()
  @Output() editRequested: EventEmitter<FastenDisplayModel> = new EventEmitter<FastenDisplayModel>()

  //these are used to populate the description of the resource. May not be available for all resources
  resourceCode?: string;
  resourceCodeSystem?: string;

  tableData: TableRowItem[] = []

  private lastNarrative: string | undefined;
  private renderedNarrative = '';
  private noteCache = new Map<string, string>();

  constructor(public changeRef: ChangeDetectorRef, public router: Router,
    @Inject(DOCUMENT) private document: Document, private sanitizer: DomSanitizer) { }

  get noteNarrative(): string {
    const narrative = this.displayModel?.narrative;
    if (narrative === this.lastNarrative) return this.renderedNarrative;
    this.lastNarrative = narrative;
    this.renderedNarrative = this.safeNoteNarrative(narrative ?? '');
    return this.renderedNarrative;
  }

  safeNoteNarrative(narrative: string): string {
    const cached = this.noteCache.get(narrative);
    if (cached !== undefined) return cached;
    const template = this.document.createElement('template');
    template.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, narrative) ?? '';
    // Imported narratives can carry remote media; never load those while opening a patient's note.
    template.content.querySelectorAll('img, video, audio, source').forEach((element) => {
      element.replaceWith(this.document.createTextNode(element.getAttribute('alt') || '[Embedded media omitted]'));
    });
    this.noteCache.set(narrative, template.innerHTML);
    return template.innerHTML;
  }

  ngOnInit(): void {
    // US Core Encounter Must-Support: type, class, status, period, participant, reasonCode,
    // hospitalization.dischargeDisposition, location. Each row is gated on presence (detect-don't-
    // require), so a conformant Encounter shows the full set and a sparse non-US-Core one shows only
    // what it has — the title fallback (model.display) keeps it from rendering blank.
    const participants = (this.displayModel?.participant || [])
      .map((p) => {
        const name = p.display || p.text || p.reference?.reference;
        if (!name) { return null; }
        return p.role ? `${p.role}: ${name}` : name;
      })
      .filter(Boolean) as string[];

    this.tableData = [
      {
        // US Core MS: subject (Patient)
        label: 'Patient',
        data: this.displayModel?.subject,
        data_type: TableRowItemDataType.Reference,
        enabled: !!this.displayModel?.subject,
      },
      {
        label: 'Type',
        data: this.displayModel?.encounter_type?.[0],
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.encounter_type?.[0],
      },
      {
        // US Core MS: serviceType
        label: 'Service type',
        data: this.displayModel?.service_type,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.service_type,
      },
      {
        label: 'Class',
        data: this.displayModel?.resource_class,
        enabled: !!this.displayModel?.resource_class,
      },
      {
        label: 'Status',
        data: this.displayModel?.resource_status,
        enabled: !!this.displayModel?.resource_status,
      },
      ...(this.displayModel?.reasonCode ?? []).map((reason, index) => ({
        label: index === 0 ? 'Reason' : `Reason ${index + 1}`,
        data: reason,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: true,
      })),
      {
        label: 'Primary chief complaint',
        data: this.displayModel?.chiefComplaint,
        enabled: !!this.displayModel?.chiefComplaint,
      },
      {
        label: 'Participants',
        data: participants.join(', '),
        enabled: participants.length > 0,
      },
      {
        label: 'Discharge disposition',
        data: this.displayModel?.discharge_disposition,
        data_type: TableRowItemDataType.CodableConcept,
        enabled: !!this.displayModel?.discharge_disposition,
      },
      {
        label: 'Location',
        data: this.displayModel?.location_display,
        enabled: !!this.displayModel?.location_display,
      },
      {
        label: this.displayModel?.period_end?.includes('T') ? 'End date/time' : 'End date',
        data: this.displayModel?.period_end,
        enabled: !!this.displayModel?.period_end,
      },
    ];
  }
  markForCheck(){
    this.changeRef.markForCheck()
  }

  onUnlinkClicked() {
    this.unlinkRequested.emit(this.displayModel)
  }

  onEditClicked() {
    this.editRequested.emit(this.displayModel)
  }
}
