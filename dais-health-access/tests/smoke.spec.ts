import { expect, test } from '@playwright/test';

test('HospiShuttle renders the prioritization experience at the root', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/HospiShuttle/);
  await expect(page.getByRole('heading', { name: 'HospiShuttle' })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Select a treatment and route patients toward realistic specialty destinations.',
    })
  ).toBeVisible();
  await expect(page.getByText('Treatment focus')).toBeVisible();
  await expect(page.getByText('Shuttle route map')).toBeVisible();
});

test('old prioritization path still opens HospiShuttle', async ({ page }) => {
  await page.goto('/prioritization');

  await expect(page.getByRole('heading', { name: 'HospiShuttle' })).toBeVisible();
  await expect(page.getByText('Route prioritization')).toBeVisible();
});

test('retired explorer path redirects to HospiShuttle', async ({ page }) => {
  await page.goto('/explorer');

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'HospiShuttle' })).toBeVisible();
});
