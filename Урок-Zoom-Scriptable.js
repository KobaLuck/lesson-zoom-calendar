// Урок Zoom · iPhone · Native UI v3
// Урок Zoom · интерфейс для Scriptable на iPhone
const stateKey='lesson-zoom-ui-state';
const names={account:'Account ID',client:'Client ID',secret:'Client Secret',host:'Email Zoom',calendarUrl:'Calendar URL',calendarToken:'Calendar Token'};
function get(k){let n='lesson-zoom-'+names[k];return Keychain.contains(n)?Keychain.get(n):''}
function state(){return Keychain.contains(stateKey)?JSON.parse(Keychain.get(stateKey)):{students:[]}}
function save(s){Keychain.set(stateKey,JSON.stringify(s))}
function config(){return {...state(),host:get('host'),calendarUrl:get('calendarUrl'),calendarConnected:!!(get('calendarUrl')&&get('calendarToken')),connected:['account','client','secret','host'].every(k=>get(k))}}
async function post(url,body,headers){let r=new Request(url);r.method='POST';r.headers=headers;r.body=body;r.timeoutInterval=30;let v=await r.loadJSON();if(r.response.statusCode>=400){let e=Error('Zoom: '+(v.message||v.reason||r.response.statusCode));e.definite=r.response.statusCode<500;throw e}return v}
function calendarURLValid(url){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)}
async function syncCalendar(s){
 const result=s.last;
 if(!result||result.calendarStatus==='created'||!result.calendarPayload)return {...result,config:config()};
 try{
  if(!calendarURLValid(get('calendarUrl'))||!get('calendarToken'))throw Error('Заполните настройки Google Календаря.');
  const r=new Request(get('calendarUrl'));r.method='POST';r.headers={'Content-Type':'application/json'};r.body=JSON.stringify({...result.calendarPayload,token:get('calendarToken')});r.timeoutInterval=45;
  const v=await r.loadJSON();if(!v.ok||!v.eventId)throw Error(v.error||'Google не подтвердил создание события.');
  result.calendarStatus='created';result.calendarEventId=v.eventId;result.calendarError='';
 }catch(e){result.calendarStatus='pending';result.calendarError='Zoom создан, но урок ещё не добавлен в календарь. Проверьте настройки и подключение. '+e.message}
 s.last=result;save(s);return {...result,config:config()};
}
async function action(action,d){
 if(action==='init')return config();
 if(action==='copy'){Pasteboard.copyString(d.text);return {ok:true}}
 if(action==='syncCalendar'){let s=state();if(!s.last||s.last.requestId!==d.requestId)throw Error('Откройте последнее сообщение.');return await syncCalendar(s)}
 if(action==='settings'){
  if(!d.host||!d.host.includes('@'))throw Error('Введите email аккаунта Zoom.');
  if(!calendarURLValid(d.calendarUrl||get('calendarUrl')))throw Error('Введите адрес опубликованного Google-скрипта (/exec).');
  for(let k of Object.keys(names))if(!d[k]&&!get(k))throw Error('Заполните '+names[k]);
  for(let k of Object.keys(names))if(d[k])Keychain.set('lesson-zoom-'+names[k],d[k]);
  return {connected:true,calendarConnected:true};
 }
 if(action!=='create')throw Error('Неизвестное действие.');
 let s=state();
 if(s.last&&s.last.requestId===d.requestId)return await syncCalendar(s);
 if((s.uncertain||[]).includes(d.requestId))throw Error('Результат прошлого запроса неизвестен. Проверьте встречи в Zoom. Для новой попытки измените данные урока.');
 if(s.last&&s.last.calendarStatus==='pending')throw Error('Откройте последнее сообщение и добавьте предыдущий урок в календарь.');
 if(!config().calendarConnected)throw Error('Подключите Google Календарь.');
 if(d.board&&!/^https:\/\/(miro\.com|www\.miro\.com|app\.holst\.so)\/(?!recent(?:[/?#]|$)|all(?:[/?#]|$))[^?#]+/.test(d.board))throw Error('Нужна ссылка на доску Миро или Холст.');
 if(!d.name||!d.subject||!['м','ж'].includes(d.gender)||!['Europe/Moscow','Asia/Ho_Chi_Minh'].includes(d.zone))throw Error('Проверьте данные урока.');
 if(!Number.isInteger(d.duration)||d.duration<1||d.duration>1440)throw Error('Проверьте длительность.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))throw Error('Проверьте дату и время.');
 let start=new Date(d.date+'T'+d.time+':00'+(d.zone==='Europe/Moscow'?'+03:00':'+07:00'));
 if(!Number.isFinite(start.getTime())||start<=new Date())throw Error('Выберите будущее время урока.');
 if(!d.text.includes('[ССЫЛКА ZOOM]'))throw Error('В тексте нет места для ссылки Zoom.');
 if(!config().connected)throw Error('Заполните настройки Zoom.');
 let token=await post('https://zoom.us/oauth/token','grant_type=account_credentials&account_id='+encodeURIComponent(get('account')),{'Authorization':'Basic '+Data.fromString(get('client')+':'+get('secret')).toBase64String(),'Content-Type':'application/x-www-form-urlencoded'});
 let body={topic:d.subject+' — '+d.name,type:2,start_time:start.toISOString(),duration:d.duration,settings:{waiting_room:true,join_before_host:false,host_video:true,participant_video:true,use_pmi:false}};
 s.uncertain=[...(s.uncertain||[]),d.requestId].slice(-20);save(s);
 let m;
 try{m=await post('https://api.zoom.us/v2/users/'+encodeURIComponent(get('host'))+'/meetings',JSON.stringify(body),{'Authorization':'Bearer '+token.access_token,'Content-Type':'application/json'})}
 catch(e){if(e.definite){s.uncertain=s.uncertain.filter(x=>x!==d.requestId);save(s);throw e}throw Error('Zoom не ответил. Встреча могла создаться. Проверьте список встреч перед новой попыткой.')}
 if(!m.join_url)throw Error('Zoom не вернул ссылку. Проверьте список встреч.');
 let link=m.join_url+(m.password?'\nКод доступа: '+m.password:'');
 let [y,mo,day]=d.date.split('-');
 let result={requestId:d.requestId,text:d.text.split('[ССЫЛКА ZOOM]').join(link),url:m.join_url,title:d.name+' · '+day+'.'+mo+'.'+y+', '+d.time};
 result.calendarStatus='pending';result.calendarPayload={requestId:d.requestId,title:body.topic,start:start.toISOString(),end:new Date(start.getTime()+d.duration*60000).toISOString(),zoomUrl:m.join_url,description:result.text};
 s.last=result;s.defaults={subject:d.subject,zone:d.zone,duration:d.duration,time:d.time};
 if(d.remember)s.students=[{name:d.name,gender:d.gender,subject:d.subject,board:d.board,studentZone:d.studentZone,studentOffset:d.studentOffset,lessonType:d.lessonType,agreement:d.agreement},...(s.students||[]).filter(x=>x.name!==d.name).slice(0,19)];
 s.uncertain=s.uncertain.filter(x=>x!==d.requestId);save(s);return await syncCalendar(s);
}

// MESSAGE_TEMPLATE_START
function nativeShift(date,offset){return new Date(date.getTime()+offset*3600000)}
function nativeDateKey(date){return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0')}
function nativeOffset(d){return Number.isFinite(d.studentOffset)?d.studentOffset:({'Europe/Moscow':3,'Asia/Yekaterinburg':5,'Asia/Ho_Chi_Minh':7}[d.studentZone]||3)}
function template(d){
 const instant=new Date(d.date+'T'+d.time+':00'+(d.zone==='Europe/Moscow'?'+03:00':'+07:00'));
 const z=d.studentZone||'Europe/Moscow';
 const shifted=(date,zone)=>nativeShift(date,zone==='Europe/Moscow'?3:nativeOffset(d));
 const fmt=zone=>{const date=shifted(instant,zone);return String(date.getUTCHours()).padStart(2,'0')+':'+String(date.getUTCMinutes()).padStart(2,'0')};
 const day=zone=>{const date=shifted(instant,zone);return date.getUTCDate()+' '+['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][date.getUTCMonth()]};
 const dayKey=(date,zone)=>nativeDateKey(shifted(date,zone));
 const when=dayKey(instant,z)===dayKey(new Date(),z)?'сегодня':day(z);
 const msk=fmt('Europe/Moscow')+(dayKey(instant,z)!==dayKey(instant,'Europe/Moscow')?' '+day('Europe/Moscow'):'');
 const time=z==='Europe/Moscow'?`${fmt(z)} по МСК`:`${fmt(z)} по твоему времени (${msk} по МСК)`;
 const agreed={mother:'Мы с твоей мамой договорились',father:'Мы с твоим папой договорились',student:'Мы договорились'}[d.agreement]||'Мы договорились';
 const subject=({'математика':'по математике','геометрия':'по геометрии','алгебра':'по алгебре','информатика':'по информатике','инфа':'по информатике'})[d.subject.trim().toLowerCase()]||('по предмету «'+d.subject+'»');
 // Сохранённые доски Миро продолжают работать; для новых уроков используем Холст.
 const boardName=/^https:\/\/(?:www\.)?miro\.com\//i.test(d.board)?'Миро':'Холст';
 let t=`Привет${d.name?', '+d.name:''}! Это Никита, репетитор ${subject}. ${agreed} на ${d.lessonType==='trial'?'пробное занятие':'урок'} ${when} в ${time}.`;
 if(d.board)t+=`\n\nЗаниматься будем на доске ${boardName}. Снизу все ссылки и что с ними делать 👇`;
 t+='\n\nДобавь меня в контакты и заранее проверь, что всё открывается.';
 if(d.board){
  t+=`\n\n1. Доска ${boardName} ✍️\n${d.board}\n\nЛучше всего с планшета, но комп или ноут тоже ок. Если ничего из этого нет — можно с телефона. Если ${boardName} попросит войти, зарегистрируйся или зайди в свой аккаунт.\n\n`;
  t+=boardName==='Холст'?'Выбери «Рисование» на панели и напиши что-нибудь на свободном месте. Почерк врача принимается 💀':'Выбери инструмент для рисования и напиши что-нибудь на свободном месте. Почерк врача принимается 💀';
  t+='\n\nЕсли доска не открывается или не получается писать — напиши мне, разберёмся.';
 }
 const n=d.board?2:1;
 t+=`\n\n${n}. Ссылка на созвон\n[ССЫЛКА ZOOM]\n\nБудем с включёнными камерами, чтобы было удобнее общаться и никто не отвлекался 😤\n\n${n+1}. Что сделать до занятия?\n\n`;
 if(d.board)t+='• Открыть доску и попробовать что-нибудь написать.\n';
 return t+`• Проверить камеру и звук в Зуме.\n\n${n+2}. Немного о формате урока\n\nМы сразу на «ты».\nСпрашивай и перебивай, если что-то непонятно. Даже если нужно объяснить ещё раз — вообще без проблем.\n\nЕсли что-то не работает, опаздываешь или нужно отменить либо перенести урок — обязательно напиши заранее, как только узнаешь.\n\nДай знать, когда всё будет готово.\nБуду ждать!`;
}
// MESSAGE_TEMPLATE_END
// Native Scriptable interface. No HTML, WebView or browser/native bridge.
async function notice(title,message){const a=new Alert();a.title=title;a.message=message;a.addAction('Окей');await a.presentAlert()}
async function input(title,value,description){const a=new Alert();a.title=title;a.message=description||'';a.addTextField('',String(value==null?'':value));a.addAction('Сохранить');a.addCancelAction('Отмена');return await a.presentAlert()<0?null:a.textFieldValue(0).trim()}
async function choose(title,options){const a=new Alert();a.title=title;for(const o of options)a.addAction(o);a.addCancelAction('Отмена');return await a.presentSheet()}
async function openNativeLesson(){
 const table=new UITable();table.showSeparators=true;
 const initial=state(),defaults=initial.defaults||{};
 const now=nativeShift(new Date(),3);
 const d={name:'',gender:'м',subject:defaults.subject||'Математика',date:nativeDateKey(now),time:defaults.time||'18:00',zone:'Europe/Moscow',studentZone:'Europe/Moscow',studentOffset:3,duration:defaults.duration||60,board:'',remember:true,lessonType:'trial',agreement:'mother'};
 let busy=false,result=null,requestId=null,customText=null,statusText='Нажми на строку, чтобы изменить значение.';
 function changed(){requestId=null;customText=null}
 function message(){return customText||template(d)}
 async function perform(task){if(busy)return;busy=true;try{await task()}catch(e){await notice('Не получилось',e.message||String(e))}finally{busy=false;render()}}
 function row(title,subtitle,task,header=false){const r=new UITableRow();r.height=subtitle?64:48;r.isHeader=header;if(subtitle)r.addText(title,subtitle);else r.addText(title);r.dismissOnSelect=false;if(task&&!busy)r.onSelect=()=>perform(task);table.addRow(r)}
 async function edit(field,title,description){const v=await input(title,d[field],description);if(v!==null){d[field]=v;changed()}}
 async function settings(){
  const a=new Alert();a.title='Настройки Zoom';a.message='Пустые поля ключей сохраняют прежние значения.';
  a.addTextField('Email Zoom',get('host'));a.addTextField('Account ID','');a.addTextField('Client ID','');a.addSecureTextField('Client Secret','');a.addAction('Далее');a.addCancelAction('Отмена');
  if(await a.presentAlert()<0)return;
  const b=new Alert();b.title='Google Календарь';b.message='Адрес развертывания /exec и ключ из setup.';b.addTextField('Адрес Google-скрипта',get('calendarUrl'));b.addSecureTextField('Ключ Google-скрипта','');b.addAction('Сохранить');b.addCancelAction('Отмена');
  if(await b.presentAlert()<0)return;
  await action('settings',{host:a.textFieldValue(0).trim(),account:a.textFieldValue(1).trim(),client:a.textFieldValue(2).trim(),secret:a.textFieldValue(3),calendarUrl:b.textFieldValue(0).trim(),calendarToken:b.textFieldValue(1).trim()});
  statusText='Настройки сохранены.';
 }
 async function student(){
  const saved=state().students||[];
  if(saved.length){const i=await choose('Ученик',['Новый ученик',...saved.map(s=>s.name)]);if(i<0)return;if(i>0){Object.assign(d,saved[i-1]);d.studentOffset=nativeOffset(d);changed();return}}
  await edit('name','Имя ученика');
 }
 async function pickDay(){const picker=new DatePicker();const [y,m,day]=d.date.split('-').map(Number);picker.initialDate=new Date(y,m-1,day,12);const value=await picker.pickDate();d.date=[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');changed()}
 async function pickTime(){const picker=new DatePicker();const [h,m]=d.time.split(':').map(Number);const dt=new Date();dt.setHours(h,m,0,0);picker.initialDate=dt;const value=await picker.pickTime();d.time=String(value.getHours()).padStart(2,'0')+':'+String(value.getMinutes()).padStart(2,'0');changed()}
 async function studentZone(){
  const i=await choose('Часовой пояс ученика',['Москва · МСК','МСК+2 · Екатеринбург','Вьетнам · UTC+7','Другой пояс']);if(i<0)return;
  if(i<3){d.studentZone=['Europe/Moscow','Asia/Yekaterinburg','Asia/Ho_Chi_Minh'][i];d.studentOffset=[3,5,7][i]}
  else{const v=await input('Смещение от UTC',d.studentOffset,'Например: 3 для Москвы, 5.5 для Индии. Укажи смещение, действующее в день урока.');if(v===null)return;const n=Number(v.replace(',','.'));if(!v||!Number.isFinite(n)||n< -12||n>14||!Number.isInteger(n*4))throw Error('Нужно смещение UTC от −12 до +14 с шагом 0.25.');d.studentOffset=n;d.studentZone='UTC'+(n>=0?'+':'')+n}
  changed();
 }
 async function pasteText(){const text=Pasteboard.pasteString();if(!text)throw Error('Сначала скопируй свой текст в буфер.');if(result){result.text=text;statusText='Текст готов к копированию.'}else{if(!text.includes('[ССЫЛКА ZOOM]'))throw Error('В тексте должна быть метка [ССЫЛКА ZOOM].');customText=text;requestId=null;statusText='Используется твой текст. Изменение данных урока вернёт исходный шаблон.'}}
 async function create(){
  const cfg=config();if(!cfg.connected||!cfg.calendarConnected){await settings();return}
  if(!d.name.trim())throw Error('Введи имя ученика.');
  requestId=requestId||Date.now().toString(36)+Math.random().toString(36).slice(2);
  statusText='Создаём Zoom и добавляем урок в календарь…';render();
  result=await action('create',{...d,text:message(),requestId});statusText=result.calendarStatus==='created'?'Zoom и событие в календаре созданы.':'Zoom создан. Добавление в календарь нужно повторить.';
 }
 function render(){
  table.removeAllRows();row('Новый урок · iPhone','Встроенная форма Scriptable · версия 3',null,true);
  row(statusText,null);
  const connection=config();row('Настройки подключения',connection.connected&&connection.calendarConnected?'Zoom и Google Календарь настроены':'Нажми и заполни настройки',settings);
  if(result){
   row(result.title,result.calendarStatus==='created'?'Добавлено в Google Календарь':result.calendarError||'Ожидает добавления в календарь',null,true);
   row('Скопировать сообщение','С настоящей Zoom-ссылкой',async()=>{Pasteboard.copyString(result.text);statusText='Сообщение скопировано.'});
   row('Посмотреть сообщение',null,async()=>{await QuickLook.present(result.text,false)});
   row('Вставить свой текст из буфера','Для правки готового сообщения',pasteText);
   if(result.calendarStatus!=='created'&&result.calendarPayload)row('Повторить добавление в календарь','Без новой Zoom-встречи',async()=>{statusText='Добавляем в календарь…';render();result=await action('syncCalendar',{requestId:result.requestId});statusText=result.calendarStatus==='created'?'Урок добавлен в календарь.':result.calendarError});
   row('Ещё один урок',null,async()=>{result=null;changed();statusText='Нажми на строку, чтобы изменить значение.'});
  }else{
   row('Когда встречаемся?',null,null,true);
   row('Дата',d.date,pickDay);
   row('Время',d.time+(d.zone==='Europe/Moscow'?' · по Москве':' · по Вьетнаму'),pickTime);
   row('Часовой пояс времени урока',d.zone==='Europe/Moscow'?'Москва · МСК':'Вьетнам · UTC+7',async()=>{const i=await choose('Время урока',['По Москве','По Вьетнаму']);if(i>=0){d.zone=i===0?'Europe/Moscow':'Asia/Ho_Chi_Minh';changed()}});
   row('Длительность',d.duration+' минут',async()=>{const v=await input('Длительность, минут',d.duration);if(v!==null){const n=Number(v);if(!Number.isInteger(n)||n<1||n>1440)throw Error('Длительность от 1 до 1440 минут.');d.duration=n;changed()}});
   row('С кем занимаемся?',null,null,true);
   row('Ученик',d.name||'Нажми, чтобы ввести имя',student);
   row('Предмет',d.subject,async()=>{const options=['Математика','Информатика','Геометрия','Алгебра','Другой предмет'];const i=await choose('Предмет',options);if(i>=0){if(i===4)await edit('subject','Предмет');else{d.subject=options[i];changed()}}});
   row('Обращение',d.gender==='ж'?'Ученица':'Ученик',async()=>{d.gender=d.gender==='м'?'ж':'м';changed()});
   row('Часовой пояс ученика','UTC'+(nativeOffset(d)>=0?'+':'')+nativeOffset(d),studentZone);
   row('Формат',d.lessonType==='trial'?'Пробное занятие':'Обычный урок',async()=>{d.lessonType=d.lessonType==='trial'?'regular':'trial';changed()});
   row('С кем договорились?',{mother:'С мамой',father:'С папой',student:'С учеником'}[d.agreement],async()=>{const i=await choose('С кем договорились?',['С мамой','С папой','С учеником']);if(i>=0){d.agreement=['mother','father','student'][i];changed()}});
   row('Ссылка на доску Холст',d.board||'Необязательно',async()=>{await edit('board','Ссылка на доску Холст','Нужна ссылка на конкретную доску с доступом на редактирование.')});
   row('Запомнить ученика',d.remember?'Да':'Нет',async()=>{d.remember=!d.remember});
   row('Посмотреть сообщение','Текст обновляется при изменении данных',async()=>{await QuickLook.present(message(),false)});
   row('Скопировать шаблон','Для правки текста в Заметках',async()=>{Pasteboard.copyString(message());statusText='Шаблон скопирован. После правки верни его через «Вставить свой текст из буфера».'});
   row('Вставить свой текст из буфера',customText?'Используется твой текст':'Сохрани метку [ССЫЛКА ZOOM]',pasteText);
   if(customText)row('Вернуть исходный текст',null,async()=>{changed();statusText='Исходный шаблон восстановлен.'});
   row('Создать Zoom, событие и сообщение',null,create);
   if(state().last)row('Последнее сообщение',state().last.title,async()=>{result=state().last;statusText='Открыто сохранённое сообщение.'});
  }
  table.reload();
 }
 render();
 await table.present(false);
}
try{await openNativeLesson()}catch(e){await notice('Не удалось открыть урок',e.message||String(e))}
Script.complete();
