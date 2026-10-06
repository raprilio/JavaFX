import{c as h}from"./chunk-WVFXHIOE.js";import{c as v}from"./chunk-CDZVSKFK.js";import{a as g,c as w,d as f,f as b,i as c}from"./chunk-OBJ2GABS.js";import{C as p,P as k,S as _,T as d,Z as x,c as $,d as t,e as i}from"./chunk-J465JRE2.js";var q=[["notebook-pen","Rich notes"],["square-check-big","Tasks & boards"],["calendar-days","Calendar & meetings"],["network","Mind maps"],["workflow","Flowcharts"],["mic","Voice notes"]];function S(o){let e=g.branding||{};return t`<div class="auth">
    <section class="auth-art ${e.background_url?"has-bg":""}" ${e.background_url?$(`style="background-image:url('${e.background_url}')"`):""}>
      <span class="auth-orb" style="width:340px;height:340px;right:-80px;top:-60px"></span>
      <span class="auth-orb" style="width:220px;height:220px;left:30%;bottom:8%;animation-delay:-3s"></span>
      <a class="brand" href="#/login">${e.logo_url?t`<img class="brand-logo" src="${e.logo_url}" alt="${e.app_name}">`:t`<span class="brand-mark">${i("notebook-pen")}</span>`}${!e.logo_url||e.logo_display!=="logo"?t`<span>${e.app_name}</span>`:""}</a>
      <div>
        <h2>Your notes, tasks and plans — beautifully in one place.</h2>
        <p>${e.app_tagline||"Capture ideas, organise work and never miss a meeting."}</p>
        <div class="auth-features">${q.map(([n,s])=>t`<div class="auth-feature">${i(n,"sm")} ${s}</div>`)}</div>
      </div>
      <small style="opacity:.6">© ${new Date().getFullYear()} ${e.app_name}</small>
    </section>
    <section class="auth-panel"><div class="auth-box">
      <div class="auth-mobile-brand">${e.logo_url?t`<span class="brand"><img class="brand-logo" src="${e.logo_url}" alt="${e.app_name}">${e.logo_display!=="logo"?e.app_name:""}</span>`:t`<span class="brand"><span class="brand-mark">${i("notebook-pen")}</span>${e.app_name}</span>`}</div>
      ${o}
    </div></section>
  </div>`}var m=(o,e,n="")=>t`<div class="field"><label for="${o}">${e}</label><div class="pw-wrap">
  <input class="input" id="${o}" type="password" name="${o}" ${$(n)}><button type="button" class="btn ghost icon" data-toggle-pw aria-label="Show password">${i("eye")}</button></div></div>`,E={login:()=>t`<h1>Welcome back</h1><p class="sub">Sign in to continue to your workspace.</p>
    <form data-form="login" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="username" required autofocus></div>
      ${m("password","Password",'autocomplete="current-password" required')}
      <div class="row between mb-3"><label class="check small"><input type="checkbox" name="remember" checked> Remember me</label><a class="small" href="#/forgot-password">Forgot password?</a></div>
      <button class="btn primary lg block" type="submit">Sign in ${i("arrow-right","sm")}</button>
    </form>
    ${g.branding?.allow_registration?t`<p class="small muted mt-3" style="text-align:center">No account yet? <a href="#/register">Create one</a></p>`:""}`,register:()=>t`<h1>Create your account</h1><p class="sub">Start organising your work in minutes.</p>
    <form data-form="register" novalidate>
      <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" required autofocus></div>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="email" required></div>
      ${m("password","Password",'autocomplete="new-password" required')}
      <p class="hint small subtle" style="margin-top:-6px">At least 8 characters with letters and numbers.</p>
      <button class="btn primary lg block mt-2" type="submit">Create account</button>
    </form><p class="small muted mt-3" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p>`,forgot:()=>t`<h1>Forgot password?</h1><p class="sub">Enter your e-mail and we will send you a link to reset it.</p>
    <form data-form="forgot" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" required autofocus></div>
      <button class="btn primary lg block" type="submit">Send reset link</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${i("arrow-left","sm")} Back to sign in</a></p>`,reset:()=>t`<h1>Set a new password</h1><p class="sub">Choose a strong password you don't use elsewhere.</p>
    <form data-form="reset" novalidate>
      ${m("password","New password",'autocomplete="new-password" required autofocus')}
      ${m("password_confirm","Confirm password",'autocomplete="new-password" required')}
      <button class="btn primary lg block" type="submit">Reset password</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${i("arrow-left","sm")} Back to sign in</a></p>`};function R(o){x("Set your password"),h(),o.innerHTML=String(S(t`<h1>Choose your own password</h1>
    <p class="sub">Hi ${g.user.name.split(" ")[0]}, your account was set up by an administrator. For security, set a personal password before continuing.</p>
    <form data-form="gate" novalidate>
      ${m("current_password","Temporary password",'autocomplete="current-password" required autofocus')}
      ${m("password","New password",'autocomplete="new-password" required')}
      ${m("password_confirm","Confirm new password",'autocomplete="new-password" required')}
      <p class="hint small subtle" style="margin-top:-6px">At least 8 characters with letters and numbers, different from the temporary password.</p>
      <button class="btn primary lg block mt-2" type="submit">Save & continue</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#" data-logout>Sign out</a></p>`));let e=o.querySelector("form");o.addEventListener("click",n=>{let s=n.target.closest("[data-toggle-pw]");if(s){let a=s.previousElementSibling;a.type=a.type==="password"?"text":"password"}n.target.closest("[data-logout]")&&(n.preventDefault(),w("logout"))}),e.addEventListener("submit",async n=>{n.preventDefault();let s=_(e);if(s.password!==s.password_confirm)return d(e,{password_confirm:1}),p("Passwords do not match","error");await k(e.querySelector("[type=submit]"),async()=>{try{await c.post("profile/password",s);let a=await c.get("app");b(a.csrf),f(a),p("Password saved \u2014 welcome!","success"),w("login")}catch(a){d(e,a.errors||{}),p(a.message,"error")}})})}var D={async render(o,{meta:e,query:n}){let s=e.mode;if(s==="register"&&!g.branding?.allow_registration)return v("/login",{replace:!0});x({login:"Sign in",register:"Register",forgot:"Forgot password",reset:"Reset password"}[s]),h(),o.innerHTML=String(S(E[s]()));let a=o.querySelector("form");o.addEventListener("click",y=>{let u=y.target.closest("[data-toggle-pw]");if(!u)return;let r=u.previousElementSibling;r.type=r.type==="password"?"text":"password",u.innerHTML=String(i(r.type==="password"?"eye":"eye-off"))}),a.addEventListener("submit",async y=>{y.preventDefault();let u=a.querySelector("[type=submit]"),r=_(a);d(a,{}),await k(u,async()=>{try{if(s==="login"){if(!r.email||!r.password)return d(a,{email:!r.email,password:!r.password});let l=await c.post("auth/login",r);b(l.csrf),f(l),p(`Welcome back, ${l.user.name.split(" ")[0]}!`,"success"),w("login")}else if(s==="register"){let l=await c.post("auth/register",r);b(l.csrf),f(l),p("Account created \u2014 welcome!","success"),w("login")}else if(s==="forgot")await c.post("auth/forgot",r),a.innerHTML=String(t`<div class="empty" style="padding:10px 0"><div class="empty-art">${i("mail-check","xl")}</div><h3>Check your inbox</h3>
              <p>If an account exists for <b>${r.email}</b>, a reset link is on its way. The link is valid for 60 minutes.</p></div>`);else if(s==="reset"){if(r.password!==r.password_confirm)return d(a,{password_confirm:1}),p("Passwords do not match","error");await c.post("auth/reset",{token:n.token,password:r.password}),p("Password updated. Please sign in.","success"),v("/login")}}catch(l){d(a,l.errors||{}),p(l.message,"error")}})})}};export{D as default,R as renderPasswordGate};
