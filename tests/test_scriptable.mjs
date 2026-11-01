import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../Урок-Zoom-Scriptable.js',import.meta.url),'utf8');
async function simulate(script,expectStartup){
 let shown=false,loaded='',replies=[],clipboard='',finished=false,close;
 const dismissed=new Promise(resolve=>{close=resolve});
 class WebView{
  constructor(){this.tail=Promise.resolve()}
  async loadHTML(html){
   loaded=html;
   this.page={window:{nativeQueue:[],nativeSend:null},setTimeout,clearTimeout,status:()=>{}};
   this.page.window.nativeReply=(id,value,error)=>{replies.push({id,value,error});if(replies.length===3)close()};
   this.page.window.init=()=>{const r={id:'init',action:'init',data:{}};this.page.window.nativeQueue.push(r);if(this.page.window.nativeSend)this.page.window.nativeSend(this.page.window.nativeQueue.shift())};
   vm.createContext(this.page);
  }
  evaluateJavaScript(code,useCallback=false){
   // Model a host that serializes evaluations until completion is called.
   const result=this.tail.then(()=>new Promise((resolve,reject)=>{
    this.page.completion=resolve;
    try{const v=vm.runInContext(code,this.page);if(!useCallback)resolve(v)}catch(e){reject(e)}
   }));
   this.tail=result.catch(()=>{});return result;
  }
  present(){
   shown=true;
   this.page.window.nativeQueue.push({id:'one',action:'init',data:{}},{id:'two',action:'copy',data:{text:'Привет 💀'}},{id:'three',action:'settings',data:{host:'invalid'}});
   return dismissed;
  }
 }
 const context=vm.createContext({WebView,Keychain:{contains:()=>false},Pasteboard:{copyString:t=>{clipboard=t}},Script:{complete:()=>{finished=true}},console,Alert:class{addAction(){}async presentAlert(){throw Error('Unexpected startup error')}},setTimeout,clearTimeout});
 let timer;const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Startup timed out before WebView presentation')),1800)});
 try{await Promise.race([vm.runInContext('(async()=>{'+script+'})()',context),watchdog])}catch(e){if(expectStartup)throw e;assert.match(e.message,/Startup timed out/);assert.equal(shown,false);return}
 finally{clearTimeout(timer)}
 assert.equal(shown,true);assert.equal(finished,true);assert.equal(clipboard,'Привет 💀');assert.equal(replies[0].value.connected,false);assert.equal(replies[1].error,null);assert.match(replies[2].error,/email/);assert.match(loaded,/window.INITIAL_CONFIG=/);
}
if(process.argv.includes('--old-must-fail')){await simulate(source,false);console.log('Old startup deadlock reproduced.')}else{await simulate(source,true);console.log('Scriptable: visible startup without a queued initialization, serialized bridge, copy and action errors passed.')}
