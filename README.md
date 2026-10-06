# YourPHR — Self-Hosted Personal Health Record

[![YourPHR](frontend/src/assets/logo/yourphr-logo.svg)](https://github.com/jwilleke/yourphr)

[![CI](https://github.com/jwilleke/yourphr/actions/workflows/ci.yaml/badge.svg)](https://github.com/jwilleke/yourphr/actions/workflows/ci.yaml)

__YourPHR lets you create a secure, private personal health record that never leaves your hands__ — self-hosted, open source, and yours. Project home: [yourphr.org](https://yourphr.org)

__Mission: Your medical records, immediately and in your hands — for free.__ Fulfilling the [21st Century Cures Act](https://www.healthit.gov/topic/oncs-cures-act-final-rule) (2016).

> [!NOTE]
> __YourPHR is a standalone, community-maintained continuation of [Fasten OnPrem](https://github.com/fastenhealth/fasten-onprem)__, carried forward by [@jwilleke](https://github.com/jwilleke) to keep a fully open-source, self-hostable PHR going after upstream's hosted sync relay (Lighthouse) moved into the commercial *Fasten Connect* product — which broke provider sync in the open-source build.
>
> The original work is by __Jason Kulatunga ([@AnalogJ](https://github.com/AnalogJ))__ and __Alex Szilagyi ([@alexszilagyi](https://github.com/alexszilagyi))__ under the [GNU GPL v3 license](LICENSE.md). YourPHR remains GPL v3 and retains full attribution.
>
> __Focus:__ a free, self-hosted Personal Health Record anyone can run — including improved display support for non-US-Core FHIR R4 exports (e.g. Veradigm/FollowMyHealth). See [`docs/Roadmap.md`](docs/Roadmap.md).

---

> [!IMPORTANT]  
> __YourPHR is an open-source, self-hosted [Personal Health Record](https://en.wikipedia.org/wiki/Personal_health_record) app__ for managing and viewing your own medical data. It does not integrate with EHRs directly — you import FHIR R4 bundles exported from patient portals, or enter data manually.
>
> YourPHR is __not affiliated with__ Fasten Health, Inc. or its commercial *Fasten Connect* product.

__[yourphr.org](https://yourphr.org)__

[![YourPHR screenshots](https://i.imgur.com/jfqv5Q5.png)](https://imgur.com/a/vfgojBD)

[See more screenshots](https://imgur.com/a/vfgojBD)

## Introduction

Like many of you, I've worked for many companies over my career. In that time, I've had multiple health, vision and dental
insurance providers, and visited many different clinics, hospitals and labs to get procedures & tests done.

Recently I had a semi-serious medical issue, and I realized that my medical history (and the medical history of my family members)
is a lot more complicated than I realized and distributed across the many healthcare providers I've used over the years.
I wanted a single (private) location to store our medical records, and I just couldn't find any software that worked as I'd like:

- self-hosted/offline - this is my medical history, I'm not willing to give it to some random multi-national corporation to data-mine and sell
- It should aggregate my data from multiple healthcare providers (insurance companies, hospital networks, clinics, labs) across multiple industries (vision, dental, medical) -- all in one dashboard
- open source - the code should be available for contributions & auditing

So, I built it.

__YourPHR is an open-source, self-hosted, personal/family electronic medical record viewer.__ It continues the original project's vision (described above by its original author) as a community-maintained, standalone app.

## Features

It's pretty basic right now, but it's designed with a easily extensible core around a solid foundation:

- Self-hosted
- Account Profile includes [account-owned terminology file mappings](src/config/terminology-files.json) for LOINC, SNOMED CT RF2 concepts/descriptions/language reference sets, and licensed UB-04 code sets, with account, download and license links. Each signed-in user can enter, save and edit absolute server/container paths for their own account, without changing shared server configuration or another user's mappings. Clearing a path removes the mapping. No catalog files or credentials are uploaded, and mapping a file does not yet import, validate or activate full terminology search.
- Designed for families, not Clinics (unlike OpenEMR and other popular EMR systems)
- Supports the Medical industry's (semi-standard) FHIR protocol
- Manual implant entry creates a patient-linked FHIR R4 `Device`, tagged with the US Core implantable-device profile. It preserves the stated device type, active/inactive/unknown status, UDI device identifier, distinct identifier, serial and lot numbers, and manufacture/expiration dates when supplied. The Implants section groups these records separately from general devices. Profile tagging expresses the intended mapping, not a claim that terminology, UDI contents or the complete profile have been validated.
- Manual Visit entry uses [FHIR R4 encounter class and status](https://hl7.org/fhir/R4/encounter-definitions.html), with SNOMED CT choices for location type and discharge disposition. Location types also carry the HL7 location role code where an equivalent exists, respecting FHIR's extensible binding. Location names and additional discharge details remain text; unlisted descriptions are not assigned guessed codes. The form and server share the [supported terminology choices](src/patient-entry/visit-terminology.json). This is terminology alignment, not a claim of full US Core conformance.
- Visits accept multiple discrete ICD-9-CM / ICD-10-CM diagnoses, stored as contained FHIR Conditions linked by `Encounter.diagnosis.condition`. These are encounter-specific, not automatically added to the longitudinal problem list. Autocomplete searches bundled [CDC ICD-10-CM FY2027](https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/) and [CMS ICD-9-CM v32 (final)](https://www.cms.gov/medicare/coding-billing/icd-10-codes/icd-9-cm-diagnosis-procedure-codes-abbreviated-and-full-code-titles) diagnosis lists by code or description, entirely in the browser; search terms never leave the device. Lists load from this instance on first search and need no external service. Manual entry remains available for historical codes outside these editions; the server checks syntax, not catalog membership or clinical validity. Each new or linked diagnosis can have an optional expected end date, stored as a `valueDate` extension on `Encounter.diagnosis` using the URL in the [terminology contract](src/patient-entry/visit-terminology.json). This YourPHR extension is an estimate for that encounter, never `Condition.abatementDateTime`, a resolution status, or a change to an existing Condition.
- Visits support multiple reasons in `Encounter.reasonCode`, with optional common SNOMED CT selections or the patient's own words. One reason may be explicitly marked as the primary chief complaint; none is assumed by default. It is also stored as a contained, patient-generated Observation coded [LOINC 10154-3](https://loinc.org/10154-3/), linked from `Encounter.reasonReference` and back to its containing Encounter. This is a reported concern, not a confirmed diagnosis. Visit type is a single `Encounter.type` selection (consultation, follow-up consultation, or check-up), with a manual-text alternative. These short SNOMED CT menus are not a complete catalog; their codes and displays live in the shared [terminology contract](src/patient-entry/visit-terminology.json). Legacy text-only visit requests remain supported. Saved cards show every reason and identify the primary chief complaint.
- Visits can contain repeatable measurements: weight, height, BMI, pulse, respiratory rate, temperature, oxygen saturation, blood pressure, PHQ total scores, and last normal menstrual period (LNMP). Numeric vitals reuse the standalone entry builder's LOINC/UCUM mappings; PHQ-2 and PHQ-9 totals are survey Observations with integer scores (including zero), not inferred diagnoses or invented questionnaire answers. LNMP is a date-valued Observation with its normal-period qualifier retained in the text and note. Codes, score limits and the Encounter reference-extension URL live in the [terminology contract](src/patient-entry/visit-terminology.json). Each measurement defaults to the visit's start date/precision or accepts a separate measurement date and details such as temperature site. Nothing derives BMI, converts units or fills missing readings; partial blood pressure requires review. These patient-entered Observations are contained in the Encounter so the visit, measurements and narrative save atomically and export together. Saved visit cards show them, but they are not independently indexed chart/timeline records. Transcribing a clinician document here does not preserve its original clinician provenance; faithful document import requires retaining the source document, authors, authentication and separately dated results.
- Visit start/end dates and optional times are at the top of the entry form. Times use the browser's local timezone and save as timezone-qualified FHIR `Encounter.period` timestamps; leaving time blank retains date-only precision, never an assumed midnight. A time requires its corresponding date. The taller modal note editor offers a Markdown toolbar for bold, italic, headings, lists, quotes, links, code, tables, and dividers. The server uses the shared content-filter pipeline and stores formatted notes in FHIR `Encounter.text.div` as XHTML with `status: additional`; saved visit cards display that formatting. Raw HTML and unsafe links are refused, and embedded images are refused to avoid external requests when opening a note. Legacy API clients without `note_format: markdown` retain escaped plain-text notes, including line breaks.
- Visit reasons, ICD/linked diagnoses, measurements, laboratory results, billing codes, note content, note attribution and additional notes use modal overlays, leaving compact summaries on the main form. Visit basics precede consistent clinical summary cards, arranged in two columns on desktop and one on mobile; notes have a full-width section. Optional location, discharge and identifier fields are expandable and open automatically when populated. Reasons support detailed free-text complaints and one optional primary assignment through radio buttons; optional SNOMED CT quick picks do not replace entered narrative and are not a full catalog. __Done__ updates the visit draft only; __Cancel__, Escape or closing the modal restores that section's previous draft, including removed rows and primary selection. The main __Save record__ action persists the visit with the same FHIR mappings. Dates and primary visit fields stay on the main page.
  The first note's authors and original authored date are edited inside its dialog, beneath the content. Done accepts content and attribution together; dismissal restores both.
- UB-04 billing entry supports manual revenue codes (FL 42) and type-of-bill codes (FL 04), with four-digit strings preserving leading zeros and an optional description transcribed from the bill. Each is a `valueCoding` on the Encounter using the [billing extension and NUBC system URLs](src/patient-entry/visit-terminology.json); these are YourPHR billing annotations, not standard Encounter clinical codes, a complete UB-04 form, or a submitted FHIR Claim. They export with the visit and display on its card. No claim, insurer, charge, or verified code assignment is inferred. The [AHA/NUBC catalog requires licensing](https://www.hl7.org/fhir/us/carin-bb/STU1/CodeSystem-AHANUBCRevenueCodes.html); no catalog/descriptions are bundled or looked up, and validation checks format only.
- Visit laboratory results use FHIR R4 `Observation` with the laboratory category and `http://loinc.org` coding. Choose a common test from the [terminology contract](src/patient-entry/visit-terminology.json), or manually enter the exact code/name from the report; this is not a full LOINC catalog, and manual codes are checked for syntax rather than catalog membership or clinical validity. Numeric values use `valueQuantity` (including optional inequality comparators); qualitative results retain their wording in `valueString`. Reported units remain display text unless an explicit UCUM code is supplied. Collection date (`effectiveDateTime`), report timestamp (`issued`), textual reference range, performing laboratory and optional linked `Specimen` are independent; none is inferred from the visit date, patient identity or missing result. Lab Observations and Specimens are contained in the Encounter and export with it, not independently indexed for charts. Blank results are refused rather than made negative.
- A visit supports multiple distinct notes, each with its own contained FHIR R4 `DocumentReference`, linked to the Encounter through the [note reference extension](src/patient-entry/visit-terminology.json) and `DocumentReference.context.encounter`. Each inline XHTML attachment retains that note's complete safely rendered content; its narrative also supports card display without merging notes. Authors are selected from the provider address book and stored in `DocumentReference.author` as `Practitioner/<id>` references with names resolved by the server from the patient's accessible providers, not trusted request labels or inferred visit participants. An author may remain unspecified. Legacy name-only API attribution remains readable/supported, but the UI uses provider selection. The optional original authored date is `content.attachment.creation`; `DocumentReference.date` is when the transcription was created. Signing/locking time is neither authored date nor visit end. Patient-generated metadata remains on each transcription, and no authenticator, signature or original clinician provenance is invented. This is attribution support, not an original-document import.
- (Future) Multi-user support for household/family use
- Condition specific user Dashboards & tracking for diagnostic tests
- (Future) Vaccination & condition specific recommendations using NIH/WHO clinical care guidelines (HEDIS/CQL)
- (Future) ChatGPT-style interface to query your own medical history (offline)
- (Future) Integration with smart-devices & wearables

---

## Instructions

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/jwilleke/yourphr?style=flat-square)](https://github.com/jwilleke/yourphr/releases/latest)

First, if you don't have Docker installed on your computer, get Docker by following this [install guide](https://docs.docker.com/get-docker/).

Next, run the following commands from the Windows command line or Mac/Linux terminal in order to download and start the YourPHR docker container.

### 🚀 Launch

One command. One image holding the server and the app, and one volume holding everything the
instance owns.

```bash
docker run -d --name yourphr --restart unless-stopped \
  -p 9090:8080 \
  -v ./data:/opt/yourphr/data \
  ghcr.io/jwilleke/yourphr:3.2.0
```

`./data` is the directory to back up: the database, the config store and the generated signing key
all live there. Pin a version rather than a floating tag — `:latest` moves only when a release is
cut, but it does move.

__Optional, before first start — database encryption.__ The key is read from a `.env` on that same
volume, and a database written unencrypted cannot be encrypted later by restarting with a key set.
So if you want it, decide now:

```bash
mkdir -p ./data
printf 'YOURPHR_DATABASE_ENCRYPTION_KEY=%s\nYOURPHR_BACKUP_ENCRYPTION_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > ./data/.env
chmod 600 ./data/.env
```

__Record those keys somewhere that is not this machine.__ If the volume is lost and the keys with
it, the database and every backup are permanently unreadable. The app warns about this on every
start, and it means it.

> __A compose file is not shipped yet__ ([#641](https://github.com/jwilleke/yourphr/issues/641)),
> along with example Kubernetes manifests and a bare-metal path. The `docker run` above is the
> equivalent in the meantime.

### Manual Configuration (Optional)

If you prefer not to run the `set_env.sh` script, you can configure the `.env` file manually. You will need to create a `.env` file and add the following variables:

1. __Find your hostname:__

    ```bash
    hostname
    ```

2. __Find your local IP address:__
    - __macOS:__ `ifconfig | grep "inet " | grep -v 127.0.0.1 | cut -d' ' -f2`
    - __Linux:__ `hostname -I | awk '{print $1}'`
    - __Windows (Command Prompt):__ `ipconfig | findstr /i "ipv4"`

3. __Create and edit the `.env` file:__
    Create a file named `.env` in the same directory as your `docker-compose.yml` and add the following lines, replacing `<your_hostname>` and `<your_ip_address>` with the values you found:

    ```
    HOSTNAME=<your_hostname>
    IP=<your_ip_address>
    PORT=9090
    ```

Next, open a browser to `http://localhost:9090`

### Session continuity

Set `YOURPHR_AUTH_SESSION_KEY` to a high-entropy secret in the server's protected environment or
gitignored `.env` to preserve signed-in sessions across server restarts. Use the same secret on
every replica; changing it invalidates existing sessions. Leave it unset to retain the default
per-process random key, which signs everyone out on restart. The key is environment-owned and
masked in Admin → Configuration; never commit it. Password changes and account-wide sign-out
still revoke sessions regardless of this setting.

### Other deployment options & configuration

The docker-compose flow above is the easy path, but __YourPHR is deployment-agnostic__ — its Node.js TypeScript server serves the compiled Angular app and stores data in SQLite with __no required external services__, so it does not depend on any particular orchestrator. You can also run it via plain `docker run`, on bare metal, or in Kubernetes. Configuration precedence is shipped defaults < instance overrides in `<data>/config/app-custom-config.json` < `YOURPHR_*` environment variables; Admin → Configuration edits the instance overrides. Bootstrap environment loading reads `<YOURPHR_FAST_STORAGE>/.env`, then the working directory's `.env`, without replacing ambient variables.

➡️ See __[`docs/deployment/README.md`](docs/deployment/README.md)__ for every deployment option (docker-compose / `docker run` / bare metal / Kubernetes), the configuration model + precedence, the full config-key reference, and how secrets are handled (the DB encryption key, the auto-generated JWT key, and per-source OAuth `client_secret`s stored in the DB).

### 🔒 HTTPS

__The application speaks plain HTTP.__ It does not terminate TLS and does not generate a
certificate authority — put a reverse proxy in front of it and let that hold the certificate. That
is how the maintainer's own instance runs (Traefik, with the app behind it on `:8080`).

Earlier versions of YourPHR — the Go stack, through v2.10.3 — generated their own `"YourPHR CA"` at
startup and wrote `certs/rootCA.pem`, which you then imported into your browser's trust store. v3
does none of that. If you are following older notes: there is no `certs/` directory to find, and
`https://localhost:9090` will not answer.

For a LAN-only instance, the simplest options are Caddy (which obtains and renews certificates on
its own), or any reverse proxy you already run. Example manifests and a worked compose file are
[#641](https://github.com/jwilleke/yourphr/issues/641).

### 🧪 Develop

Requires a local clone, Node 24 and the frontend's toolchain.

```bash
cp .env.dev.example .env
make serve-server      # the API on :8080
make serve-frontend    # the Angular dev server, proxying to it
```

`make test` runs both suites; `make test-e2e` builds the app and drives a real browser over it.

When serving compiled frontend assets, run the VS Code task __Build frontend for local app__
after frontend changes. Direct URLs such as `/resource/add` support browser navigation and reload.
Unhashed development assets revalidate on each request; only fingerprinted bundles cache immutably.

Browser access requires the server to remain running, independently of any desktop window.
For a local macOS launcher, use a user LaunchAgent to run `node dist/server/main.js` with the
same data directory and configuration as the desktop app. The desktop launcher reuses the running
server; closing it should not stop a separately managed server. A user LaunchAgent runs while
that macOS user is logged in, not after logout.

### Run the released image

One image holds the TypeScript server and the Angular app, built from the same commit.

```bash
docker run -d --name yourphr --restart unless-stopped \
  -p 9090:8080 \
  -v ./data:/opt/yourphr/data \
  ghcr.io/jwilleke/yourphr:3.2.0
```

Everything the instance owns lives in that one volume — the database, the config store, the
generated signing key. It is the directory to back up. Use a version tag rather than a floating
one; `:latest` moves only when a release is cut.

The image takes a command, so it can also do the jobs that are not "serve":

```bash
docker run --rm ghcr.io/jwilleke/yourphr:3.2.0 help      # every command and its flags
docker run --rm ghcr.io/jwilleke/yourphr:3.2.0 version   # which build this actually is
```

At this point you'll be redirected to the login page.

### Logging In

You do not create an account — the first start already made one for you.

```bash
# docker
docker exec yourphr cat /opt/yourphr/data/.admin_bootstrap_password
# or read it from the mounted volume
cat ./data/.admin_bootstrap_password
```

Sign in as `admin` with that password, then change it. The file is deleted once that account has
signed in, so read it before you do.

> [!IMPORTANT]
> __The first start creates your admin account for you.__ It generates a password and writes it to
> `<data>/.admin_bootstrap_password` (mode `0600`); the startup log names the file, never the value.
> Sign in with it once and change it. That account controls configuration, the database (backup,
> restore, download), users, the provider catalog and the logs.
>
> __Self-service signup is closed by default__ (`signup.enabled`). Nobody can register themselves
> until you turn it on at Admin → Configuration, and an instance reachable from the internet is
> safe to leave running while you get to it. Until then, add household members at __Admin →
> Users__. Anyone who does sign up gets an ordinary user account, never an admin.
>
> __If you lose the password__, the image can issue a new one without touching the database:
> `docker run --rm -v "$PWD/data:/opt/yourphr/data" ghcr.io/jwilleke/yourphr:3.2.0 reset-password --user <account> --data /opt/yourphr/data`.
> It writes the new password to `<data>/.recovery_password` and ends that account's sessions.
> See [`docs/deployment/README.md`](docs/deployment/README.md).

## Using with multiple people

> [!NOTE]
> NOTE: Multi-user features are a work in progress. This section describes the eventual goals.

YourPHR is designed to work well for an individual or a family. Since it is self-hosted, by nature the person running the service will have full root access to all user records. For most families, this is perfect! If you need stronger security, YourPHR might not be for you.

YourPHR assumes that all records connected from a single user account (from one or more sources) belong to a single individual, and thus will show aggregations that will only make sense for a single person. Be careful to not connect sources for different people to the same YourPHR user account.

Tracking health data for multiple family members works by creating new user accounts for each person. Any user with the `admin` role can manage users and permissions. Any user can be granted access (by an admin) to view another user's records. Through this mechanism, it's easy to setup any family configuration needed. For example: a family of four can have two parents that can each see the records of the two children.

It is also possible to create users with the `viewer` role that only have access to view records of other users. This can be used to share records with a caregiver.

This allows for a more complex example:

- a family consisting of 2 parents, and 2 children and a caregiver (nurse, babysitter, grandparent).
- both parents need to be able to access both children's records, and maybe each-others
- the caregiver should have view-only access to 1 or both children, but not the parents.

## FAQ's

Have a question? Search [existing issues](https://github.com/jwilleke/yourphr/issues) or open a new one. (A project FAQ will live at [yourphr.org](https://yourphr.org) as YourPHR grows.)

## Support

Have questions? Need help? Found a bug? [Create an issue](https://github.com/jwilleke/yourphr/issues/new) and we'll do our best to help you out.

## Contributing

[![CI](https://github.com/jwilleke/yourphr/actions/workflows/ci.yaml/badge.svg)](https://github.com/jwilleke/yourphr/actions/workflows/ci.yaml)
[![codecov](https://codecov.io/gh/jwilleke/yourphr/branch/main/graph/badge.svg?style=flat-square)](https://codecov.io/gh/jwilleke/yourphr)

Please see the [CONTRIBUTING.md](CONTRIBUTING.md) for instructions for how to develop and contribute to the YourPHR codebase.

Work your magic and then submit a pull request. We love pull requests!

If you find the documentation lacking, help us out and update this README.md. If you don't have the time to work on YourPHR, but found something we should know about, please submit an issue.

## Versioning

We use SemVer for versioning. For the versions available, see the tags on this repository.

## Authors

- Jason Kulatunga - Initial Development - @AnalogJ
- Alex Szilagyi - Co-Author - @alexszilagyi

## Licenses

[![GitHub license](https://img.shields.io/github/license/jwilleke/yourphr?style=flat-square)](https://github.com/jwilleke/yourphr/blob/main/LICENSE.md)
