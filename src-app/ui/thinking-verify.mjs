import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage()
const errs=[]
p.on('console',m=>m.type()==='error'&&errs.push(m.text().slice(0,160)))
p.on('pageerror',e=>errs.push('PAGEERROR '+String(e).slice(0,160)))
await p.goto('http://127.0.0.1:1521',{waitUntil:'domcontentloaded',timeout:60000})
await p.getByPlaceholder(/username or email/i).fill('admin')
await p.getByPlaceholder(/your password/i).fill('password123')
await p.getByRole('button',{name:'Sign In'}).click()
await p.waitForTimeout(6000)
await p.getByPlaceholder(/type your message/i).fill(
  'Think carefully about why the sky is blue, then answer in one sentence.')
await p.keyboard.press('Enter')
for(let i=0;i<50;i++){
  await p.waitForTimeout(3000)
  const t=await p.getByText(/Thought/).count()
  if(t){console.log(`"Thought" row appeared @${(i+1)*3}s`);break}
}
await p.waitForTimeout(6000)
console.log('thinking-card (OLD boxed) count:', await p.locator('[data-testid="thinking-card"]').count())
console.log('"Thought" rows           :', await p.getByText(/Thought/).count())
await p.screenshot({path:'/data/pbya/ziee/tmp/thinking-rail.png'})
console.log('console errors:',errs.length); errs.slice(0,5).forEach(e=>console.log('  -',e))
await b.close()
