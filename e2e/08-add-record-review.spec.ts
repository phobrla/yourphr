import { expect, test, type Page } from '@playwright/test';
import { BASE, login, trackPageErrors } from './helpers.js';
import { E2E_PASS, E2E_USER } from './constants.js';
import type { DocumentReference, Encounter, Observation } from '@medplum/fhirtypes';

async function enterVisitReason(page: Page, text: string): Promise<void> {
  await page.locator('#edit-visit-reasons').click();
  await page.fill('#entry-name', text);
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
}

async function enterVisitNote(page: Page, text: string): Promise<void> {
  await page.getByRole('button', {name: /^(Add|Edit) visit note$/, exact: true}).click();
  await page.fill('#visit-note', text);
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
}

test('reason, note and billing modals preserve draft cancellation and save precise visit times and UB-04 codes', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await expect(page.locator('#entry-name')).toHaveCount(0);
  await expect(page.locator('#visit-note')).toHaveCount(0);
  await expect(page.locator('#diagnosis-search-0')).toHaveCount(0);
  await page.locator('#edit-visit-reasons').click();
  const reasons = page.getByRole('dialog', {name: 'Visit reasons and chief complaint', exact: true});
  await expect(reasons.getByRole('button', {name: 'Done', exact: true})).toBeDisabled();
  await page.fill('#entry-name', 'Synthetic complaint with documented onset and context');
  await page.locator('#visit-primary-0').check();
  await reasons.getByRole('button', {name: 'Done', exact: true}).click();
  await page.locator('#edit-visit-reasons').click();
  await page.fill('#entry-name', 'Discard this changed reason');
  await page.locator('#visit-primary-none').check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listitem').filter({hasText: 'Synthetic complaint with documented onset and context'})).toBeVisible();
  await expect(page.getByText('Primary chief complaint', {exact: true})).toBeVisible();
  await enterVisitNote(page, '**Synthetic original note**');
  await page.getByRole('button', {name: 'Edit visit note', exact: true}).click();
  await page.fill('#visit-note', 'Discard this changed note');
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(page.getByText('**Synthetic original note**', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Add billing codes', exact: true}).click();
  const billing = page.getByRole('dialog', {name: 'UB-04 billing codes', exact: true});
  await page.fill('#billing-code-0', '0999');
  await page.fill('#billing-description-0', 'Synthetic billing annotation');
  await billing.getByRole('button', {name: 'Add billing code', exact: true}).click();
  await page.selectOption('#billing-kind-1', 'type-of-bill');
  await page.fill('#billing-code-1', '0999');
  await billing.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByRole('button', {name: 'Edit billing codes', exact: true}).click();
  await page.fill('#billing-code-0', '9999');
  await billing.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(billing).toBeHidden();
  await expect(page.getByText('Revenue: 0999 Synthetic billing annotation', {exact: true})).toBeVisible();
  await page.fill('#visit-type', 'Office');
  await page.selectOption('#visit-setting', 'AMB');
  await page.fill('#vital-date', '2020-04-20');
  await page.fill('#visit-start-time', '09:30');
  await page.fill('#visit-end-date', '2020-04-20');
  await page.fill('#visit-end-time', '10:15');
  const times = await page.locator('body').evaluate(() => [
    new Date('2020-04-20T09:30').toISOString(), new Date('2020-04-20T10:15').toISOString(),
  ]);
  const saving = page.waitForResponse(response => response.url().endsWith('/api/secure/resource/patient-entry')
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record', exact: true}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {data: {source_id: string; source_resource_id: string}}).data;
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  const encounter = (await readback.json() as {data: {resource_raw: Encounter}}).data.resource_raw;
  expect(encounter.period).toEqual({start: times[0], end: times[1]});
  expect(encounter.extension?.filter(entry => entry.url.endsWith('/encounter-billing-code')).map(entry => entry.valueCoding)).toEqual([
    {system: 'https://www.nubc.org/CodeSystem/RevenueCodes', code: '0999', display: 'Synthetic billing annotation'},
    {system: 'https://www.nubc.org/CodeSystem/TypeOfBill', code: '0999'},
  ]);
  await page.getByRole('button', {name: 'View in Explore', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Visit billing codes'})).toContainText('Revenue: 0999');
  await expect(page.getByRole('region', {name: 'Visit billing codes'})).toContainText('Type of bill: 0999');
  const refused = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {data: {
    kind: 'visit', name: 'Synthetic invalid billing', visit_type: 'Office', visit_class: 'AMB',
    visit_billing: [{kind: 'revenue', code: '999'}],
  }});
  expect(refused.status()).toBe(400);
});

// yourphr#696 / #762. "Add record" is a primary button in three places and, until v3.6.0, its form
// 404'd on submit — no test noticed, because none drove the page. These do.
//
// The second journey is the one that matters for the rule Jim set: what a person says is KEPT even
// when it cannot be fully understood, and is then held out of the chart until they confirm it. That
// is only honest if they can find it, so this walks the whole path: enter half a reading, be told,
// find it waiting, confirm it, and see it counted.

test('the add-record deep link loads and reloads independently of navigation', async ({ page }) => {
  const errors = trackPageErrors(page);
  const failedAssets: string[] = [];
  page.on('response', response => {
    if (/\.(?:js|css)(?:\?|$)/.test(response.url()) && !response.ok()) {
      failedAssets.push(response.url());
    }
  });
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await expect(page.locator('#entry-kind')).toBeVisible();
  await page.reload();
  await expect(page.locator('#entry-kind')).toBeVisible();
  expect(await page.locator('base').getAttribute('href')).toBe('/');
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});

test('visit terminology hints appear beside labels on hover and keyboard focus', async ({ page }) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await page.locator('.visit-details > summary').click();
  for (const [field, name, hint] of [
    ['visit-setting', 'About visit class terminology', 'Mapped to HL7 ActCode encounter class'],
    ['visit-status', 'About visit status terminology', 'Mapped to FHIR EncounterStatus (required by FHIR)'],
    ['visit-location-type', 'About location type terminology', /Mapped to SNOMED CT \(Systematized Nomenclature of Medicine - Clinical Terms\).*kind of place.*FHIR Location.*Location name.*free text alone does not assign a SNOMED CT code\./],
    ['visit-disposition', 'About discharge disposition terminology', /Mapped to SNOMED CT \(Systematized Nomenclature of Medicine - Clinical Terms\).*where you went or were transferred.*FHIR Encounter.*Discharge details.*free text alone does not assign a SNOMED CT code\./],
  ] as const) {
    const icon = page.getByRole('button', {name, exact: true});
    await expect(page.locator(`label[for="${field}"] + button`)).toHaveAttribute('aria-label', name);
    await icon.hover();
    await expect(page.getByRole('tooltip')).toHaveText(hint);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await icon.focus();
    await expect(page.getByRole('tooltip')).toHaveText(hint);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await expect(page.locator('small').filter({hasText: /SNOMED CT|HL7 ActCode|FHIR EncounterStatus/})).toHaveCount(0);
  const diagnosisInfo = page.getByRole('button', {name: 'About discrete encounter diagnoses', exact: true});
  await page.locator('#edit-visit-diagnoses').click();
  const diagnosisHint = 'Search ICD-9-CM or ICD-10-CM by code or description, or enter a code from your records manually. Suggestions use bundled CDC/CMS lists; nothing you type is sent to a third party. These diagnoses belong to this visit, not your longitudinal problem list. Expected end dates are estimates, not actual resolution dates.';
  await expect(page.locator('h6 + button[aria-label="About discrete encounter diagnoses"]')).toBeVisible();
  await expect(page.locator('p').filter({hasText: 'Suggestions use bundled CDC/CMS lists'})).toHaveCount(0);
  await diagnosisInfo.hover();
  await expect(page.getByRole('tooltip')).toHaveText(diagnosisHint);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await diagnosisInfo.focus();
  await expect(page.getByRole('tooltip')).toHaveText(diagnosisHint);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('visit fields preserve aligned grid rows and keep info icons with their labels', async ({ page }) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  const optionalDetails = page.locator('.visit-details');
  await expect(optionalDetails).not.toHaveAttribute('open');
  await page.locator('.visit-details > summary').click();
  for (const width of [1440, 1024]) {
    await page.setViewportSize({width, height: 1000});
    for (const row of [
      ['visit-setting', 'visit-status', 'visit-provider', 'visit-organization'],
      ['visit-identifier', 'visit-location-type', 'visit-location', 'visit-disposition'],
    ]) {
      const tops = await Promise.all(row.map(async id => {
        const control = page.locator(`#${id}`);
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        return box!.y;
      }));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    }
    const cards = page.locator('.visit-clinical-grid > .visit-summary');
    await expect(cards).toHaveCount(5);
    const [left, right, notes, grid] = await Promise.all([
      cards.nth(0).boundingBox(), cards.nth(1).boundingBox(),
      page.locator('.visit-notes-summary').boundingBox(), page.locator('.visit-clinical-grid').boundingBox(),
    ]);
    expect(left!.y).toBe(right!.y);
    expect(right!.x).toBeGreaterThan(left!.x);
    expect(notes!.width).toBeCloseTo(grid!.width, 0);
  }
  await page.setViewportSize({width: 390, height: 844});
  const mobileCards = await page.locator('.visit-clinical-grid > .visit-summary').evaluateAll(cards =>
    cards.map(card => ({x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y})));
  expect(new Set(mobileCards.map(card => card.x)).size).toBe(1);
  expect(mobileCards[1]!.y).toBeGreaterThan(mobileCards[0]!.y);
  for (const id of ['visit-setting', 'visit-status', 'visit-location-type', 'visit-disposition']) {
    const label = await page.locator(`label[for="${id}"]`).boundingBox();
    const icon = await page.locator(`label[for="${id}"] + button i`).boundingBox();
    expect(label).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(icon!.x).toBeGreaterThanOrEqual(label!.x + label!.width);
    expect(icon!.y).toBeLessThan(label!.y + label!.height);
    expect(icon!.y + icon!.height).toBeGreaterThan(label!.y);
  }
  expect(await page.locator('form').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('multiple visit reasons keep one primary chief complaint and one coded type through save and display', async ({page}) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await enterVisitReason(page, 'Synthetic results review');
  await page.selectOption('#visit-type-code', '185389009');
  await expect(page.locator('#visit-type')).toHaveValue('Follow-up consultation');
  await expect(page.locator('#visit-type')).toBeDisabled();
  await page.selectOption('#visit-setting', 'AMB');
  await page.locator('#edit-visit-reasons').click();
  await page.getByRole('dialog').getByRole('button', {name: 'Add visit reason', exact: true}).click();
  await page.getByRole('dialog').locator('details').last().locator('summary').click();
  await page.selectOption('#visit-reason-code-0', '25064002');
  await page.fill('#visit-reason-text-0', 'Synthetic headache complaint');
  await page.locator('#visit-primary-1').check();
  await expect(page.locator('#visit-primary-0')).not.toBeChecked();
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
  const saving = page.waitForResponse(response =>
    response.url().endsWith('/api/secure/resource/patient-entry') && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record', exact: true}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {data:{source_id:string;source_resource_id:string}}).data;
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  const encounter = (await readback.json() as {data:{resource_raw:Encounter}}).data.resource_raw;
  expect(encounter.type).toHaveLength(1);
  expect(encounter.type?.[0]?.coding?.[0]).toMatchObject({system: 'http://snomed.info/sct', code: '185389009'});
  expect(encounter.reasonCode).toEqual([
    {text: 'Synthetic results review'},
    {text: 'Synthetic headache complaint', coding: [{system: 'http://snomed.info/sct', code: '25064002', display: 'Headache'}]},
  ]);
  expect(encounter.reasonReference).toEqual([{reference: '#chief-complaint', display: 'Synthetic headache complaint'}]);
  expect(encounter.contained?.find(item => item.id === 'chief-complaint')).toMatchObject({
    resourceType: 'Observation', valueString: 'Synthetic headache complaint',
    code: {coding: [{system: 'http://loinc.org', code: '10154-3'}]}, encounter: {reference: '#'},
  });
  await page.getByRole('button', {name: 'View in Explore'}).click();
  await expect(page.locator('fhir-encounter')).toContainText('Synthetic results review');
  await expect(page.locator('fhir-encounter')).toContainText('Primary chief complaint');
  await expect(page.locator('fhir-encounter')).toContainText('Synthetic headache complaint');
  expect(errors).toEqual([]);
});

test('a home vital saves, and says so', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  await page.selectOption('#vital-type', 'heart_rate');
  await page.fill('#vital-value', '64');
  await page.getByRole('button', { name: /save/i }).click();

  await expect(page.getByText(/Saved: Heart rate 64/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('visit outline buttons retain readable contrast on hover and focus in both themes', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await page.locator('#edit-visit-diagnoses').click();
  await page.getByRole('button', {name: 'Add ICD diagnosis'}).click();
  await page.fill('#diagnosis-search-0', 'j069');
  await page.getByRole('option', {name: 'J06.9 - Acute upper respiratory infection, unspecified', exact: true}).click();

  for (const theme of ['light-theme', 'dark-theme']) {
    await page.locator('body').evaluate((body, theme) => {
      body.classList.remove('light-theme', 'dark-theme');
      body.classList.add(theme);
    }, theme);
    for (const selector of ['#add-visit-diagnosis', '[aria-label="Clear selection for diagnosis 1"]', '[aria-label="Remove diagnosis 1"]']) {
      const button = page.locator(selector);
      for (const state of ['hover', 'focus']) {
        if (state === 'hover') {
          await button.hover();
        } else {
          await page.mouse.move(0, 0);
          await button.focus();
        }
        const colors = await button.evaluate((element) => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element);
          const luminance = (color: string) => {
            const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
              const normalized = value / 255;
              return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return channels.reduce((total, channel, index) => total + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
          };
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return {
            color: style.color, background: style.backgroundColor,
            contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
          };
        });
        expect(colors.background, `${theme} ${selector} ${state}`).not.toBe('rgba(0, 0, 0, 0)');
        expect(colors.contrast, `${theme} ${selector} ${state}: ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);
        await button.blur();
      }
    }
  }

  await page.getByRole('button', {name: 'Add ICD diagnosis'}).click();
  await page.mouse.move(0, 0);
  const focusedBackground = await page.locator('#add-visit-diagnosis').evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor);
  expect(focusedBackground).not.toBe('rgba(0, 0, 0, 0)');
});

test('a visit saves its coded location and discharge disposition and retains them on readback', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await enterVisitReason(page, 'Synthetic terminology follow-up');
  await page.fill('#visit-type', 'Consultation');
  await page.selectOption('#visit-setting', 'AMB');
  await page.selectOption('#visit-status', 'finished');
  await page.locator('.visit-details > summary').click();
  await page.selectOption('#visit-location-type', '33022008');
  await page.fill('#visit-location', 'Synthetic cardiology department');
  await page.selectOption('#visit-disposition', '306689006');
  await page.fill('#visit-disposition-text', 'Home with family transport');

  const savedResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/secure/resource/patient-entry') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /save/i }).click();
  const response = await savedResponse;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {
    data: { source_id: string; source_resource_id: string };
  }).data;
  await expect(page.getByText('Saved: Synthetic terminology follow-up.', { exact: false })).toBeVisible();

  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  expect(readback.status()).toBe(200);
  const resource = (await readback.json() as { data: { resource_raw: Encounter } }).data.resource_raw;
  expect(resource).toMatchObject({
    resourceType: 'Encounter',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    contained: [{
      resourceType: 'Location', id: 'visit-location', name: 'Synthetic cardiology department',
      type: [{ coding: [
        { system: 'http://snomed.info/sct', code: '33022008', display: 'Hospital-based outpatient department' },
        { system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode', code: 'OF', display: 'Outpatient facility' },
      ] }],
    }],
    location: [{ location: { reference: '#visit-location', display: 'Synthetic cardiology department' } }],
    hospitalization: { dischargeDisposition: {
      coding: [{ system: 'http://snomed.info/sct', code: '306689006', display: 'Discharge to home' }],
      text: 'Home with family transport',
    } },
  });
  expect(errors).toEqual([]);
});

test('visit dates are near the top and formatted notes survive FHIR save/readback and display', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  const start = await page.locator('#vital-date').boundingBox();
  const end = await page.locator('#visit-end-date').boundingBox();
  const reason = await page.locator('#edit-visit-reasons').boundingBox();
  expect(start!.y).toBeLessThan(reason!.y);
  expect(end!.y).toBeLessThan(reason!.y);
  const editor = page.locator('#visit-note');
  await enterVisitReason(page, 'Synthetic formatted note visit');
  await page.getByRole('button', {name: 'Add visit note', exact: true}).click();
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(240);
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.fill('#visit-type', 'Follow-up');
  await page.selectOption('#visit-setting', 'AMB');
  await page.getByRole('button', {name: 'Add visit note', exact: true}).click();
  await editor.fill('Follow-up');
  await editor.selectText();
  await page.getByRole('button', {name: 'Bold', exact: true}).click();
  await expect(editor).toHaveValue('**Follow-up**');
  await editor.fill('## Plan\n\n**Follow-up** and *rest*.\n\n- Hydration\n- Sleep\n\n1. Review\n2. Return\n\n> Patient-reported\n\n[Reference](https://example.org)\n\n`code`\n\n| Item | Detail |\n| --- | --- |\n| Rest | Home |\n\n---\n\nLine one  \nLine two');
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
  const saving = page.waitForResponse(response =>
    response.url().endsWith('/api/secure/resource/patient-entry') && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record'}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {data:{source_id:string;source_resource_id:string}}).data;
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  const resource = (await readback.json() as {data:{resource_raw:Encounter}}).data.resource_raw;
  expect(resource.text?.status).toBe('additional');
  const narrative = resource.text?.div ?? '';
  expect(narrative).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  for (const tag of ['h2', 'strong', 'em', 'ul', 'ol', 'blockquote', 'a', 'code', 'table']) {
    expect(narrative).toContain(`<${tag}`);
  }
  expect(narrative).toContain('<hr />');
  expect(narrative).toContain('<br />');
  const xmlErrors = await page.locator('body').evaluate((body, xhtml) => {
    const parser = new body.ownerDocument.defaultView!.DOMParser();
    return parser.parseFromString(xhtml, 'application/xhtml+xml').getElementsByTagName('parsererror').length;
  }, narrative);
  expect(xmlErrors).toBe(0);
  await page.getByRole('button', {name: 'View in Explore'}).click();
  const note = page.getByRole('region', {name: 'Visit note'});
  await expect(note.locator('strong')).toHaveText('Follow-up');
  await expect(note.locator('h2')).toHaveText('Plan');
  await expect(note.locator('table')).toContainText('Home');
});

test('formatted notes reject raw HTML, unsafe links, images and unsupported formats', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  for (const extra of [
    {note: '<script>alert(1)</script>', note_format: 'markdown'},
    {note: '[bad](javascript:alert)', note_format: 'markdown'},
    {note: '![remote](https://example.org/image.png)', note_format: 'markdown'},
    {note: 'text', note_format: 'html'},
    {note: {text: 'wrong shape'}, note_format: 'markdown'},
  ]) {
    const response = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {
      data: {kind: 'visit', name: 'Synthetic unsafe note', visit_type: 'Office', visit_class: 'AMB', ...extra},
    });
    expect(response.status()).toBe(400);
    expect((await response.json() as {success:boolean;error:string}).success).toBe(false);
  }
});

    test('visit measurements save with the encounter and display PHQ zero, LNMP and paired blood pressure', async ({page}) => {
      const errors = trackPageErrors(page);
      await login(page, E2E_USER, E2E_PASS);
      await page.goto(`${BASE}/resource/add`);
      await page.selectOption('#entry-kind', 'visit');
      await enterVisitReason(page, 'Synthetic measured visit');
      await page.fill('#visit-type', 'Office visit');
      await page.selectOption('#visit-setting', 'AMB');
      await page.fill('#vital-date', '2020-04-20');
      for (const [index, kind] of ['body_height', 'blood_pressure', 'phq2', 'phq9', 'lnmp'].entries()) {
        await page.getByRole('button', {name: 'Add visit measurement', exact: true}).click();
        await page.selectOption(`#visit-observation-kind-${index}`, kind);
      }
      await page.fill('#visit-observation-value-0', '172');
      await page.fill('#visit-observation-note-0', 'Standing height');
      await page.fill('#visit-observation-systolic-1', '122');
      await page.fill('#visit-observation-diastolic-1', '78');
      await page.fill('#visit-observation-value-2', '0');
      await page.fill('#visit-observation-value-3', '27');
      await expect(page.locator('#visit-observation-unit-2')).toBeDisabled();
      await page.fill('#visit-observation-date-4', '2020-04-04');
      await page.fill('#visit-observation-measured-4', '2020-04-19');

      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({width, height: 1000});
        expect(await page.locator('body').evaluate(body =>
          body.ownerDocument.documentElement.scrollWidth <= body.ownerDocument.documentElement.clientWidth)).toBe(true);
        if (width >= 1024) {
          const controls = await Promise.all(['kind-0', 'value-0', 'unit-0', 'measured-0']
            .map(id => page.locator(`#visit-observation-${id}`).boundingBox()));
          const bottoms = controls.map(box => box!.y + box!.height);
          expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(2);
        }
      }
      await page.setViewportSize({width: 1440, height: 1000});
      await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByText('PHQ-2 total score: 0 {score}', {exact: true})).toBeVisible();
      const saving = page.waitForResponse(response =>
        response.url().endsWith('/api/secure/resource/patient-entry') && response.request().method() === 'POST');
      await page.getByRole('button', {name: 'Save record'}).click();
      const response = await saving;
      expect(response.status()).toBe(200);
      const saved = (await response.json() as {data: {source_id: string; source_resource_id: string; needs_review: string[]}}).data;
      expect(saved.needs_review).toEqual([]);
      const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
      expect(readback.status()).toBe(200);
      const encounter = (await readback.json() as {data: {resource_raw: Encounter}}).data.resource_raw;
      const measurements = (encounter.contained ?? []).filter((item): item is Observation => item.resourceType === 'Observation');
      expect(measurements).toHaveLength(5);
      expect(measurements[0]).toMatchObject({code: {coding: [{code: '8302-2'}]}, valueQuantity: {value: 172, code: 'cm'}, note: [{text: 'Standing height'}]});
      expect(measurements[1]?.component?.map(component => component.valueQuantity?.value)).toEqual([122, 78]);
      expect(measurements[2]).toMatchObject({code: {coding: [{code: '55758-7'}]}, valueQuantity: {value: 0}, effectiveDateTime: '2020-04-20'});
      expect(measurements[3]).toMatchObject({code: {coding: [{code: '44261-6'}]}, valueQuantity: {value: 27}});
      expect(measurements[4]).toMatchObject({code: {coding: [{code: '8665-2'}]}, valueDateTime: '2020-04-04', effectiveDateTime: '2020-04-19'});
      expect(encounter.extension).toHaveLength(5);
      await page.getByRole('button', {name: 'View in Explore'}).click();
      const section = page.getByRole('region', {name: 'Visit measurements'});
      await expect(section).toContainText('172 cm');
      await expect(section).toContainText('Systolic blood pressure: 122 mm[Hg]');
      await expect(section).toContainText('Diastolic blood pressure: 78 mm[Hg]');
      await expect(section).toContainText('0 score');
      await expect(section).toContainText('27 score');
      await expect(section).toContainText('2020-04-04');
      expect(errors).toEqual([]);
    });

    test('the visit measurement API rejects invalid PHQ totals, missing readings and impossible LNMP dates', async ({page}) => {
      await login(page, E2E_USER, E2E_PASS);
      for (const entry of [
        {kind: 'phq2', value: 7}, {kind: 'phq9', value: 28}, {kind: 'phq9', value: 1.5},
        {kind: 'body_weight'}, {kind: 'lnmp', date: '2020-02-30'},
      ]) {
        const response = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {
          data: {kind: 'visit', name: 'Synthetic invalid measurements', visit_type: 'Office', visit_class: 'AMB', visit_observations: [entry]},
        });
        expect(response.status()).toBe(400);
        expect(await response.json()).toMatchObject({success: false, error: expect.any(String)});
      }
    });

test('LOINC labs and explicit note providers survive FHIR save, readback and display', async ({page}) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  for (const [id, name] of [['e2e-note-author', 'Synthetic Author, MD'], ['e2e-note-contributor', 'Synthetic Contributor, RN']]) {
    const created = await page.request.post(`${BASE}/api/secure/practitioners`, {
      data: {resource: {resourceType: 'Practitioner', id, name: [{text: name}]}},
    });
    expect(created.ok()).toBe(true);
  }
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await enterVisitReason(page, 'Synthetic labs and attributed note');
  await page.fill('#visit-type', 'Office visit');
  await page.selectOption('#visit-setting', 'AMB');
  await page.fill('#vital-date', '2020-04-20');
  await page.getByRole('button', {name: 'Add lab result', exact: true}).click();
  await page.selectOption('#visit-lab-selection-0', '2345-7');
  await expect(page.locator('#visit-lab-code-0')).toBeDisabled();
  await expect(page.locator('#visit-lab-display-0')).toBeDisabled();
  await page.fill('#visit-lab-value-0', '0');
  await page.selectOption('#visit-lab-comparator-0', '<');
  await page.fill('#visit-lab-unit-0', 'mg/dL');
  await page.fill('#visit-lab-ucum-0', 'mg/dL');
  await page.selectOption('#visit-lab-status-0', 'final');
  await page.fill('#visit-lab-collected-0', '2020-04-21');
  await page.fill('#visit-lab-issued-0', '2020-04-23T12:30');
  await page.fill('#visit-lab-specimen-0', 'Serum');
  await page.fill('#visit-lab-range-0', '70-99 mg/dL');
  await page.fill('#visit-lab-laboratory-0', 'Synthetic laboratory');
  await page.getByRole('button', {name: 'Add lab result', exact: true}).click();
  await page.fill('#visit-lab-code-1', '2160-0');
  await page.fill('#visit-lab-display-1', 'Synthetic manually coded result');
  await page.selectOption('#visit-lab-result-type-1', 'text');
  await page.fill('#visit-lab-text-1', 'Not detected');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.getByRole('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    if (width >= 1024) {
      const boxes = await Promise.all(['selection', 'code', 'display'].map(field => page.locator(`#visit-lab-${field}-0`).boundingBox()));
      const bottoms = boxes.map(box => box!.y + box!.height);
      expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(2);
    }
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', {name: 'Add visit note', exact: true}).click();
  await page.fill('#visit-note', '## Synthetic note\n\n**Complete note body**.\n\n- Source wording retained');
  await page.getByRole('button', {name: 'Add note author', exact: true}).click();
  await page.selectOption('#visit-note-author-0', 'e2e-note-author');
  await page.getByRole('button', {name: 'Add note author', exact: true}).click();
  await page.selectOption('#visit-note-author-1', 'e2e-note-contributor');
  await page.fill('#visit-note-authored', '2020-04-20');
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', {name: 'About note provider attribution'}).hover();
  await expect(page.getByRole('tooltip')).toContainText('not a verified provider signature');
  await page.locator('#edit-visit-reasons').hover();
  await page.locator('#edit-visit-reasons').focus();
  await page.getByRole('button', {name: 'About LOINC laboratory results'}).focus();
  await expect(page.getByRole('tooltip').filter({hasText: 'not a full LOINC catalog'})).toBeVisible();
  await page.locator('#edit-visit-reasons').focus();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.locator('body').evaluate(body =>
      body.ownerDocument.documentElement.scrollWidth <= body.ownerDocument.documentElement.clientWidth)).toBe(true);
  }
  await page.setViewportSize({width: 1440, height: 1000});
  const saving = page.waitForResponse(response => response.url().endsWith('/api/secure/resource/patient-entry')
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Save record'}).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {data: {source_id: string; source_resource_id: string}}).data;
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  expect(readback.status()).toBe(200);
  const encounter = (await readback.json() as {data: {resource_raw: Encounter}}).data.resource_raw;
  const labs = (encounter.contained ?? []).filter((item): item is Observation => item.resourceType === 'Observation');
  expect(labs).toHaveLength(2);
  expect(labs[0]).toMatchObject({
    category: [{coding: [{code: 'laboratory'}]}], code: {coding: [{system: 'http://loinc.org', code: '2345-7'}]},
    valueQuantity: {value: 0, comparator: '<', unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL'},
    effectiveDateTime: '2020-04-21', referenceRange: [{text: '70-99 mg/dL'}], performer: [{display: 'Synthetic laboratory'}],
    specimen: {reference: '#visit-lab-specimen-1'},
  });
  expect(labs[0]?.issued).toMatch(/^2020-04-23T/);
  expect(labs[1]?.valueString).toBe('Not detected');
  expect(labs[1]?.effectiveDateTime).toBeUndefined();
  const document = encounter.contained?.find(item => item.resourceType === 'DocumentReference') as DocumentReference;
  expect(document.author).toEqual([{reference: 'Practitioner/e2e-note-author', display: 'Synthetic Author, MD'},
    {reference: 'Practitioner/e2e-note-contributor', display: 'Synthetic Contributor, RN'}]);
  expect(document.content[0]?.attachment.creation).toBe('2020-04-20');
  expect(Buffer.from(document.content[0]!.attachment.data!, 'base64').toString('utf8')).toBe(encounter.text?.div);
  expect(document.authenticator).toBeUndefined();
  expect(document.meta?.source).toBe('yourphr://patient-ui');
  await page.getByRole('button', {name: 'View in Explore'}).click();
  const results = page.getByRole('region', {name: 'Visit laboratory results'});
  await expect(results).toContainText('LOINC 2345-7');
  await expect(results).toContainText('<0 mg/dL');
  await expect(results).toContainText('Not detected');
  await expect(results).toContainText('Specimen: Serum');
  await expect(results).toContainText('Reference range: 70-99 mg/dL');
  const note = page.getByRole('region', {name: 'Visit note'});
  await expect(note).toContainText('Synthetic Author, MD; Synthetic Contributor, RN');
  await expect(note).toContainText('not a verified provider signature');
  await expect(note.locator('strong').filter({hasText: 'Complete note body'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('invalid laboratory results and note attribution are explicitly refused by the API', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  for (const extra of [
    {visit_labs: [{code: 'invalid', display: 'Synthetic', result_type: 'quantity', value: 0, status: 'final'}]},
    {visit_labs: [{code: '2345-7', display: 'Synthetic', result_type: 'text', status: 'unknown'}]},
    {visit_note_authors: [{name: 'Synthetic Author, MD'}]},
    {note: 'Synthetic note', visit_note_authored: '2020-02-30'},
  ]) {
    const response = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {
      data: {kind: 'visit', name: 'Synthetic invalid labs', visit_type: 'Office', visit_class: 'AMB', ...extra},
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({success: false, error: expect.any(String)});
  }
});

    test('visit dialogs keep the page compact, trap focus and roll back canceled draft changes', async ({page}) => {
      await login(page, E2E_USER, E2E_PASS);
      await page.goto(`${BASE}/resource/add`);
      await page.selectOption('#entry-kind', 'visit');
      await enterVisitNote(page, 'Synthetic unsaved note');
      await expect(page.locator('#visit-lab-value-0')).toHaveCount(0);
      await expect(page.locator('#visit-observation-kind-0')).toHaveCount(0);
      const requests: string[] = [];
      page.on('request', request => {if (request.method() === 'POST') requests.push(request.url());});
      const addLab = page.getByRole('button', {name: 'Add lab result', exact: true});
      await addLab.click();
      const dialog = page.getByRole('dialog', {name: 'Laboratory results', exact: true});
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', {name: 'Done', exact: true})).toBeDisabled();
      await dialog.getByRole('button', {name: 'Done', exact: true}).focus();
      await page.keyboard.press('Tab');
      expect(await page.getByRole('dialog').evaluate(element => element.contains(element.ownerDocument.activeElement))).toBe(true);
      await page.selectOption('#visit-lab-selection-0', '2345-7');
      await page.fill('#visit-lab-value-0', '0');
      await dialog.getByRole('button', {name: 'Done', exact: true}).click();
      await expect(dialog).toBeHidden();
      await expect(addLab).toHaveCount(0);
      await expect(page.getByText('Glucose [Mass/volume] in Serum or Plasma (2345-7): 0', {exact: true})).toBeVisible();
      await page.setViewportSize({width: 390, height: 844});
      const editLabs = page.getByRole('button', {name: 'Edit lab results', exact: true});
      await editLabs.click();
      await page.fill('#visit-lab-value-0', '99');
      await page.getByRole('button', {name: 'Add lab result', exact: true}).click();
      const layout = await dialog.evaluate(element => {
        const body = element.querySelector('.modal-body')!;
        const footer = element.querySelector('.modal-footer')!;
        return {
          scrolls: body.scrollHeight > body.clientHeight,
          footerBottom: footer.getBoundingClientRect().bottom,
          pageWidth: element.ownerDocument.documentElement.scrollWidth,
        };
      });
      expect(layout.scrolls).toBe(true);
      expect(layout.footerBottom).toBeLessThanOrEqual(844);
      expect(layout.pageWidth).toBeLessThanOrEqual(390);
      await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
      await expect(dialog).toBeHidden();
      await expect(editLabs).toBeFocused();
      await editLabs.click();
      await expect(page.locator('#visit-lab-value-0')).toHaveValue('0');
      await expect(page.locator('#visit-lab-value-1')).toHaveCount(0);
      await page.getByRole('button', {name: 'Remove lab result 1', exact: true}).click();
      expect(await dialog.evaluate(element => element.contains(element.ownerDocument.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(editLabs).toBeVisible();
      await page.getByRole('button', {name: 'Add visit measurement', exact: true}).click();
      await page.fill('#visit-observation-value-0', '68');
      await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
      await expect(page.getByRole('button', {name: 'Edit measurements', exact: true})).toHaveCount(0);
      await page.getByRole('button', {name: 'Edit visit note', exact: true}).click();
      const noteDialog = page.getByRole('dialog', {name: 'Visit note', exact: true});
      await expect(noteDialog.locator('#visit-note-authored')).toBeVisible();
      expect(await noteDialog.evaluate(dialog => {
        const editor = dialog.querySelector('#visit-note')!;
        const attribution = dialog.querySelector('fieldset')!;
        return !!(editor.compareDocumentPosition(attribution) & editor.DOCUMENT_POSITION_FOLLOWING);
      })).toBe(true);
      await page.getByRole('button', {name: 'Add note author', exact: true}).click();
      await expect(page.locator('#visit-note-author-0')).toBeVisible();
      await page.getByRole('button', {name: 'Close visit note dialog', exact: true}).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByText('Synthetic unsaved note', {exact: true})).toBeVisible();
      expect(requests).toEqual([]);
    });

    test('multiple visit notes use provider selections and preserve independent documents and authors', async ({page}) => {
      await login(page, E2E_USER, E2E_PASS);
      for (const [id, name] of [['e2e-first-note-provider', 'First Synthetic Provider'], ['e2e-second-note-provider', 'Second Synthetic Provider']]) {
        const created = await page.request.post(`${BASE}/api/secure/practitioners`, {data: {
          resource: {resourceType: 'Practitioner', id, name: [{text: name}]},
        }});
        expect(created.ok()).toBe(true);
      }
      await page.goto(`${BASE}/resource/add`);
      await page.selectOption('#entry-kind', 'visit');
      await enterVisitReason(page, 'Synthetic multiple notes visit');
      await page.fill('#visit-type', 'Office');
      await page.selectOption('#visit-setting', 'AMB');
      await enterVisitNote(page, '**First note body**');
      await expect(page.getByRole('button', {name: 'Edit note attribution', exact: true})).toHaveCount(0);
      await page.getByRole('button', {name: 'Edit visit note', exact: true}).click();
      await page.getByRole('button', {name: 'Add note author', exact: true}).click();
      await page.selectOption('#visit-note-author-0', 'e2e-first-note-provider');
      await page.fill('#visit-note-authored', '2020-04-20');
      await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();
      await page.getByRole('button', {name: 'Add another note', exact: true}).click();
      const modal = page.getByRole('dialog', {name: 'Additional visit notes', exact: true});
      await expect(modal).toBeVisible();
      await page.getByRole('button', {name: 'Add author to additional note 1', exact: true}).click();
      await page.selectOption('#additional-note-author-0-0', 'e2e-second-note-provider');
      await page.fill('#additional-note-authored-0', '2020-04-22');
      const editor = page.locator('#additional-note-text-0');
      await editor.fill('Second note body');
      await editor.selectText();
      await modal.getByRole('button', {name: 'Bold', exact: true}).click();
      await expect(editor).toHaveValue('**Second note body**');
      await modal.getByRole('button', {name: 'Done', exact: true}).click();
      await expect(page.getByText('**First note body**', {exact: true})).toBeVisible();
      const saving = page.waitForResponse(response => response.url().endsWith('/api/secure/resource/patient-entry')
        && response.request().method() === 'POST');
      await page.getByRole('button', {name: 'Save record', exact: true}).click();
      const response = await saving;
      expect(response.status()).toBe(200);
      const saved = (await response.json() as {data: {source_id: string; source_resource_id: string}}).data;
      const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
      const encounter = (await readback.json() as {data: {resource_raw: Encounter}}).data.resource_raw;
      const documents = (encounter.contained ?? []).filter((item): item is DocumentReference => item.resourceType === 'DocumentReference');
      expect(documents).toHaveLength(2);
      expect(documents[0]?.author).toEqual([{reference: 'Practitioner/e2e-first-note-provider', display: 'First Synthetic Provider'}]);
      expect(documents[1]?.author).toEqual([{reference: 'Practitioner/e2e-second-note-provider', display: 'Second Synthetic Provider'}]);
      expect(documents.map(doc => doc.content[0]?.attachment.creation)).toEqual(['2020-04-20', '2020-04-22']);
      expect(Buffer.from(documents[0]!.content[0]!.attachment.data!, 'base64').toString()).toContain('<strong>First note body</strong>');
      expect(Buffer.from(documents[1]!.content[0]!.attachment.data!, 'base64').toString()).toContain('<strong>Second note body</strong>');
      await page.getByRole('button', {name: 'View in Explore', exact: true}).click();
      await expect(page.getByRole('region', {name: 'Visit note', exact: true})).toContainText('First Synthetic Provider');
      await expect(page.getByRole('region', {name: 'Additional visit note 1', exact: true})).toContainText('Second Synthetic Provider');
      await expect(page.getByRole('region', {name: 'Additional visit note 1', exact: true}).locator('strong').filter({hasText: 'Second note body'})).toBeVisible();

      const canonical = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {data: {
        kind: 'visit', name: 'Synthetic canonical author check', visit_type: 'Office', visit_class: 'AMB',
        visit_notes: [{note: 'Synthetic', authors: [{provider_id: 'e2e-first-note-provider', name: 'Spoofed display'}]}],
      }});
      expect(canonical.status()).toBe(200);
      const canonicalResource = (await canonical.json() as {data: {resource: Encounter}}).data.resource;
      expect((canonicalResource.contained?.[0] as DocumentReference).author?.[0]?.display).toBe('First Synthetic Provider');
      for (const note of [
        {note: 'Synthetic', authors: [{provider_id: 'not-my-provider', name: 'Invalid'}]},
        {note: '<script>unsafe</script>', note_format: 'markdown'},
        {note: '![external](https://example.org/image.png)', note_format: 'markdown'},
      ]) {
        const refused = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {data: {
          kind: 'visit', name: 'Synthetic invalid note', visit_type: 'Office', visit_class: 'AMB', visit_notes: [note],
        }});
        expect(refused.status()).toBe(400);
      }
    });

test('multiple ICD diagnoses retain independent expected dates on save, readback, and display', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await enterVisitReason(page, 'Synthetic ICD diagnosis visit');
  await page.fill('#visit-type', 'Synthetic consultation');
  await page.selectOption('#visit-setting', 'AMB');
  await page.locator('.visit-details > summary').click();
  await page.selectOption('#visit-location-type', '22232009');
  await page.locator('#edit-visit-diagnoses').click();
  await expect(page.locator('#visit-diagnoses option', {hasText: 'Synthetic linked diagnosis'})).toHaveCount(1);
  await page.selectOption('#visit-diagnoses', {label: 'Synthetic linked diagnosis'});
  await page.fill('#diagnosis-end-e2e-linked-condition', '2026-11-01');
  await page.getByRole('button', {name: 'Add ICD diagnosis'}).click();
  await page.fill('#diagnosis-search-0', 'j069');
  await page.getByRole('option', {name: 'J06.9 - Acute upper respiratory infection, unspecified', exact: true}).click();
  await expect(page.locator('#diagnosis-code-0')).toHaveValue('J06.9');
  for (const field of ['system', 'code', 'description']) {
    await expect(page.locator(`#diagnosis-${field}-0`)).toBeDisabled();
  }
  await expect(page.locator('#diagnosis-end-new-0')).toBeEnabled();
  await expect(page.locator('#diagnosis-description-0')).toHaveValue('Acute upper respiratory infection, unspecified');
  await page.fill('#diagnosis-end-new-0', '2026-10-12');
  await page.getByRole('button', {name: 'Add ICD diagnosis'}).click();
  await page.selectOption('#diagnosis-system-1', 'http://hl7.org/fhir/sid/icd-9-cm');
  await page.fill('#diagnosis-search-1', 'upper respiratory unspecified');
  await page.getByRole('option', {name: '465.9 - Acute upper respiratory infections of unspecified site', exact: true}).click();
  await expect(page.locator('#diagnosis-code-1')).toHaveValue('465.9');
  await page.fill('#diagnosis-end-new-1', '2026-10-14');
  await page.getByRole('dialog').getByRole('button', {name: 'Done', exact: true}).click();

  const saving = page.waitForResponse((response) =>
    response.url().endsWith('/api/secure/resource/patient-entry') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save record' }).click();
  const response = await saving;
  expect(response.status()).toBe(200);
  const saved = (await response.json() as {
    data: {source_id: string; source_resource_id: string};
  }).data;
  await expect(page.getByText(/Saved: Synthetic ICD diagnosis visit/)).toBeVisible();
  const readback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/${saved.source_resource_id}`);
  expect(readback.status()).toBe(200);
  const resource = (await readback.json() as {data: {resource_raw: Encounter}}).data.resource_raw;
  expect(resource.contained).toHaveLength(3);
  const conditions = resource.contained?.filter((resource) => resource.resourceType === 'Condition');
  expect(conditions).toMatchObject([
    {code: {coding: [{system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J06.9'}]}},
    {code: {coding: [{system: 'http://hl7.org/fhir/sid/icd-9-cm', code: '465.9'}]}},
  ]);
  expect(resource.diagnosis).toMatchObject([
    {condition: {reference: 'Condition/e2e-linked-condition'}, extension: [{valueDate: '2026-11-01'}]},
    {condition: {reference: '#visit-diagnosis-1'}, extension: [{valueDate: '2026-10-12'}]},
    {condition: {reference: '#visit-diagnosis-2'}, extension: [{valueDate: '2026-10-14'}]},
  ]);
  expect(conditions?.some((condition) => condition.abatementDateTime || condition.clinicalStatus)).toBe(false);
  const linkedReadback = await page.request.get(`${BASE}/api/secure/resource/fhir/${saved.source_id}/e2e-linked-condition`);
  expect(linkedReadback.status()).toBe(200);
  const linkedCondition = (await linkedReadback.json() as {data: {resource_raw: Record<string, unknown>}}).data.resource_raw;
  expect(linkedCondition).not.toHaveProperty('abatementDateTime');
  expect(linkedCondition).not.toHaveProperty('extension');

  await page.getByRole('button', {name: 'View in Explore'}).click();
  await expect(page.getByText('ICD-10-CM J06.9', {exact: true})).toBeVisible();
  await expect(page.getByText('ICD-9-CM 465.9', {exact: true})).toBeVisible();
  await expect(page.getByText('Expected end date: 2026-10-12 (estimated)', {exact: true})).toBeVisible();
  await expect(page.getByText('Expected end date: 2026-10-14 (estimated)', {exact: true})).toBeVisible();
  await expect(page.getByText('Expected end date: 2026-11-01 (estimated)', {exact: true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('ICD autocomplete supports keyboard selection, keeps searches local and allows manual entry on catalog failure', async ({ page }) => {
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);
  await page.selectOption('#entry-kind', 'visit');
  await page.locator('#edit-visit-diagnoses').click();
  await page.getByRole('button', {name: 'Add ICD diagnosis'}).click();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.fill('#diagnosis-search-0', 'j069');
  await expect(page.getByRole('option', {name: 'J06.9 - Acute upper respiratory infection, unspecified', exact: true})).toBeVisible();
  await page.locator('#diagnosis-search-0').press('ArrowDown');
  await page.locator('#diagnosis-search-0').press('Enter');
  await expect(page.locator('#diagnosis-code-0')).toHaveValue('J06.9');
  expect(requests.some((url) => url.endsWith('/assets/terminology/icd-10-cm.json'))).toBe(true);
  expect(requests.every((url) => new URL(url).origin === BASE)).toBe(true);
  expect(requests.every((url) => !url.toLowerCase().includes('j069'))).toBe(true);
  await page.fill('#diagnosis-end-new-0', '2026-10-20');
  await page.getByRole('button', {name: 'Clear selection for diagnosis 1'}).click();
  for (const field of ['system', 'code', 'description']) {
    await expect(page.locator(`#diagnosis-${field}-0`)).toBeEnabled();
  }
  await page.route('**/assets/terminology/icd-9-cm.json', (route) => route.fulfill({status: 503, body: 'Unavailable'}));
  await page.selectOption('#diagnosis-system-0', 'http://hl7.org/fhir/sid/icd-9-cm');
  await expect(page.locator('#diagnosis-code-0')).toHaveValue('');
  await expect(page.locator('#diagnosis-description-0')).toHaveValue('');
  await expect(page.locator('#diagnosis-end-new-0')).toHaveValue('2026-10-20');
  await page.fill('#diagnosis-search-0', '4659');
  await expect(page.getByRole('alert')).toContainText('Could not load code suggestions');
  await page.fill('#diagnosis-code-0', '465.9');
  await expect(page.locator('#diagnosis-code-0')).toHaveValue('465.9');
});

test('the diagnosis API refuses invalid codes, impossible dates and non-owned references', async ({ page }) => {
  await login(page, E2E_USER, E2E_PASS);
  for (const diagnosis of [
    {system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'INVALID'},
    {system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', expected_end_date: '2026-02-30'},
    {condition_id: 'not-in-my-records', expected_end_date: '2026-10-12'},
  ]) {
    const response = await page.request.post(`${BASE}/api/secure/resource/patient-entry`, {
      data: {kind: 'visit', name: 'Invalid synthetic diagnosis', visit_type: 'Consultation', visit_class: 'AMB', visit_diagnoses: [diagnosis]},
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({success: false, error: expect.any(String)});
  }
});

test('half a reading is kept, waits for the person, and joins their records when they confirm it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // Only the systolic half: a fact, and not a whole blood pressure.
  await page.selectOption('#vital-type', 'blood_pressure');
  await page.fill('#vital-sys', '128');
  await page.getByRole('button', { name: /save/i }).click();

  // Told at the point of saving, in plain words, not with an error.
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/only the systolic half/)).toBeVisible();

  // And findable afterwards, which is the half that makes the quarantine honest.
  // Two links say this: the one in the page header, and the one in the message just shown. The
  // message's is the one a person would follow here.
  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Blood pressure 128 systolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/only the systolic half/)).toBeVisible();

  await page.getByRole('button', { name: 'Right as written' }).first().click();
  await expect(page.getByText(/Added to your records: Blood pressure 128 systolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Nothing is waiting')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a record the person deletes from the queue is gone, and says nothing was kept', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // The other half this time, so this journey has its own record to delete.
  await page.selectOption('#vital-type', 'blood_pressure');
  await page.fill('#vital-dia', '78');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Blood pressure 78 diastolic/)).toBeVisible({ timeout: 20_000 });

  // Asked first, in the page, in words that say what "gone" means (#762).
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByText(/no copy is kept/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, delete it' }).click();

  await expect(page.getByText(/Deleted: Blood pressure 78 diastolic/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Nothing is waiting/)).toBeVisible();

  expect(errors).toEqual([]);
});

// yourphr#763: an allergy is an AllergyIntolerance, not an Observation wearing a label.
test('an allergy is stored as an allergy, waits for the person, and joins their records', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  await page.selectOption('#entry-kind', 'allergy');
  await page.fill('#entry-name', 'penicillin');
  await page.getByRole('button', { name: /save/i }).click();

  // Kept in their words, and honest about the fact that nothing has coded it.
  await expect(page.getByText(/not part of your records yet/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/nothing has matched it to a known substance/)).toBeVisible();

  await page.getByRole('link', { name: 'Waiting for you', exact: true }).click();
  await expect(page.getByText(/Allergy to penicillin/)).toBeVisible({ timeout: 20_000 });
  // Shown as a person says it, not as FHIR names it (#262): the row reads "Allergy · <date>".
  await expect(page.locator('p', { hasText: /^\s*Allergy\s*·/ }).first()).toBeVisible();
  await expect(page.getByText('AllergyIntolerance')).toHaveCount(0);

  await page.getByRole('button', { name: 'Right as written' }).first().click();
  await expect(page.getByText(/Added to your records: Allergy to penicillin/)).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});

// yourphr#764: a reading measured by a cuff and one remembered are different evidence.
test('a device named once is offered again, and the reading says it was measured with it', async ({ page }) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/resource/add`);

  // First time: the device does not exist yet, so it is named here.
  await page.selectOption('#vital-type', 'heart_rate');
  await page.fill('#vital-value', '64');
  await page.selectOption('#vital-device', '__new');
  await page.fill('#vital-device-name', 'Omron cuff');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/Saved: Heart rate 64/)).toBeVisible({ timeout: 20_000 });

  // Second time: it is a choice, not something to retype.
  await expect(page.locator('#vital-device option', { hasText: 'Omron cuff' })).toHaveCount(1, { timeout: 20_000 });
  await page.fill('#vital-value', '66');
  await page.selectOption('#vital-device', { label: 'Omron cuff' });
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/Saved: Heart rate 66/)).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});
