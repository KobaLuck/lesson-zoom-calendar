import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../Урок-Zoom-Scriptable.js',import.meta.url),'utf8');
const fixtures={host:'teacher@example.com',account:'account-private-fixture',client:'client-private-fixture',secret:'secret-private-fixture',calendarUrl:'https://script.google.com/macros/s/example/exec',calendarToken:'google-private-fixture'};
async function scenario(mode){
 const values=new Map(),reports=[],forms=[];let active=null,failRead=mode.startsWith('read-'),writes=0;
 const zoom=[fixtures.host,fixtures.account,fixtures.client,fixtures.secret],google=[fixtures.calendarUrl,fixtures.calendarToken];
 class Alert{
  constructor(){this.fields=[];active=this}addAction(){}addCancelAction(){}addTextField(_,v){this.fields.push(v)}addSecureTextField(_,v){this.fields.push(v)}
  textFieldValue(i){
   if(active!==this)throw Error('Text field at index 0 does not exist');
   if(failRead&&i===0&&this.title===(mode==='read-zoom'?'Настройки Zoom':'Google Календарь')){failRead=false;throw Error('Text field at index 0 does not exist')}
   if(i>=this.fields.length)throw Error('No text field '+i);return this.fields[i];
  }
  async presentAlert(){
   if(this.title==='Настройки Zoom'){forms.push({service:'zoom',defaults:[...this.fields]});this.fields=[...zoom];if(mode==='missing')this.fields[1]='';return 0}
   if(this.title==='Google Календарь'){this.fields=[...google];if(mode==='bad-url'&&!reports.length)this.fields[0]='https://script.google.com/home/projects/example/edit';return 0}
   if(this.title.startsWith('Ошибка настроек:')){reports.push({title:this.title,message:this.message});return 1}
   throw Error('Unexpected alert '+this.title);
  }
 }
 class UITableRow{addText(title,subtitle){this.title=title;this.subtitle=subtitle}}
 class UITable{
  constructor(){this.rows=[]}addRow(r){this.rows.push(r)}removeAllRows(){this.rows=[]}reload(){}
  async present(){
   const tap=async()=>{await this.rows.find(r=>r.title==='Настройки подключения').onSelect()};
   await tap();
   if(mode==='ok'){
    assert.equal(reports.length,0);assert.equal(writes,6);assert.equal(values.get('lesson-zoom-Client Secret'),fixtures.secret);
    // Reopening blank secret fields preserves stored values, using each alert while current.
    zoom[1]='';zoom[2]='';zoom[3]='';google[1]='';await tap();assert.equal(reports.length,0);assert.equal(values.get('lesson-zoom-Client Secret'),fixtures.secret);
   }else{
    assert.equal(reports.length,1);const report=reports[0];
    if(mode==='read-zoom'){assert.match(report.title,/Zoom/);assert.match(report.message,/Email Zoom/);assert.match(report.message,/FORM_READ_0/)}
    if(mode==='read-google'){assert.match(report.title,/Google/);assert.match(report.message,/Адрес Google-скрипта/);assert.match(report.message,/FORM_READ_0/)}
    if(mode==='bad-url'){assert.match(report.message,/INVALID_CALENDAR_URL/);assert.equal(writes,0);await tap();assert.equal(reports.length,1);assert.equal(values.get('lesson-zoom-Client Secret'),fixtures.secret);assert.deepEqual(forms[1].defaults,[fixtures.host,fixtures.account,fixtures.client,fixtures.secret])}
    if(mode==='write'){assert.match(report.title,/Google/);assert.match(report.message,/Ключ Google-скрипта/);assert.match(report.message,/KEYCHAIN_WRITE/)}
    if(mode==='missing'){assert.match(report.title,/Zoom/);assert.match(report.message,/Account ID/);assert.match(report.message,/FIELD_REQUIRED/);assert.equal(writes,0)}
    for(const value of Object.values(fixtures))assert.ok(!report.message.includes(value),'credential leaked into diagnostics');
   }
  }
 }
 let copied='';const ctx=vm.createContext({UITable,UITableRow,Alert,Keychain:{contains:k=>values.has(k),get:k=>values.get(k),set:(k,v)=>{if(mode==='write'&&k.endsWith('Calendar Token'))throw Error('Cannot save '+v);writes++;values.set(k,v)}},Pasteboard:{copyString:s=>{copied=s}},Script:{complete(){}},Request:class{constructor(){throw Error('Settings must not create network requests')}}});
 await vm.runInContext('(async()=>{'+source+'})()',ctx);
 if(reports.length){assert.equal(copied,reports[reports.length-1].message);for(const value of Object.values(fixtures))assert.ok(!copied.includes(value))}
}
for(const mode of ['ok','read-zoom','read-google','bad-url','missing','write'])await scenario(mode);
console.log('Settings: strict native alert lifecycle, blank-key preservation, Zoom/Google field errors, retry drafts, Keychain failures and redacted copyable diagnostics passed.');
