'use strict';

async function deriveKey(pwd,salt){const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encrypt(plain,pwd){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pwd,salt),enc=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(plain)),out=new Uint8Array(28+enc.byteLength);out.set(salt,0);out.set(iv,16);out.set(new Uint8Array(enc),28);return btoa(String.fromCharCode(...out));}
async function decrypt(b64,pwd){const d=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),key=await deriveKey(pwd,d.slice(0,16)),dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:d.slice(16,28)},key,d.slice(28));return new TextDecoder().decode(dec);}
async function hashPassword(pwd){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('upsc-salt-2027-ias-'+pwd));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}

let sessionPwd='';

/* ── PRIVATE REPO: read/write password.hash ── */
async function fetchHashFromRepo(token,username,notesRepo){
  const r=await fetch('https://api.github.com/repos/'+username+'/'+notesRepo+'/contents/auth/password.hash',
    {headers:{'Authorization':'token '+token,'Accept':'application/vnd.github.v3+json'}});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('Cannot read password file from private repo. HTTP '+r.status);
  return atob((await r.json()).content.replace(/\n/g,'')).trim();
}

async function pushHashToRepo(token,username,notesRepo,hash){
  const url='https://api.github.com/repos/'+username+'/'+notesRepo+'/contents/auth/password.hash';
  const headers={'Authorization':'token '+token,'Accept':'application/vnd.github.v3+json','Content-Type':'application/json'};
  let sha=null;
  try{const r=await fetch(url,{headers});if(r.ok)sha=(await r.json()).sha||null;}catch(e){}
  const body={message:'[UPSC Auth] Update password hash',content:btoa(hash+'\n')};
  if(sha)body.sha=sha;
  const r=await fetch(url,{method:'PUT',headers,body:JSON.stringify(body)});
  if(!r.ok){const e=await r.json();throw new Error(e.message||'HTTP '+r.status);}
}

/* ── DETECT FIRST-TIME SETUP ── */
function isBootstrapMode(){return !localStorage.getItem('upsc_cfg_enc');}

/* ── RENDER LOCK SCREEN ── */
function renderLockScreen(){
  const box=document.querySelector('.lock-box');
  if(!box) return;

  if(isBootstrapMode()){
    box.innerHTML=`
      <span class="lock-emblem">&#9672; UPSC Command Centre &middot; IAS 2027</span>
      <div class="lock-title">First Time<br><span>Setup</span></div>
      <p class="lock-sub" style="margin-bottom:1.25rem;">Connect your private repo and set your password. Runs once per device.</p>
      <div style="text-align:left;">
        <label class="bs-label">GitHub Username</label>
        <input class="lock-input" type="text" id="bsUsername" placeholder="your-github-username" autocomplete="off" style="letter-spacing:0.05em;text-align:left;margin-bottom:0.75rem;"/>
        <label class="bs-label">GitHub Token (repo scope)</label>
        <input class="lock-input" type="password" id="bsToken" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off" style="letter-spacing:0.05em;text-align:left;margin-bottom:0.75rem;"/>
        <label class="bs-label">Private Notes Repo Name</label>
        <input class="lock-input" type="text" id="bsRepo" value="upsc-notes" autocomplete="off" style="letter-spacing:0.05em;text-align:left;margin-bottom:0.75rem;"/>
        <label class="bs-label">Set Your App Password</label>
        <input class="lock-input" type="password" id="bsPassword" placeholder="Choose a strong password (min 6 chars)" autocomplete="off" style="margin-bottom:0.75rem;"/>
        <label class="bs-label">Confirm Password</label>
        <input class="lock-input" type="password" id="bsConfirm" placeholder="Repeat password" autocomplete="off" style="margin-bottom:0;"/>
      </div>
      <button class="lock-btn" id="lockBtn" onclick="bootstrapSetup()" style="margin-top:1.25rem;">Connect &amp; Set Password</button>
      <div class="lock-error" id="lockError"></div>
      <div class="lock-hint">
        Password hash saved to your <strong>private</strong> GitHub repo.<br>
        Nobody else can set or change it without your token.<br>
        New device later? Enter the same password you set here.
      </div>`;
  } else {
    box.innerHTML=`
      <span class="lock-emblem">&#9672; UPSC Command Centre &middot; IAS 2027</span>
      <div class="lock-title">Private<br><span>Access Only</span></div>
      <p class="lock-sub">Enter your password to continue</p>
      <input class="lock-input" type="password" id="lockPassword" placeholder="Enter password" autocomplete="off"/>
      <button class="lock-btn" id="lockBtn" onclick="unlock()">Unlock</button>
      <div class="lock-error" id="lockError"></div>
      <div class="lock-hint">
        Password verified against your private GitHub repo.<br>
        Wrong password = no access on any device, ever.
      </div>`;
    setTimeout(()=>{
      const inp=document.getElementById('lockPassword');
      if(!inp) return;
      inp.focus();
      inp.addEventListener('keydown',e=>{
        if(e.key==='Enter') unlock();
        const err=document.getElementById('lockError');
        if(err) err.style.display='none';
      });
    },50);
  }
}

/* ── BOOTSTRAP (first time) ── */
async function bootstrapSetup(){
  const username=(document.getElementById('bsUsername')||{value:''}).value.trim();
  const token=(document.getElementById('bsToken')||{value:''}).value.trim();
  const notesRepo=(document.getElementById('bsRepo')||{value:'upsc-notes'}).value.trim()||'upsc-notes';
  const pwd=(document.getElementById('bsPassword')||{value:''}).value;
  const confirm=(document.getElementById('bsConfirm')||{value:''}).value;

  if(!username){showLockError('Enter your GitHub username.');return;}
  if(!token||(!token.startsWith('ghp_')&&!token.startsWith('github_pat_'))){showLockError('Enter a valid GitHub token (ghp_...).');return;}
  if(pwd.length<6){showLockError('Password must be at least 6 characters.');return;}
  if(pwd!==confirm){showLockError('Passwords do not match.');return;}

  const btn=document.getElementById('lockBtn');
  btn.disabled=true;

  try{
    setLockStatus('Verifying GitHub token...');
    const ur=await fetch('https://api.github.com/user',{headers:{'Authorization':'token '+token,'Accept':'application/vnd.github.v3+json'}});
    if(!ur.ok) throw new Error('Invalid token. Make sure it has "repo" scope.');

    const rr=await fetch('https://api.github.com/repos/'+username+'/'+notesRepo,{headers:{'Authorization':'token '+token,'Accept':'application/vnd.github.v3+json'}});
    if(rr.status===404) throw new Error('Repo "'+username+'/'+notesRepo+'" not found. Create it first on GitHub (Private, with README).');
    if(!rr.ok) throw new Error('Cannot access repo. Ensure token scope is "repo".');

    setLockStatus('Checking password status in private repo...');
    const existingHash=await fetchHashFromRepo(token,username,notesRepo);

    if(existingHash){
      // Password already set from another device — verify this matches
      setLockStatus('Account already has a password. Verifying...');
      if(await hashPassword(pwd)!==existingHash)
        throw new Error('This account already has a password set. Enter the existing password — not a new one.');
    } else {
      // First ever setup — save hash to private repo
      setLockStatus('Saving password hash to private repo...');
      await pushHashToRepo(token,username,notesRepo,await hashPassword(pwd));
    }

    setLockStatus('Encrypting credentials locally...');
    window.cfg={token,username,notesRepo};
    localStorage.setItem('upsc_cfg_enc',await encrypt(JSON.stringify(window.cfg),pwd));
    sessionPwd=pwd;
    await openApp();

  } catch(e){
    showLockError(e.message);
    btn.disabled=false;
    btn.innerHTML='Connect &amp; Set Password';
  }
}

/* ── NORMAL UNLOCK ── */
async function unlock(){
  const input=document.getElementById('lockPassword');
  const pwd=input?input.value:'';
  if(!pwd){showLockError('Enter your password.');return;}

  const btn=document.getElementById('lockBtn');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>';

  try{
    // Gate 1: decrypt localStorage with entered password
    setLockStatus('Decrypting credentials...');
    const raw=localStorage.getItem('upsc_cfg_enc');
    if(!raw) throw new Error('No credentials found. Clear site data and run setup again.');

    let cfg;
    try{ cfg=JSON.parse(await decrypt(raw,pwd)); }
    catch(e){
      document.querySelector('.lock-box').classList.add('shake');
      setTimeout(()=>document.querySelector('.lock-box').classList.remove('shake'),400);
      showLockError('Incorrect password.');
      btn.disabled=false;btn.textContent='Unlock';
      if(input){input.value='';input.focus();}
      return;
    }

    // Gate 2: verify hash against private repo
    setLockStatus('Verifying against private repo...');
    let remoteHash=null;
    try{ remoteHash=await fetchHashFromRepo(cfg.token,cfg.username,cfg.notesRepo); }
    catch(e){ console.warn('Offline — skipping remote check.'); }

    if(remoteHash!==null && await hashPassword(pwd)!==remoteHash){
      document.querySelector('.lock-box').classList.add('shake');
      setTimeout(()=>document.querySelector('.lock-box').classList.remove('shake'),400);
      showLockError('Password changed from another device. Use the new password.');
      btn.disabled=false;btn.textContent='Unlock';
      if(input){input.value='';input.focus();}
      return;
    }

    sessionPwd=pwd;
    Object.assign(window.cfg,cfg);
    await openApp();

  } catch(e){
    showLockError(e.message);
    btn.disabled=false;btn.textContent='Unlock';
  }
}

/* ── OPEN / LOCK ── */
async function openApp(){
  document.getElementById('lockScreen').style.display='none';
  document.getElementById('app').style.display='block';
  try{const nc=localStorage.getItem('upsc_nc');if(nc)window.notes=JSON.parse(nc);}catch(e){window.notes=[];}
}

function lockApp(){
  sessionPwd='';
  window.cfg={username:'',notesRepo:'upsc-notes'};
  window.notes=[];
  document.getElementById('app').style.display='none';
  document.getElementById('lockScreen').style.display='flex';
  renderLockScreen();
  const sb=document.getElementById('syncBar');if(sb)sb.style.display='none';
}

/* ── CHANGE PASSWORD (called from Setup tab) ── */
async function changePassword(){
  const cur=document.getElementById('currentPwd').value;
  const nw=document.getElementById('newPwd').value;
  const conf=document.getElementById('confirmPwd').value;
  if(nw!==conf){setPwdStatus('error','Passwords do not match.');return;}
  if(nw.length<6){setPwdStatus('error','Minimum 6 characters.');return;}
  setPwdStatus('loading','<span class="spinner"></span>Verifying against private repo...');
  try{
    const rh=await fetchHashFromRepo(window.cfg.token,window.cfg.username,window.cfg.notesRepo);
    if(!rh) throw new Error('Could not fetch hash from private repo.');
    if(await hashPassword(cur)!==rh){setPwdStatus('error','Current password is wrong.');return;}
    setPwdStatus('loading','<span class="spinner"></span>Pushing new hash to private repo...');
    await pushHashToRepo(window.cfg.token,window.cfg.username,window.cfg.notesRepo,await hashPassword(nw));
    localStorage.setItem('upsc_cfg_enc',await encrypt(JSON.stringify(window.cfg),nw));
    sessionPwd=nw;
    document.getElementById('currentPwd').value='';
    document.getElementById('newPwd').value='';
    document.getElementById('confirmPwd').value='';
    setPwdStatus('success','&#10003; Password updated. All devices need the new password on next login.');
  } catch(e){setPwdStatus('error',e.message);}
}

/* ── HELPERS ── */
function showLockError(msg){const el=document.getElementById('lockError');if(!el)return;el.textContent=msg;el.style.display='block';}
function setLockStatus(msg){const btn=document.getElementById('lockBtn');if(btn)btn.innerHTML='<span class="spinner"></span>'+msg;}
function setPwdStatus(type,msg){const el=document.getElementById('pwdStatus');if(!el)return;el.style.color={success:'#5a9a5a',error:'#c85a5a',loading:'#c8953a'}[type]||'var(--muted)';el.innerHTML=msg;}

document.addEventListener('DOMContentLoaded',renderLockScreen);
