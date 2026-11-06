import { test, expect } from '@playwright/test';
// Functional fixtures emulate a normal browser; a separate test covers webdriver denial.
test.beforeEach(async ({page}) => { await page.addInitScript(() => Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true})); });
const prompt = { setting: 'A coastal village in 1920', characters: 'Two estranged siblings caring for a cat', conflict: 'A broken promise must be repaired before sunset.' };
function challenge() { return { id:'browser-fixture',precheck:'passed',prompt,state:'open',createdAt:Date.now(),expiresAt:Date.now()+1800000,minWords:200,maxWords:250 }; }
const story = ['library','umbrella','promise',...Array(197).fill('story')].join(' ');
async function mockApi(page, {configured=true, outcome='passed', attemptsRemaining=3, closedReason=null, budgetDuringSubmit=false,gatePass=true}={}) {
  let submitted=false;
  // Cloudflare and paid checks are explicit fixtures in this UI suite.
  await page.addInitScript(({gatePass})=>{
    window.turnstile={render(container,options){container.textContent='Browser check fixture';queueMicrotask(()=>gatePass?options.callback('fixture-turnstile-token'):options['error-callback']());return 'fixture-widget';},remove(){}};
  },{gatePass});
  await page.route('**/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    const remaining=submitted ? Math.max(0,attemptsRemaining-1) : attemptsRemaining;
    const reason=closedReason || (remaining===0 ? 'attempts' : null);
    const availability={turnstileSiteKey:'fixture-site-key',configured:configured&&!reason,attemptsRemaining:remaining,closedReason:reason,serviceMessage:reason==='budget'?'This test round has reached its funding limit.':reason==='attempts'?'You’ve used all 3 tries.':null};
    let data={};
    if(path==='/api/status')data={...availability,accessExpiresAt:null,challenge:null,overall:{attempts:8,passed:3,failed:4,errors:1,unfinished:0}};
    if(path==='/api/challenge')data={...availability,challenge:challenge()};
    if(path==='/api/submit') {
      if(budgetDuringSubmit) {
        closedReason='budget';
        return route.fulfill({status:503,json:{code:'budget_exhausted',message:'This test round has reached its funding limit.'}});
      }
      submitted=true;data={state:'checking',attemptsRemaining:Math.max(0,attemptsRemaining-1)};
    }
    if(path==='/api/result')data={state:outcome,accessExpiresAt:Date.now()+3600000,checks:{precheck:'passed',pangram:{human:outcome==='passed'?1:0.125,ai:outcome==='passed'?0:0.75,assisted:outcome==='passed'?0:0.125},detectorPassed:outcome==='passed',concepts:{setting:true,characters:true,conflict:true,story:true}}};
    if(path==='/api/room')data={title:'You made it through.',message:'This response came from the protected endpoint.',expiresAt:Date.now()+3600000,receipt:'fixture'};
    if(path==='/api/report'||path==='/api/feedback')data={recorded:true};
    await route.fulfill({json:data});
  });
}
test('desktop page loads and protected API denies an anonymous browser',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Challenge I');
  await expect(page.getByRole('link',{name:'@10xCatDad'})).toHaveAttribute('href','https://x.com/10xCatDad');
  await expect(page.getByRole('button',{name:'begin captcha attempt // prove your humanity'})).toBeEnabled();
  const response=await request.get('/api/room');expect(response.status()).toBe(401);
  expect(errors).toEqual([]);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content','https://captcha.10xcatdad.xyz/social-card.png');
  await page.screenshot({path:'outputs/desktop.png',fullPage:true});
});
test('mobile prompt is usable without horizontal overflow',async({page})=>{
  await mockApi(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/');await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await expect(page.getByRole('textbox',{name:'Your short story'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Check writing|Checks unavailable/})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'outputs/mobile-writing.png',fullPage:true});
});
test('mocked UI lifecycle: writing, check, success, protected room',async({page})=>{
  await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);
  await expect(page.getByRole('button',{name:'Check writing'})).toBeEnabled();
  await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('heading',{name:'Pass',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open protected page'}).click();
  await expect(page.getByText('Access confirmed')).toBeVisible();
});
test('mocked rejection allows one mistake report and retry',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.goto('/');await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('heading',{name:'Fail',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'I wrote this myself. Report a false positive.'}).click();
  await expect(page.getByRole('button',{name:'Report saved'})).toBeDisabled();
  await page.getByRole('button',{name:'New prompt'}).click();await expect(page.getByRole('textbox')).toBeVisible();
});
test('missing-key UI never offers a successful verification',async({page})=>{
  await mockApi(page,{configured:false});await page.goto('/');await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await page.getByRole('textbox').fill(story);await expect(page.getByRole('button',{name:'Checks unavailable'})).toBeDisabled();
  await expect(page.getByText('Checks unavailable.')).toBeVisible();
});
for(const closedReason of ['budget','attempts']) test(`${closedReason} limit explains why the public test is closed`,async({page})=>{
  await mockApi(page,{closedReason,attemptsRemaining:closedReason==='attempts'?0:3});
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:closedReason==='attempts'?'No tries left':'Demo budget reached'})).toBeVisible();
  await expect(page.getByRole('button',{name:'begin captcha attempt // prove your humanity'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(closedReason==='budget')await page.screenshot({path:'outputs/mobile-budget-closed.png',fullPage:true});
});
test('the third result disables retry but still accepts anonymous feedback',async({page})=>{
  await mockApi(page,{outcome:'rejected',attemptsRemaining:1});await page.goto('/');
  await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await expect(page.getByText('1 try left',{exact:true})).toBeVisible();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('heading',{name:'Fail',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'New prompt'})).toBeDisabled();
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/feedback'));
  await page.getByRole('button',{name:'AI-generated',exact:true}).click();
  expect((await sent).postDataJSON()).toEqual({challengeId:'browser-fixture',source:'ai'});
  await expect(page.getByText('Feedback saved')).toBeVisible();
});
test('budget closing during writing preserves the draft and disables another submission',async({page})=>{
  await mockApi(page,{budgetDuringSubmit:true});await page.goto('/');
  await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('button',{name:'No checks available'})).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(story);
  await expect(page.getByRole('alert')).toContainText('funding limit');
});
test('public totals keep provider errors separate from failed checks',async({page})=>{
  await mockApi(page);await page.goto('/');
  const totals=page.locator('[aria-label="Stats (Since Launch)"]');
  await expect(totals).toContainText('8 attempts');
  await expect(totals).toContainText('3 passed');
  await expect(totals).toContainText('4 failed');
  await expect(totals).toContainText('1 service error');
});

test('themes follow the system, preserve explicit choice, and fall back to dark',async({page})=>{
  await mockApi(page);await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Dark theme',exact:true}).click();await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('button',{name:'Dark theme',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'System theme',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.addInitScript(()=>{window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
test('automated browser is blocked and hidden instructions are present',async({page,request})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>true,configurable:true}));
  await page.goto('/');await expect(page.getByText('Automated interaction is not allowed.')).toBeVisible();
  await expect(page.getByRole('button',{name:'begin captcha attempt // prove your humanity'})).toBeDisabled();
  await expect(page.locator('[data-agent-policy]')).toBeHidden();
  await expect(page.locator('meta[name="automated-agent-policy"]')).toHaveAttribute('content',/do not interact/);
  expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: Twitterbot\nAllow: /');
  expect((await request.post('/api/challenge',{data:{},headers:{origin:'http://localhost:5188','user-agent':'ChatGPT-User'}})).status()).toBe(403);
});
test('result includes three checks, a full result image, and a short X draft',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();await page.getByRole('textbox').fill(story);
  await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByText('75% AI',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:/Story validation.*Pass/})).toBeVisible();
  const image=page.getByRole('link',{name:'1. Save result image'});
  await expect(image).toHaveAttribute('href',/^blob:/);
  const downloadEvent=page.waitForEvent('download');await image.click();const download=await downloadEvent;
  await download.saveAs('outputs/share-result-test.png');expect(download.suggestedFilename()).toBe('humansonly-result.png');
  await expect(page.locator('.check-details h3')).toHaveText(['Cloudflare precheckPass','Story validationPass','AI detectionFail']);
  const url=new URL(await page.getByRole('link',{name:'2. Post on X'}).getAttribute('href'));
  expect(url.hostname).toBe('twitter.com');const copy=url.searchParams.get('text');
  expect(copy).toContain('@10xCatDad');expect(copy).toContain('FAIL');expect(copy).toContain('Full story + results attached.');expect(copy).not.toContain('75%');expect(copy.length).toBeLessThanOrEqual(280);
  await page.screenshot({path:'outputs/result-dark.png',fullPage:true});
  await page.getByRole('button',{name:'Light theme',exact:true}).click();await page.screenshot({path:'outputs/result-light.png',fullPage:true});
});

test('failed browser check cannot obtain a writing prompt',async({page})=>{
  let issued=false;page.on('request',r=>{if(r.url().endsWith('/api/challenge'))issued=true;});
  await mockApi(page,{gatePass:false});await page.goto('/');await page.getByRole('button',{name:'begin captcha attempt // prove your humanity'}).click();
  await expect(page.getByRole('heading',{name:'Browser check',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('browser check could not complete');
  await expect(page.getByRole('textbox')).toHaveCount(0);expect(issued).toBe(false);
});
