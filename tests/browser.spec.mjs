import { test, expect } from '@playwright/test';
// Functional fixtures emulate a normal browser; a separate test covers webdriver denial.
test.beforeEach(async ({page}) => { await page.addInitScript(() => Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true})); });
const prompt = { setting: 'A coastal village in 1920', characters: 'Two estranged siblings caring for a cat', conflict: 'A broken promise must be repaired before sunset.' };
function challenge() { return { id:'browser-fixture',precheck:'passed',prompt,state:'open',createdAt:Date.now(),expiresAt:Date.now()+1800000,minWords:200,maxWords:250 }; }
const story = ['library','umbrella','promise',...Array(197).fill('story')].join(' ');
async function mockApi(page, {configured=true, outcome='passed', attemptsRemaining=3, closedReason=null, budgetDuringSubmit=false,gatePass=true}={}) {
  let submitted=false,completed=false,unlocked=false;
  const checks={precheck:'passed',pangram:{human:outcome==='passed'?1:0.125,ai:outcome==='passed'?0:0.75,assisted:outcome==='passed'?0:0.125},detectorPassed:outcome==='passed',concepts:{setting:true,characters:true,conflict:true,story:true}};
  // Cloudflare and paid checks are explicit fixtures in this UI suite.
  await page.addInitScript(({gatePass})=>{
    window.turnstile={render(container,options){container.textContent='Browser check fixture';queueMicrotask(()=>gatePass?options.callback('fixture-turnstile-token'):options['error-callback']());return 'fixture-widget';},remove(){}};
  },{gatePass});
  await page.route('**/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    const remaining=submitted ? Math.max(0,attemptsRemaining-1) : attemptsRemaining;
    const reason=closedReason==='budget'?'budget':unlocked?null:closedReason || (remaining===0 ? 'attempts' : null);
    const availability={turnstileSiteKey:'fixture-site-key',configured:configured&&!reason,unlimitedAttempts:unlocked,attemptsRemaining:unlocked?null:remaining,closedReason:reason,serviceMessage:reason==='budget'?'This test round has reached its funding limit.':reason==='attempts'?'You’ve used all 3 tries.':null};
    let data={};
    if(path==='/api/diagnostics/unlock'){unlocked=true;data={unlocked:true,unlimitedAttempts:true};}
    if(path==='/api/diagnostics')data={checkedAt:Date.now(),totalErrors:1,detailsUnavailable:0,services:{browserConfigured:true,detectorConfigured:true,validatorOnline:true,detectorPausedUntil:null},errors:[{code:'validation_timeout',description:'The combined verification did not finish within five minutes.',count:1,lastSeen:Date.now()-10000}]};
    if(path==='/api/status')data={...availability,history:completed?[{id:'browser-fixture',state:outcome,submittedAt:Date.now()-10000,precheck:'passed',checks:outcome==='error'?null:checks}]:[],accessExpiresAt:null,challenge:null,overall:{attempts:8,passed:3,failed:4,errors:1,unfinished:0}};
    if(path==='/api/challenge')data={...availability,challenge:challenge()};
    if(path==='/api/submit') {
      if(budgetDuringSubmit) {
        closedReason='budget';
        return route.fulfill({status:503,json:{code:'budget_exhausted',message:'This test round has reached its funding limit.'}});
      }
      submitted=true;data={state:'checking',attemptsRemaining:Math.max(0,attemptsRemaining-1)};
    }
    if(path==='/api/result'){completed=true;data={state:outcome,accessExpiresAt:Date.now()+3600000,checks};}
    if(path==='/api/room')data={title:'You made it through.',message:'This response came from the protected endpoint.',expiresAt:Date.now()+3600000,receipt:'fixture'};
    if(path==='/api/report'||path==='/api/feedback')data={recorded:true};
    await route.fulfill({json:data});
  });
}
test('desktop page loads and protected API denies an anonymous browser',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Challenge I');
  await expect(page.getByRole('heading',{name:'How to play // the captcha'})).toBeVisible();
  const font=await page.evaluate(async()=>{const faces=await document.fonts.load('400 14px "Space Grotesk"');return {family:getComputedStyle(document.body).fontFamily,loaded:faces.length>0&&faces.every(face=>face.status==='loaded')};});
  expect(font.family).toContain('Space Grotesk');expect(font.loaded).toBe(true);
  await expect(page.getByRole('link',{name:'@10xCatDad'})).toHaveAttribute('href','https://x.com/10xCatDad');
  await expect(page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'})).toBeEnabled();
  const response=await request.get('/api/room');expect(response.status()).toBe(401);
  expect(errors).toEqual([]);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content','https://captcha.10xcatdad.xyz/social-card.png');
  await page.screenshot({path:'outputs/desktop.png',fullPage:true});
});
test('mobile prompt is usable without horizontal overflow',async({page})=>{
  await mockApi(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await expect(page.getByRole('textbox',{name:'Your short story'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Check writing|Checks unavailable/})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'outputs/mobile-writing.png',fullPage:true});
});
test('mocked UI lifecycle: writing, check, success, protected room',async({page})=>{
  await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);
  await expect(page.getByRole('button',{name:'Check writing'})).toBeEnabled();
  await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('dialog',{name:'Pass',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Open protected page'}).click();
  await expect(page.getByText('Access confirmed')).toBeVisible();
});
test('mocked rejection allows one mistake report and retry',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('dialog',{name:'Fail',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close result'}).click();
  await page.getByRole('button',{name:'I wrote this myself. Report a false positive.'}).click();
  await expect(page.getByRole('button',{name:'Report saved'})).toBeDisabled();
  await page.getByRole('button',{name:'New prompt'}).click();await expect(page.getByRole('textbox')).toBeVisible();
});
test('missing-key UI never offers a successful verification',async({page})=>{
  await mockApi(page,{configured:false});await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox').fill(story);await expect(page.getByRole('button',{name:'Checks unavailable'})).toBeDisabled();
  await expect(page.getByText('Checks unavailable.')).toBeVisible();
});
for(const closedReason of ['budget','attempts']) test(`${closedReason} limit explains why the public test is closed`,async({page})=>{
  await mockApi(page,{closedReason,attemptsRemaining:closedReason==='attempts'?0:3});
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:closedReason==='attempts'?'No tries left':'Demo budget reached'})).toBeVisible();
  await expect(page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(closedReason==='budget')await page.screenshot({path:'outputs/mobile-budget-closed.png',fullPage:true});
});
test('the third result disables retry but still accepts anonymous feedback',async({page})=>{
  await mockApi(page,{outcome:'rejected',attemptsRemaining:1});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await expect(page.getByText('1 try left',{exact:true})).toBeVisible();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('dialog',{name:'Fail',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close result'}).click();
  await expect(page.getByRole('button',{name:'New prompt'})).toBeDisabled();
  await page.getByRole('button',{name:'View result // share'}).click();
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/feedback'));
  await page.getByRole('button',{name:'AI-generated',exact:true}).click();
  expect((await sent).postDataJSON()).toEqual({challengeId:'browser-fixture',source:'ai'});
  await expect(page.getByText('Feedback saved')).toBeVisible();
});
test('budget closing during writing preserves the draft and disables another submission',async({page})=>{
  await mockApi(page,{budgetDuringSubmit:true});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await expect(page.getByRole('button',{name:'No checks available'})).toBeDisabled();
  await expect(page.getByRole('textbox')).toHaveValue(story);
  await expect(page.getByRole('alert')).toContainText('funding limit');
});
test('public totals omit service errors without counting them as failed checks',async({page})=>{
  await mockApi(page);await page.goto('/');
  const totals=page.locator('[aria-label="Leaderboard info"]');
  await expect(totals).toContainText('8 attempts');
  await expect(totals).toContainText('3 passed');
  await expect(totals).toContainText('4 failed');
  await expect(totals).not.toContainText('service error');
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
  await expect(page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'})).toBeDisabled();
  await expect(page.locator('[data-agent-policy]')).toBeHidden();
  await expect(page.locator('meta[name="automated-agent-policy"]')).toHaveAttribute('content',/do not interact/);
  expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: Twitterbot\nAllow: /');
  expect((await request.post('/api/challenge',{data:{},headers:{origin:'http://localhost:5188','user-agent':'ChatGPT-User'}})).status()).toBe(403);
});
test('result overlay creates a compact image and opens an X draft plus download in one click',async({page})=>{
  await page.addInitScript(()=>{
    window.__opened=[];window.__imageText=[];
    window.open=(...args)=>{window.__opened.push(args);return null;};
    Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(...args){window.__imageText.push(args[0]);return original.apply(this,args);};
  });
  await mockApi(page,{outcome:'rejected'});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();await page.getByRole('textbox').fill(story);
  await page.getByRole('button',{name:'Check writing'}).click();
  const dialog=page.getByRole('dialog',{name:'Fail',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('75% AI',{exact:true})).toBeVisible();
  await expect(dialog.locator('.check-details h3')).toHaveText(['Cloudflare precheckPass','Story validationPass','AI detectionFail']);
  await expect(dialog.getByRole('img',{name:'HumansOnly result image: Fail'})).toBeVisible();
  const share=dialog.getByRole('button',{name:'SHARE TO X'});await expect(share).toBeEnabled();
  const downloadEvent=page.waitForEvent('download');await share.click();const download=await downloadEvent;
  await download.saveAs('outputs/share-result-test.png');expect(download.suggestedFilename()).toBe('humansonly-result.png');
  const opened=await page.evaluate(()=>window.__opened);expect(opened).toHaveLength(1);
  const url=new URL(opened[0][0]);expect(url.hostname).toBe('twitter.com');
  expect(url.searchParams.get('text')).toBe('@10xCatDad I failed Level 1 of HumansOnly! :( (2/3 tries remaining)');
  expect(url.searchParams.get('text')).not.toContain('http');expect(url.searchParams.get('text').length).toBeLessThanOrEqual(280);
  expect(opened[0][1]).toBe('_blank');expect(opened[0][2]).toContain('popup');expect(page.url()).toMatch(/:5188\/$/);
  const drawn=await page.evaluate(()=>window.__imageText);expect(drawn.filter(t=>t.startsWith('library umbrella')||t.startsWith('story'))).toHaveLength(4);
  expect(drawn).toContain('captcha.10xcatdad.xyz');expect(drawn.some(t=>t.includes('https://'))).toBe(false);
  const sharePosition=await share.boundingBox(), feedbackPosition=await dialog.getByText('How was it written? (optional)').boundingBox();
  expect(feedbackPosition.y).toBeGreaterThan(sharePosition.y);
  await page.screenshot({path:'outputs/result-overlay-dark.png',fullPage:true});
  const imageBytes=await dialog.getByRole('img').evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  await page.getByRole('button',{name:'Close result'}).click();await page.reload();
  const history=page.getByRole('region',{name:'Previous results'});await history.getByRole('button',{name:/Attempt 1.*Fail/}).click();
  const previous=history.getByRole('img',{name:'HumansOnly result image: Fail'});await expect(previous).toBeVisible();
  expect(await previous.evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())))).toEqual(imageBytes);
  await expect(history.getByText('Includes a story excerpt and all three checks. Saved only in this browser.')).toBeVisible();
});

test('failed browser check cannot obtain a writing prompt',async({page})=>{
  let issued=false;page.on('request',r=>{if(r.url().endsWith('/api/challenge'))issued=true;});
  await mockApi(page,{gatePass:false});await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await expect(page.getByRole('heading',{name:'Browser check',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('browser check could not complete');
  await expect(page.getByRole('textbox')).toHaveCount(0);expect(issued).toBe(false);
});

test('remaining attempts and saved check results remain visible after refresh',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.setViewportSize({width:390,height:844});await page.goto('/');
  const remaining=page.getByLabel('Attempts remaining');
  await expect(remaining).toContainText('3 / 3');
  await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  await page.getByRole('button',{name:'Close result'}).click();
  const history=page.getByRole('region',{name:'Previous results'});
  await expect(history.getByRole('button',{name:/Attempt 1.*Fail/})).toBeVisible();
  await expect(remaining).toContainText('2 / 3');
  await page.reload();await expect(remaining).toContainText('2 / 3');
  await history.getByRole('button',{name:/Attempt 1.*Fail/}).click();
  await expect(history.getByText('75% AI',{exact:true})).toBeVisible();
  await expect(history.locator('.check-details h3')).toHaveText(['Cloudflare precheckPass','Story validationPass','AI detectionFail']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'outputs/mobile-history.png',fullPage:true});
});

test('native sharing includes the generated file and win text even when image storage is blocked',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Storage blocked','SecurityError');},configurable:true});
    Object.defineProperty(navigator,'canShare',{value:({files})=>files?.[0]?.type==='image/png',configurable:true});
    Object.defineProperty(navigator,'share',{value:async data=>{window.__shared={text:data.text,url:data.url,files:await Promise.all(data.files.map(async f=>({name:f.name,type:f.type,size:f.size,signature:Array.from(new Uint8Array(await f.slice(0,8).arrayBuffer()))})))};},configurable:true});
    window.open=()=>{throw new Error('Native sharing must not also open a popup');};
  });
  await mockApi(page);await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'Check writing'}).click();
  const dialog=page.getByRole('dialog',{name:'Pass',exact:true});await dialog.getByRole('button',{name:'SHARE TO X'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__shared?.text)).toBe('@10xCatDad I just beat Level 1 of HumansOnly! :D');
  const shared=await page.evaluate(()=>window.__shared);expect(shared.url).toBeUndefined();
  expect(shared.files[0].name).toBe('humansonly-result.png');expect(shared.files[0].size).toBeGreaterThan(1000);expect(shared.files[0].signature).toEqual([137,80,78,71,13,10,26,10]);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:'outputs/result-overlay-mobile.png',fullPage:true});
});

test('Konami code reveals diagnostics after the footer and unlocks retries only after server confirmation',async({page})=>{
  await mockApi(page,{closedReason:'attempts',attemptsRemaining:0});await page.goto('/');
  const panel=page.getByRole('region',{name:'SERVICE ERRORS // DIAGNOSTICS'});
  await expect(panel).toHaveCount(0);await expect(page.getByLabel('Leaderboard info')).not.toContainText('service error');
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','x'])await page.keyboard.press(key);
  await expect(panel).toHaveCount(0);
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'])await page.keyboard.press(key);
  await expect(panel).toBeVisible();await expect(panel).toContainText('1 service error since launch');await expect(panel).toContainText('validation_timeout');
  await expect(page.getByLabel('Attempts remaining')).toContainText('unlimited tries');await expect(page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'})).toBeEnabled();
  expect(await panel.evaluate(el=>!!(document.querySelector('footer').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByRole('button',{name:'Hide diagnostics'}).click();await expect(panel).toHaveCount(0);
  await page.reload();await expect(page.getByLabel('Attempts remaining')).toContainText('unlimited tries');await expect(panel).toHaveCount(0);
  await page.getByRole('button',{name:'BEGIN CAPTCHA ATTEMPT // PROVE YOUR HUMANITY'}).click();
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'])await page.keyboard.press(key);
  await expect(panel).toHaveCount(0);
});
