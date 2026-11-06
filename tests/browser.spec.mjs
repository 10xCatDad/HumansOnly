import { test, expect } from '@playwright/test';
// Functional fixtures emulate a normal browser; a separate test covers webdriver denial.
test.beforeEach(async ({page}) => { await page.addInitScript(() => Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true})); });
const prompt = { setting: 'A coastal village in 1920', characters: 'Two estranged siblings caring for a cat', conflict: 'A broken promise must be repaired before sunset.' };
function challenge() { return { id:'browser-fixture',precheck:'passed',prompt,state:'open',createdAt:Date.now(),expiresAt:Date.now()+1800000,minWords:200,maxWords:250 }; }
const story = ['library','umbrella','promise',...Array(197).fill('story')].join(' ');
async function mockApi(page, {configured=true, outcome='passed', attemptsRemaining=3, closedReason=null, budgetDuringSubmit=false,gatePass=true,history=[]}={}) {
  let submitted=false,completed=false,unlocked=false; const submittedAt=Date.now()-10000;
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
    if(path==='/api/status')data={...availability,history:completed?[{id:'browser-fixture',state:outcome,submittedAt,precheck:'passed',checks:outcome==='error'?null:checks}]:history,accessExpiresAt:null,challenge:null,overall:{attempts:8,passed:3,failed:4,errors:1,unfinished:0}};
    if(path==='/api/challenge')data={...availability,challenge:challenge()};
    if(path==='/api/submit') {
      if(budgetDuringSubmit) {
        closedReason='budget';
        return route.fulfill({status:503,json:{code:'budget_exhausted',message:'This test round has reached its funding limit.'}});
      }
      submitted=true;data={state:'checking',attemptsRemaining:Math.max(0,attemptsRemaining-1)};
    }
    if(path==='/api/result'){completed=true;data={state:outcome,submittedAt,accessExpiresAt:Date.now()+3600000,checks};}
    if(path==='/api/room')data={title:'You made it through.',message:'This response came from the protected endpoint.',expiresAt:Date.now()+3600000,receipt:'fixture'};
    if(path==='/api/report'||path==='/api/feedback')data={recorded:true};
    await route.fulfill({json:data});
  });
}
test('desktop page loads and protected API denies an anonymous browser',async({page,request})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Keep UI readiness independent of the local validator heartbeat. The direct
  // request below still exercises the real anonymous protected endpoint.
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Challenge I');
  await expect(page.getByRole('heading',{name:'GOAL // CAPTURE THE FLAG WITH AN LLM'})).toBeVisible();
  const font=await page.evaluate(async()=>{const faces=await document.fonts.load('400 14px "Space Grotesk"');return {family:getComputedStyle(document.body).fontFamily,loaded:faces.length>0&&faces.every(face=>face.status==='loaded')};});
  expect(font.family).toContain('Space Grotesk');expect(font.loaded).toBe(true);
  await expect(page.getByRole('link',{name:'@10xCatDad'})).toHaveAttribute('href','https://x.com/10xCatDad');
  await expect(page.getByRole('button',{name:'BEGIN ATTEMPT'})).toBeEnabled();
  const response=await request.get('/api/room');expect(response.status()).toBe(401);
  expect(errors).toEqual([]);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content','https://captcha.10xcatdad.xyz/social-card.png');
  await page.screenshot({path:'outputs/desktop.png',fullPage:true});
});
test('mobile prompt is usable without horizontal overflow',async({page})=>{
  await mockApi(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await expect(page.getByRole('textbox',{name:'Your short story'})).toBeVisible();
  await expect(page.getByRole('button',{name:/SUBMIT SOLUTION|CHECKS UNAVAILABLE/})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'outputs/mobile-writing.png',fullPage:true});
});
test('mocked UI lifecycle: writing, check, success, protected room',async({page})=>{
  await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);
  await expect(page.getByRole('button',{name:'SUBMIT SOLUTION'})).toBeEnabled();
  await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  await expect(page.getByRole('dialog',{name:'Pass',exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Open protected page'}).click();
  await expect(page.getByText('Access confirmed')).toBeVisible();
});
test('mocked rejection allows one mistake report and retry',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox',{name:'Your short story'}).fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  await expect(page.getByRole('dialog',{name:'Fail',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close result'}).click();
  await page.getByRole('button',{name:'I wrote this myself. Report a false positive.'}).click();
  await expect(page.getByRole('button',{name:'Report saved'})).toBeDisabled();
  await page.getByRole('button',{name:'New prompt'}).click();await expect(page.getByRole('textbox')).toBeVisible();
});
test('missing-key UI never offers a successful verification',async({page})=>{
  await mockApi(page,{configured:false});await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox').fill(story);await expect(page.getByRole('button',{name:'Checks unavailable'})).toBeDisabled();
  await expect(page.getByText('Checks unavailable.')).toBeVisible();
});
for(const closedReason of ['budget','attempts']) test(`${closedReason} limit explains why the public test is closed`,async({page})=>{
  await mockApi(page,{closedReason,attemptsRemaining:closedReason==='attempts'?0:3});
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:closedReason==='attempts'?'No tries left':'Demo budget reached'})).toBeVisible();
  await expect(page.getByRole('button',{name:'BEGIN ATTEMPT'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(closedReason==='budget')await page.screenshot({path:'outputs/mobile-budget-closed.png',fullPage:true});
});
test('the third result disables retry but still accepts anonymous feedback',async({page})=>{
  await mockApi(page,{outcome:'rejected',attemptsRemaining:1});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await expect(page.getByText('1 try left',{exact:true})).toBeVisible();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
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
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
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
  await expect(page.getByRole('button',{name:'BEGIN ATTEMPT'})).toBeDisabled();
  await expect(page.locator('[data-agent-policy]')).toBeHidden();
  await expect(page.locator('meta[name="automated-agent-policy"]')).toHaveAttribute('content',/do not interact/);
  expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: Twitterbot\nAllow: /');
  expect((await request.post('/api/challenge',{data:{},headers:{origin:'http://localhost:5188','user-agent':'ChatGPT-User'}})).status()).toBe(403);
});
test('result overlay downloads its image and opens a browser X draft without links',async({page})=>{
  await page.addInitScript(()=>{
    window.__opened=[];window.__imageText=[];window.__nativeShares=0;
    window.open=(...args)=>{window.__opened.push(args);window.__draft=args[0];return null;};
    Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
    Object.defineProperty(navigator,'share',{value:async()=>{window.__nativeShares++;},configurable:true});
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(...args){window.__imageText.push(args[0]);return original.apply(this,args);};
  });
  await mockApi(page,{outcome:'rejected'});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();await page.getByRole('textbox').fill(story);
  await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  const dialog=page.getByRole('dialog',{name:'Fail',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('75% AI',{exact:true})).toBeVisible();
  await expect(dialog.locator('.check-details h3')).toHaveText(['CLOUDFLARE PRECHECKPass','STORY CONTENT & SUBJECT VALIDATIONPass','STORY AUTHOR VALIDATIONFail']);
  await expect(dialog.getByRole('img',{name:'HumansOnly result image: Fail'})).toBeVisible();
  const share=dialog.getByRole('button',{name:'SHARE TO X'});await expect(share).toBeEnabled();
  await expect(dialog.getByText('Downloads the PNG and opens X. Attach it using X’s photo button before posting.')).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await share.click();const download=await downloadEvent;
  await expect.poll(()=>page.evaluate(()=>window.__draft)).toContain('twitter.com/intent/tweet');
  expect(await page.evaluate(()=>window.__nativeShares)).toBe(0);
  await download.saveAs('outputs/share-result-test.png');expect(download.suggestedFilename()).toBe('humansonly-result.png');
  const opened=await page.evaluate(()=>window.__opened);expect(opened).toHaveLength(1);
  const url=new URL(await page.evaluate(()=>window.__draft));expect(url.hostname).toBe('twitter.com');
  expect(url.searchParams.get('text')).toBe('@10xCatDad I failed Level 1 of HumansOnly! :( (2/3 tries remaining)');
  expect(url.searchParams.get('text')).not.toMatch(/https?:\/\//);expect(url.searchParams.get('text').length).toBeLessThanOrEqual(280);
  await expect(dialog.getByRole('status')).toContainText('Attach humansonly-result.png in X before posting.');
  expect(opened[0][1]).toBe('_blank');expect(opened[0][2]).toContain('popup');expect(page.url()).toMatch(/:5188\/$/);
  const drawn=await page.evaluate(()=>window.__imageText);expect(drawn.some(t=>t.startsWith('library umbrella')||t.startsWith('story'))).toBe(false);
  expect(drawn[0]).toBe('captcha.10xcatdad.xyz');expect(drawn.some(t=>/^\d{4}-\d{2}-\d{2} .* UTC$/.test(t))).toBe(true);expect(drawn).not.toContain('STORY EXCERPT');expect(drawn).toContain('LEVEL 1 // RESULT');expect(drawn).toContain('The captcha held.');expect(drawn).toContain('75% AI');expect(drawn).toContain('12.5% AI-assisted');expect(drawn).toContain('12.5% human');expect(drawn.some(t=>t.includes('https://'))).toBe(false);
  const sharePosition=await share.boundingBox(), feedbackPosition=await dialog.getByText('How was it written? (optional)').boundingBox();
  expect(feedbackPosition.y).toBeGreaterThan(sharePosition.y);
  await page.screenshot({path:'outputs/result-overlay-dark.png',fullPage:true});
  const imageBytes=await dialog.getByRole('img').evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  await page.getByRole('button',{name:'Close result'}).click();await page.reload();
  const history=page.getByRole('region',{name:'Previous Results'});await history.getByRole('button',{name:/Attempt 1.*Fail/}).click();
  const previous=history.getByRole('img',{name:'HumansOnly result image: Fail'});await expect(previous).toBeVisible();
  expect(await previous.evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())))).toEqual(imageBytes);
  await expect(history.getByText('Downloads the PNG and opens X. Attach it using X’s photo button before posting.')).toBeVisible();
  const savedAgain=page.waitForEvent('download');await history.getByRole('link',{name:'Save image',exact:true}).click();
  expect((await savedAgain).suggestedFilename()).toBe('humansonly-result.png');
});

test('failed browser check cannot obtain a writing prompt',async({page})=>{
  let issued=false;page.on('request',r=>{if(r.url().endsWith('/api/challenge'))issued=true;});
  await mockApi(page,{gatePass:false});await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await expect(page.getByRole('heading',{name:'Browser check',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('browser check could not complete');
  await expect(page.getByRole('textbox')).toHaveCount(0);expect(issued).toBe(false);
});

test('remaining attempts and saved check results remain visible after refresh',async({page})=>{
  await mockApi(page,{outcome:'rejected'});await page.setViewportSize({width:390,height:844});await page.goto('/');
  const remaining=page.getByLabel('Attempts remaining');
  await expect(remaining).toContainText('3 / 3');
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  await page.getByRole('button',{name:'Close result'}).click();
  const history=page.getByRole('region',{name:'Previous Results'});
  await expect(history.getByRole('button',{name:/Attempt 1.*Fail/})).toBeVisible();
  await expect(remaining).toContainText('2 / 3');
  await page.reload();await expect(remaining).toContainText('2 / 3');
  await history.getByRole('button',{name:/Attempt 1.*Fail/}).click();
  await expect(history.getByText('75% AI',{exact:true})).toBeVisible();
  await expect(history.locator('.check-details h3')).toHaveText(['Step 1 // CLOUDFLARE PRECHECKPass','Step 2 // STORY CONTENT & SUBJECT VALIDATIONPass','Step 3 // STORY AUTHOR VALIDATIONFail']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'outputs/mobile-history.png',fullPage:true});
});

test('mobile sharing downloads the image without links when local storage is blocked',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Storage blocked','SecurityError');},configurable:true});
    Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
    Object.defineProperty(navigator,'share',{value:async()=>{throw new Error('OS share must not open');},configurable:true});
    window.open=url=>{window.__draft=url;return null;};
  });
  await mockApi(page);await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  const dialog=page.getByRole('dialog',{name:'Pass',exact:true});await expect(dialog.getByRole('img')).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'SHARE TO X'}).click();
  expect((await downloadEvent).suggestedFilename()).toBe('humansonly-result.png');
  await expect.poll(()=>page.evaluate(()=>window.__draft)).toContain('twitter.com/intent/tweet');
  const url=new URL(await page.evaluate(()=>window.__draft));
  expect(url.searchParams.get('text')).toBe('@10xCatDad I just beat Level 1 of HumansOnly! :D');
  expect(url.searchParams.get('text').length).toBeLessThanOrEqual(280);
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
  await expect(page.getByLabel('Attempts remaining')).toContainText('unlimited tries');await expect(page.getByRole('button',{name:'BEGIN ATTEMPT'})).toBeEnabled();
  expect(await panel.evaluate(el=>!!(document.querySelector('footer').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByRole('button',{name:'Hide diagnostics'}).click();await expect(panel).toHaveCount(0);
  await page.reload();await expect(page.getByLabel('Attempts remaining')).toContainText('unlimited tries');await expect(panel).toHaveCount(0);
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'])await page.keyboard.press(key);
  await expect(panel).toHaveCount(0);
});

test('Konami reports show private passage details, cache selection and handle unavailable older reports',async({page})=>{
  const history=['latest','older'].map((id,index)=>({id,state:'rejected',submittedAt:Date.now()-10000*(index+1),precheck:'passed',checks:null}));
  await mockApi(page,{history});
  const reads=[];
  const passage={text:'The cat waited beside the window.',label:'AI-Generated',confidence:'High',assistanceScore:0.83,humanized:false,humanizerScore:0.12,probabilities:{human:0.1,assisted:0.2,ai:0.7},start:0,end:32,words:6,tokens:8};
  const absent={text:null,label:null,confidence:null,assistanceScore:null,humanized:null,humanizerScore:null,probabilities:null,start:null,end:null,words:null,tokens:null};
  await page.route('**/api/diagnostics/pangram?*',async route=>{
    const id=new URL(route.request().url()).searchParams.get('id');reads.push(id);
    if(id==='older')return route.fulfill({status:503,json:{message:'This report could not be retrieved. Try again later; older reports may no longer be available.'}});
    return route.fulfill({json:{breakdown:{version:'pangram-4.1',verdict:'Mixed',fractions:{human:0.5,assisted:0.2,ai:0.3},segments:{human:1,assisted:0,ai:1},passages:[passage,absent],truncated:false}}});
  });
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
  await expect(page.getByRole('region',{name:'Previous Results'}).getByRole('button',{name:/Attempt 2/})).toBeVisible();
  const report=page.getByRole('region',{name:'PANGRAM // DETAILED BREAKDOWN'});
  await expect(report).toHaveCount(0);expect(reads).toEqual([]);
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'])await page.keyboard.press(key);
  await expect(report.getByText(passage.text)).toBeVisible();
  const first=report.locator('.pangram-passage').first();
  await expect(first).toContainText('High');await expect(first).toContainText('83%');await expect(first).toContainText('Humanizer detectedNo');
  await expect(first.locator('.pangram-scores')).toHaveText('Human10%AI-assisted20%AI-generated70%');
  await report.getByText('Passage 2 // Label not supplied').click();
  await expect(report.locator('.pangram-passage').nth(1)).toContainText('Humanizer detectedNot supplied');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(passage.text);
  await report.screenshot({path:'outputs/pangram-breakdown-mobile.png'});
  await report.getByLabel('Attempt',{exact:true}).selectOption('older');
  await expect(report.getByRole('alert')).toContainText('older reports may no longer be available');
  await expect(report.getByText(passage.text)).toHaveCount(0);
  await report.getByLabel('Attempt',{exact:true}).selectOption('latest');
  await expect(report.getByText(passage.text)).toBeVisible();expect(reads).toEqual(['latest','older']);
  await report.getByRole('button',{name:'REFRESH REPORT'}).click();
  await expect.poll(()=>reads.length).toBe(3);
  await expect(report.getByText(passage.text)).toBeVisible();
  await page.setViewportSize({width:1280,height:1000});await page.emulateMedia({colorScheme:'light'});
  await report.screenshot({path:'outputs/pangram-breakdown-desktop.png'});
  await page.getByRole('button',{name:'Hide diagnostics'}).click();await expect(report).toHaveCount(0);
  for(const key of ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'])await page.keyboard.press(key);
  await expect(report.getByText(passage.text)).toBeVisible();expect(reads).toEqual(['latest','older','latest','latest']);
});

test('normal 225-word dialogue can be submitted without a symbol warning',async({page})=>{
  await mockApi(page);await page.goto('/');
  const begin=page.getByRole('button',{name:'BEGIN ATTEMPT',exact:true});
  await expect(begin.locator('svg')).toHaveCount(0);await begin.click();
  await page.getByRole('textbox').fill(Array(25).fill('“Don’t worry,” Mara said. “The cat’s safely inside tonight.”').join('\n\n'));
  await expect(page.locator('#word-count')).toContainText('225');
  await expect(page.getByText('Shorten the text or use fewer symbols.')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'SUBMIT SOLUTION'})).toBeEnabled();
});

test('previous result image failures are explicit and can be retried',async({page})=>{
  await page.addInitScript(()=>{
    window.__failImage=true;
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(...args){return window.__failImage&&args[0]==='2d'?null:original.apply(this,args);};
  });
  await mockApi(page,{outcome:'rejected'});await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();
  await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  await page.getByRole('button',{name:'Close result'}).click();
  const history=page.getByRole('region',{name:'Previous Results'});await history.getByRole('button',{name:/Attempt 1.*Fail/}).click();
  await expect(history.getByRole('alert')).toContainText('RESULT IMAGE GENERATION FAILURE');
  await expect(history.getByRole('button',{name:'SHARE TO X'})).toBeDisabled();
  await page.evaluate(()=>{window.__failImage=false;});await history.getByRole('button',{name:'Retry image'}).click();
  await expect(history.getByRole('img',{name:'HumansOnly result image: Fail'})).toBeVisible();
  await expect(history.getByRole('alert')).toHaveCount(0);await expect(history.getByRole('button',{name:'SHARE TO X'})).toBeEnabled();
});

test('copy prompt gives clean plain text for another window without submitting',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copiedPrompt=text;}},configurable:true}));
  await mockApi(page);await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();await page.getByRole('button',{name:'COPY PROMPT',exact:true}).click();
  await expect(page.getByRole('button',{name:'COPIED',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__copiedPrompt)).toBe(`Write a short story of 200-250 words using all three requirements below.\n\nSetting and time: ${prompt.setting}\nCharacters: ${prompt.characters}\nConflict: ${prompt.conflict}\n\nReturn only the story.`);
  await expect(page.getByRole('textbox',{name:'Your short story'})).toBeVisible();
  await expect(page.getByRole('button',{name:'SUBMIT SOLUTION',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('sharing does not contact the image host and provides a link if the draft window is blocked',async({page})=>{
  await page.addInitScript(()=>{window.open=()=>null;});
  await mockApi(page,{outcome:'rejected'});
  const imageRequests=[];
  await page.route(/\/api\/result-image|art\.10xcatdad\.xyz/,route=>{imageRequests.push(route.request().url());return route.fulfill({status:503,json:{message:'Unavailable'}});});
  await page.goto('/');await page.getByRole('button',{name:'BEGIN ATTEMPT'}).click();await page.getByRole('textbox').fill(story);await page.getByRole('button',{name:'SUBMIT SOLUTION'}).click();
  const dialog=page.getByRole('dialog',{name:'Fail',exact:true});await expect(dialog.getByRole('img')).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'SHARE TO X'}).click();
  expect((await downloadEvent).suggestedFilename()).toBe('humansonly-result.png');
  await expect(dialog.getByRole('status')).toContainText('Attach humansonly-result.png in X before posting.');
  const draft=new URL(await dialog.getByRole('link',{name:'Open X draft'}).getAttribute('href'));
  expect(draft.hostname).toBe('twitter.com');
  expect(draft.searchParams.get('text')).toBe('@10xCatDad I failed Level 1 of HumansOnly! :( (2/3 tries remaining)');
  expect(imageRequests).toEqual([]);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
