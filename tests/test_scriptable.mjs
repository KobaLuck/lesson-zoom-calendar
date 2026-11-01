import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../Урок-Zoom-Scriptable.js',import.meta.url),'utf8');
assert.doesNotMatch(source,/new WebView|loadHTML|evaluateJavaScript|const HTML=/);
new (Object.getPrototypeOf(async function(){}).constructor)(source);
async function simulate(configured){
 const values=new Map(),calls=[],previews=[],notices=[];let clipboard='',completed=false,calendarFails=true,presented=false;
 if(configured)for(const [key,value] of Object.entries({'Account ID':'account','Client ID':'client','Client Secret':'secret','Email Zoom':'teacher@example.com','Calendar URL':'https://script.google.com/macros/s/example/exec','Calendar Token':'private-token'}))values.set('lesson-zoom-'+key,value);
 const textInputs={'Имя ученика':'Юра','Ссылка на доску Холст':'https://app.holst.so/board/example'};
 class Alert{
  constructor(){this.fields=[];this.actions=[]}addTextField(_,value){this.fields.push(value)}addSecureTextField(_,value){this.fields.push(value)}addAction(s){this.actions.push(s)}addCancelAction(){}textFieldValue(i){return this.fields[i]}
  async presentAlert(){if(this.title in textInputs){this.fields[0]=textInputs[this.title];return 0}notices.push({title:this.title,message:this.message});return 0}
  async presentSheet(){return this.title==='Предмет'?1:0}
 }
 class UITableRow{addText(title,subtitle){this.title=title;this.subtitle=subtitle}}
 class DatePicker{async pickDate(){return new Date(2099,0,10,12)}async pickTime(){return new Date(2099,0,10,13,0)}}
 class UITable{
  constructor(){this.rows=[]}addRow(r){this.rows.push(r)}removeAllRows(){this.rows=[]}reload(){}
  async present(){
   presented=true;assert.ok(this.rows.length>15,'native form must have visible rows before presentation');assert.equal(calls.length,0);
   assert.ok(this.rows.some(r=>r.title==='Новый урок · iPhone'));
   if(!configured)return;
   const tap=async title=>{const r=this.rows.find(x=>x.title===title);assert.ok(r?.onSelect,'missing action '+title);await r.onSelect()};
   await tap('Ученик');await tap('Предмет');await tap('Дата');await tap('Время');await tap('Ссылка на доску Холст');
   await tap('Посмотреть сообщение');assert.match(previews[0],/Юра.*по информатике/s);assert.match(previews[0],/13:00 по МСК/);assert.match(previews[0],/Почерк врача принимается 💀/);
   await tap('Создать Zoom, событие и сообщение');assert.equal(calls.filter(x=>x.endsWith('/meetings')).length,1);assert.ok(this.rows.some(r=>r.title==='Повторить добавление в календарь'));
   await tap('Скопировать сообщение');assert.match(clipboard,/https:\/\/us06web.zoom.us\/j\/123456789\?pwd=abc/);assert.doesNotMatch(clipboard,/\[ССЫЛКА ZOOM\]/);
   calendarFails=false;await tap('Повторить добавление в календарь');assert.equal(calls.filter(x=>x.endsWith('/meetings')).length,1);assert.ok(!this.rows.some(r=>r.title==='Повторить добавление в календарь'));
   const state=JSON.parse(values.get('lesson-zoom-ui-state'));assert.equal(state.last.calendarStatus,'created');assert.equal(state.students[0].studentOffset,3);assert.equal(values.get('lesson-zoom-Client Secret'),'secret');
   await tap('Ещё один урок');await tap('Последнее сообщение');assert.ok(this.rows.some(r=>r.title==='Скопировать сообщение'));
  }
 }
 class Request{constructor(url){this.url=url}async loadJSON(){assert.ok(presented,'no network before form is shown');calls.push(this.url);this.response={statusCode:200};if(this.url.includes('oauth'))return {access_token:'token'};if(this.url.endsWith('/meetings'))return {join_url:'https://us06web.zoom.us/j/123456789?pwd=abc',password:'abc'};if(calendarFails)throw Error('timeout');return {ok:true,eventId:'event'}}}
 const ctx=vm.createContext({UITable,UITableRow,Alert,DatePicker,Request,Keychain:{contains:k=>values.has(k),get:k=>values.get(k),set:(k,v)=>values.set(k,v)},Pasteboard:{copyString:s=>{clipboard=s},pasteString:()=>clipboard},QuickLook:{present:async text=>{previews.push(text)}},Data:{fromString:s=>({toBase64String:()=>Buffer.from(s).toString('base64')})},Script:{complete:()=>{completed=true}}});
 await vm.runInContext('(async()=>{'+source+'})()',ctx);assert.ok(presented);assert.ok(completed);assert.deepEqual(notices,[]);
}
await simulate(false);await simulate(true);
// Native template keeps the agreed wording, using UTC offsets without Intl or a browser.
const html=fs.readFileSync(new URL('../Интерфейс.html',import.meta.url),'utf8');
const desktop=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function template(d)'),html.indexOf('function update()')),desktop);
const native=vm.createContext({});vm.runInContext(source.split('// MESSAGE_TEMPLATE_START')[1].split('// MESSAGE_TEMPLATE_END')[0],native);
for(const offset of [3,5,7,5.5,-5,13]){
 const d={name:'Юра',subject:'Информатика',date:'2099-01-10',time:'23:00',zone:'Europe/Moscow',studentZone:offset===3?'Europe/Moscow':offset===5?'Asia/Yekaterinburg':offset===7?'Asia/Ho_Chi_Minh':offset===5.5?'Asia/Kolkata':offset===-5?'America/Panama':'Pacific/Auckland',studentOffset:offset,board:'https://app.holst.so/board/example',lessonType:'trial',agreement:'mother'};
 native.d=d;desktop.d=d;assert.equal(vm.runInContext('template(d)',native),vm.runInContext('template(d)',desktop));
}
console.log('Scriptable native UI: populated startup, no pre-start network, edit fields, template parity, Zoom, Calendar retry, copying, saved credentials and history passed.');
