// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('HydroDaily: 写真・タイムライン・年間プラン E2Eテスト', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('TC-01: ヘッダータブの切り替え動作検証', async ({ page }) => {
    await page.click('#tab-btn-plan');
    await expect(page.locator('#view-plan')).toBeVisible();

    await page.click('#tab-btn-gallery');
    await expect(page.locator('#view-gallery')).toBeVisible();

    await page.click('#tab-btn-timeline');
    await expect(page.locator('#view-timeline')).toBeVisible();

    await page.click('#tab-btn-record');
    await expect(page.locator('#view-record')).toBeVisible();
  });

  test('TC-02: 年間プランボードの2027年/2026年グリッドと計画テキスト描画検証', async ({ page }) => {
    await page.click('#tab-btn-plan');
    const planView = page.locator('#view-plan');
    await expect(planView).toBeVisible();

    // 2027年および2026年の見出しが存在すること
    await expect(planView).toContainText('2027');
    await expect(planView).toContainText('2026');

    // ユーザーの実機データ（スナックエンドウ、遮光ネット、ピーマン切り戻し等）が正しく描画されていること
    await expect(planView).toContainText('スナックエンドウの種まき');
    await expect(planView).toContainText('遮光ネット');

    // 10月カードをクリックすると、計画編集モーダルが起動すること
    await planView.locator('text=10月').first().click();
    await expect(page.locator('#plan-editor-modal')).toBeVisible();

    // モーダル内に前年参照メモが表示されていること
    await expect(page.locator('#plan-editor-modal')).toContainText('前年（2026年10月）の記録参照');
    await page.click('#plan-editor-modal button:has-text("✕")');
    await expect(page.locator('#plan-editor-modal')).toBeHidden();
  });

  test('TC-03: 写真ギャラリーの年月見出しと正方形タイル、撮影日バッジ検証', async ({ page }) => {
    await page.click('#tab-btn-gallery');

    const monthHeader = page.locator('.gallery-month-header').first();
    await expect(monthHeader).toBeVisible();

    const firstTile = page.locator('.gallery-item').first();
    await expect(firstTile).toBeVisible();

    const dateBadge = firstTile.locator('.date-badge');
    await expect(dateBadge).toBeVisible();
    const badgeText = await dateBadge.textContent();
    expect(badgeText?.trim()).toMatch(/^\d{1,2}$/);
  });

  test('TC-04: ライトボックスモーダルの表示と左右キーボード送り検証', async ({ page }) => {
    await page.click('#tab-btn-gallery');

    await page.locator('.gallery-item').first().click();
    const modal = page.locator('#photo-modal');
    await expect(modal).toBeVisible();

    const firstSrc = await page.locator('#modal-img').getAttribute('src');

    await page.keyboard.press('ArrowRight');
    const secondSrc = await page.locator('#modal-img').getAttribute('src');
    expect(secondSrc).not.toBe(firstSrc);

    await page.keyboard.press('ArrowLeft');
    const backSrc = await page.locator('#modal-img').getAttribute('src');
    expect(backSrc).toBe(firstSrc);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('TC-05: タイムラインのリアルタイム・インクリメンタル検索検証', async ({ page }) => {
    await page.click('#tab-btn-timeline');

    const searchInput = page.locator('#timeline-search');
    await searchInput.fill('ハダニ');

    const visibleCards = page.locator('.timeline-card:visible');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(visibleCards.nth(i)).toContainText('ハダニ');
    }

    await searchInput.fill('');
    const allCards = page.locator('.timeline-card:visible');
    expect(await allCards.count()).toBeGreaterThan(count);
  });

  test('TC-06: クイック投稿ボタン（カメラ/ペン）からのエディタ起動検証', async ({ page }) => {
    // ペンボタン押下 ➔ 即座にフルスクリーンエディタ起動
    await page.click('#btn-quick-pen');
    const editor = page.locator('#journal-editor-modal');
    await expect(editor).toBeVisible();
    await expect(page.locator('#editor-textarea')).toBeFocused();

    // 閉じる
    await page.click('#journal-editor-modal button:has-text("✕")');
    await expect(editor).toBeHidden();
  });

});
