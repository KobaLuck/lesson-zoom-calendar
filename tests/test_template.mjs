import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const dir=new URL('../',import.meta.url).pathname;
const html=fs.readFileSync(dir+'Интерфейс.html','utf8');const ios=fs.readFileSync(dir+'Урок-Zoom-Scriptable.js','utf8');
new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
new (Object.getPrototypeOf(async function(){}).constructor)(ios);
assert.equal(JSON.parse(ios.split('\n')[0].slice('const HTML='.length,-1)),html);
const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function template(d)'),html.indexOf('function update()')),c);
c.d={name:'Юра',subject:'Математика',date:'2027-01-10',time:'13:00',zone:'Europe/Moscow',studentZone:'Europe/Moscow',board:'https://app.holst.so/board/example',lessonType:'trial',agreement:'mother'};
const render=()=>vm.runInContext('template(d)',c);
let t=render();
assert.match(t,/в 13:00 по МСК\./);assert.doesNotMatch(t,/по твоему времени/);
assert.match(t,/репетитор по математике/);assert.match(t,/Заниматься будем на доске Холст/);
assert.ok(t.includes('Выбери «Рисование» на панели и напиши что-нибудь на свободном месте. Почерк врача принимается 💀'));
assert.ok(t.endsWith('Дай знать, когда всё будет готово.\nБуду ждать!'));
assert.match(t,/обязательно напиши заранее, как только узнаешь/);
assert.doesNotMatch(t,/Миро|Пользовал|🤪|🥰|видосик/);
assert.equal(t.split('[ССЫЛКА ZOOM]').length-1,1);
assert.ok(t.replace('[ССЫЛКА ZOOM]','https://us06web.zoom.us/j/123456789?pwd=test').includes('?pwd=test'));
c.d.subject='Информатика';assert.match(render(),/репетитор по информатике/);
c.d.subject='инфа';assert.match(render(),/репетитор по информатике/);
c.d.studentZone='Asia/Yekaterinburg';assert.match(render(),/15:00 по твоему времени \(13:00 по МСК\)/);
c.d.studentZone='Pacific/Auckland';c.d.time='23:00';t=render();assert.match(t,/11 января/);assert.match(t,/10 января по МСК/);
c.d.lessonType='regular';c.d.agreement='father';t=render();assert.match(t,/Мы с твоим папой договорились на урок/);
c.d.board='';t=render();assert.doesNotMatch(t,/Почерк|доске|• Открыть доску/);assert.match(t,/1\. Ссылка на созвон/);assert.match(t,/3\. Немного о формате урока/);
// User data card and its fields remain present; startup ignores a previously saved Vietnam zone.
for(const id of ['name','subject','gender','board','studentZone','lessonType','agreement']){assert.ok(id==='gender'?html.includes("gender='м'"):html.includes('id="'+id+'"'))}
assert.ok(html.includes("$('zone').value='Europe/Moscow'"));assert.ok(html.includes('<option value="Europe/Moscow">Москва · МСК</option>'));
console.log('Passed: exact agreed wording, both subjects, dates/zones, optional board, fields preserved, Moscow default, Zoom placeholder, Scriptable UI identical and valid JavaScript.');
