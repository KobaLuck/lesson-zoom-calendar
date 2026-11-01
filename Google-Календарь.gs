/** Установить один раз в своём аккаунте Google. Сервис Calendar API v3 обязателен. */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('LESSON_TOKEN')) p.setProperty('LESSON_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  Calendar.Events.list(p.getProperty('CALENDAR_ID') || 'primary', {maxResults: 1});
  console.log('Ключ для настроек приложения: ' + p.getProperty('LESSON_TOKEN'));
}
function output_(data) {return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function doPost(e) {
  var lock = LockService.getScriptLock(), locked = false;
  try {
    if (!e || !e.postData || e.postData.contents.length > 100000) throw Error('Некорректный запрос.');
    var d = JSON.parse(e.postData.contents), p = PropertiesService.getScriptProperties();
    var token = p.getProperty('LESSON_TOKEN');
    if (!token || typeof d.token !== 'string' || d.token !== token) throw Error('Неверный ключ Google-скрипта.');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(d.requestId || '')) throw Error('Некорректный номер запроса.');
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 500 || typeof d.description !== 'string' || d.description.length > 40000) throw Error('Проверьте текст события.');
    if (!/^https:\/\/(?:[a-z0-9-]+\.)?zoom\.us\/j\/\d+(?:\?.*)?$/.test(d.zoomUrl || '')) throw Error('Нужна ссылка участника Zoom.');
    var start = new Date(d.start), end = new Date(d.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end-start > 86400000) throw Error('Проверьте время урока.');
    lock.waitLock(25000); locked = true;
    // Один и тот же запрос всегда имеет один ID, в том числе после потери ответа.
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.requestId + '|' + d.zoomUrl);
    var id = bytes.map(function(b){return ('0' + ((b+256)%256).toString(16)).slice(-2)}).join('');
    var calendar = p.getProperty('CALENDAR_ID') || 'primary', event;
    try {event = Calendar.Events.get(calendar, id)} catch (err) {
      if (!/404|not found/i.test(String(err))) throw err;
      event = Calendar.Events.insert({id:id,summary:d.title,description:d.description,location:d.zoomUrl,start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()}}, calendar, {sendUpdates:'none'});
    }
    if (event.status === 'cancelled') throw Error('Это событие удалено из календаря. Восстановите его в Google Календаре.');
    return output_({ok:true,eventId:event.id});
  } catch (err) {
    return output_({ok:false,error:String(err.message || err)});
  } finally {if (locked) lock.releaseLock()}
}
