import { chromium } from 'playwright'
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage()
await p.goto('http://127.0.0.1:1521',{waitUntil:'domcontentloaded',timeout:60000})
await p.getByPlaceholder(/username or email/i).fill('admin')
await p.getByPlaceholder(/your password/i).fill('password123')
await p.getByRole('button',{name:'Sign In'}).click()
await p.waitForTimeout(6000)
await p.getByText('Why The Sky Is Blue').first().click()
await p.waitForTimeout(4000)
const btns=await p.getByRole('button').all()
for(const btn of btns){
  const an=await btn.getAttribute('aria-label')||await btn.getAttribute('aria-expanded')||''
  const t=(await btn.textContent()||'').trim()
  if(/thought|expand|detail|show/i.test(an+t)){console.log('candidate btn:',JSON.stringify({an,t}))}
}
// the disclosure sits immediately before the label
const row=p.locator('div',{hasText:/^Thought$/}).last()
const chev=row.getByRole('button').first()
if(await chev.count()){await chev.click({force:true}).catch(e=>console.log('click err',e.message))}
await p.waitForTimeout(2500)
await p.screenshot({path:'/data/pbya/ziee/tmp/thinking-expanded2.png'})
console.log('reasoning visible:', await p.getByText(/Rayleigh|scatter|wavelength/i).count())
await b.close()
