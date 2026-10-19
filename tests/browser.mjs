// Real-browser acceptance suite. Run after npm install; Chromium must be installed.
// This suite was supplied but could not be executed in the restricted build environment.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const server=spawn(process.execPath,['server.mjs'],{stdio:'pipe',env:{...process.env,PORT:'4188'}});await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
const errors=[],external=[];let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1365,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://localhost:4188')&&!/^(blob:|data:)/.test(r.url()))external.push(r.url());});
 await page.goto('http://localhost:4188');await expect(page.locator('#saveStatus')).toHaveText('Saved on this device');
 await page.locator('#sampleToggle').click();await page.locator('[data-sample="S001-A"]').click();await expect(page.locator('#captureFraction')).toHaveText('1 / 10');
 await page.locator('[data-sample="S001-A"]').click();await expect(page.locator('#toast')).toContainText('already captured');await expect(page.locator('#captureFraction')).toHaveText('1 / 10');
 await page.locator('[data-tab="review"]').click();await page.locator('#answer-S001').fill('A');await page.locator('[data-confirm="S001"]').click();await expect(page.locator('[data-review="S001"] .badge')).toHaveText('✓ Correct');
 await page.locator('#answer-S001').fill('B');await page.locator('[data-confirm="S001"]').click();await expect(page.locator('[data-review="S001"] .badge')).toHaveText('Incorrect');
 await page.locator('[data-rescan="S001"]').click();await page.locator('[data-sample="S001-A"]').click();await expect(page.locator('#toast')).toContainText('captured and saved');
 await page.locator('[data-tab="review"]').click();await expect(page.locator('[data-review="S001"]')).toContainText('1 rescan(s)');await expect(page.locator('[data-review="S001"] .badge')).not.toHaveText('Incorrect');
 await page.locator('#newQuestion').click();await page.locator('#promptInput').fill('Past tense of go');await page.locator('#modeInput').selectOption('word');await page.locator('#keyInput').fill('went');await page.locator('#questionForm button[type=submit]').click();
 await expect(page.locator('#captureFraction')).toHaveText('0 / 10');await page.locator('[data-sample="S005-went"]').click();await expect(page.locator('#captureFraction')).toHaveText('1 / 10');
 await page.locator('[data-tab="review"]').click();await page.locator('#answer-S005').fill('went');await page.locator('[data-confirm="S005"]').click();await expect(page.locator('[data-review="S005"] .badge')).toHaveText('✓ Correct');
 await page.reload();await expect(page.locator('#questionPrompt')).toHaveText('Past tense of go');await expect(page.locator('#captureFraction')).toHaveText('1 / 10');
 await page.locator('[data-tab="results"]').click();const dl=page.waitForEvent('download');await page.locator('#exportCSV').click();const download=await dl;fs.mkdirSync('screenshots',{recursive:true});await download.saveAs('screenshots/browser-results.csv');
 await page.locator('[data-tab="scan"]').click();await page.screenshot({path:'screenshots/desktop-scan.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'screenshots/mobile-scan.png',fullPage:true});
 await page.locator('[data-tab="review"]').click();await page.screenshot({path:'screenshots/mobile-review.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflow).toBe(false);expect(errors).toEqual([]);expect(external).toEqual([]);
 console.log('Browser acceptance passed: capture, locking, correction, rescan, question separation, words, persistence, export, responsive layout, no external requests.');
}finally{await browser?.close();server.kill();}
