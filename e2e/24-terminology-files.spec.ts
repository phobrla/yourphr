import {expect, test} from '@playwright/test';
import {BASE, adminPassword, login, trackPageErrors} from './helpers.js';
import {E2E_USER, E2E_PASS} from './constants.js';

test('regular member maps a terminology file, edits it, reloads it and removes it', async ({page}) => {
  const errors = trackPageErrors(page);
  await login(page, E2E_USER, E2E_PASS);
  await page.goto(`${BASE}/account-profile`);
  const section = page.getByRole('region', {name: 'Terminology file mappings'});
  await expect(section.getByRole('button', {name: 'Save mapping', exact: true})).toHaveCount(6);
  const input = page.locator('[id="yourphr.terminology.loinc.table"]');
  const form = input.locator('..');
  await expect(input).toBeEnabled();
  await input.fill('/data/terminology/synthetic-Loinc.csv');
  await form.getByRole('button', {name: 'Save mapping', exact: true}).click();
  await expect(form.getByRole('status')).toContainText('Mapping saved');
  await page.reload();
  await expect(input).toHaveValue('/data/terminology/synthetic-Loinc.csv');
  await input.fill('/data/terminology/edited-Loinc.csv');
  await form.getByRole('button', {name: 'Save mapping', exact: true}).click();
  await expect(form.getByRole('status')).toContainText('Mapping saved');
  await page.reload();
  await expect(input).toHaveValue('/data/terminology/edited-Loinc.csv');
  await input.fill('relative.csv');
  await form.getByRole('button', {name: 'Save mapping', exact: true}).click();
  await expect(form.getByRole('alert')).toContainText('absolute server-side path');
  await page.reload();
  await expect(input).toHaveValue('/data/terminology/edited-Loinc.csv');
  const own = await page.request.get(`${BASE}/api/secure/account/terminology-files`);
  expect((await own.json()).data['yourphr.terminology.loinc.table']).toBe('/data/terminology/edited-Loinc.csv');
  const secondPage = await page.context().browser()!.newPage();
  try {
    await login(secondPage, 'admin', adminPassword());
    await secondPage.goto(`${BASE}/account-profile`);
    await expect(secondPage.locator('[id="yourphr.terminology.loinc.table"]')).toHaveValue('');
  } finally {
    await secondPage.close();
  }
  await input.fill('');
  await form.getByRole('button', {name: 'Save mapping', exact: true}).click();
  await expect(form.getByRole('status')).toHaveText('Mapping removed.');
  await page.reload();
  await expect(input).toHaveValue('');
  await page.setViewportSize({width: 390, height: 844});
  expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('personal mappings do not grant access to shared server configuration', async ({page}) => {
  await login(page, E2E_USER, E2E_PASS);
  let adminReads = 0;
  page.on('request', request => { if (request.url().endsWith('/secure/admin/config')) adminReads++; });
  await page.goto(`${BASE}/account-profile`);
  const section = page.getByRole('region', {name: 'Terminology file mappings'});
  await expect(section.getByRole('link', {name: 'Account / license request', exact: true})).toHaveCount(6);
  await expect(section.locator('input')).toHaveCount(6);
  expect(adminReads).toBe(0);
  const response = await page.request.put(`${BASE}/api/secure/admin/config`, {
    data: {key: 'yourphr.terminology.loinc.table', value: '/data/unauthorized.csv'},
  });
  expect(response.status()).toBe(403);
});
