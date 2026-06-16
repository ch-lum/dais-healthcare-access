import { test, expect } from '@playwright/test';

test('overview page renders the main experience shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Health Access Atlas' })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'A polished facilities explorer on Lakebase, built for fast hackathon demos.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explorer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prioritization' })).toBeVisible();
});

test('explorer page renders facility search controls', async ({ page }) => {
  await page.goto('/explorer');

  await expect(
    page.getByRole('heading', {
      name: 'Explore the healthcare access landscape with Lakebase-backed search and filtering.',
    }),
  ).toBeVisible();
  await expect(page.getByPlaceholder('Search facilities, specialties, or cities')).toBeVisible();
  await expect(page.getByText('Result set')).toBeVisible();
});

test('prioritization page renders the integrated pipeline view', async ({ page }) => {
  await page.goto('/prioritization');

  await expect(
    page.getByRole('heading', {
      name: 'Your original prioritization workflow now lives inside the templated app.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Integrated legacy pipeline')).toBeVisible();
});
