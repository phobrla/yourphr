# ICD diagnosis catalogs

Public US government diagnosis-code descriptions bundled for local autocomplete.
No patient search terms are sent to CDC, CMS, NLM, or another external service.

- ICD-10-CM: [CDC FY2027 code descriptions](https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/icd10cm-code-descriptions-2027.zip), effective October 1, 2026.
- ICD-9-CM: [CMS v32 master descriptions](https://www.cms.gov/medicare/coding/icd9providerdiagnosticcodes/downloads/icd-9-cm-v32-master-descriptions.zip), final FY2015 edition. Only diagnosis codes are included, not procedure codes.

The JSON files are generated, not hand-maintained. Download those two archives and run
`node scripts/build-icd-catalogs.mjs <CDC FY2027 ZIP> <CMS v32 ZIP>` from the repository root.
The generator preserves official descriptions and adds the display decimal to codes.
Each file records its code system, edition, source URL, and code/description pairs.
When updating ICD-10-CM, update the generator's pinned edition and archive member,
the search-field edition label, and this provenance documentation together.

Suggestions assist data entry, not clinical diagnosis. Manual entry is retained for
historical codes absent from these editions. Neither autocomplete nor syntax checking
certifies a diagnosis or implies that a code applies to a particular visit date.

Selecting a suggestion locks that row's code system, diagnosis code, and description
to keep the catalog entry intact. The expected end date remains editable.
Use "Clear selection" to unlock the fields and choose another code or enter one manually;
clearing keeps the code system and expected end date but removes the selected code and description.
