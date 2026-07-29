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
// expand the Thought row on the previous chat first
await p.getByText('Why The Sky Is Blue').first().click()
await p.waitForTimeout(4000)
await p.getByText(/^Thought$/).first().click().catch(()=>{})
await p.waitForTimeout(2500)
await p.screenshot({path:'/data/pbya/ziee/tmp/thinking-expanded.png'})
console.log('expanded shot taken')
await b.close()
