import{c as k}from"./chunk-RIBAFZJK.js";import{c as y}from"./chunk-CDZVSKFK.js";import{a as u,c as f,d as w,f as h,i as d}from"./chunk-GYVY4MO2.js";import{C as n,P as $,S as x,T as m,Z as S,c as v,d as s,e as t}from"./chunk-UHEN6QX4.js";var _=[["notebook-pen","Rich notes"],["square-check-big","Tasks & boards"],["calendar-days","Calendar & meetings"],["network","Mind maps"],["workflow","Flowcharts"],["mic","Voice notes"]];function q(r){let e=u.branding||{};return s`<div class="auth">
    <section class="auth-art ${e.background_url?"has-bg":""}" ${e.background_url?v(`style="background-image:url('${e.background_url}')"`):""}>
      <span class="auth-orb" style="width:340px;height:340px;right:-80px;top:-60px"></span>
      <span class="auth-orb" style="width:220px;height:220px;left:30%;bottom:8%;animation-delay:-3s"></span>
      <a class="brand" href="#/login">${e.logo_url?s`<img class="brand-logo" src="${e.logo_url}" alt="">`:s`<span class="brand-mark">${t("notebook-pen")}</span>`}<span>${e.app_name}</span></a>
      <div>
        <h2>Your notes, tasks and plans — beautifully in one place.</h2>
        <p>${e.app_tagline||"Capture ideas, organise work and never miss a meeting."}</p>
        <div class="auth-features">${_.map(([p,o])=>s`<div class="auth-feature">${t(p,"sm")} ${o}</div>`)}</div>
      </div>
      <small style="opacity:.6">© ${new Date().getFullYear()} ${e.app_name}</small>
    </section>
    <section class="auth-panel"><div class="auth-box">
      <div class="auth-mobile-brand">${e.logo_url?s`<img class="brand-logo" src="${e.logo_url}" alt="">`:s`<span class="brand"><span class="brand-mark">${t("notebook-pen")}</span>${e.app_name}</span>`}</div>
      ${r}
    </div></section>
  </div>`}var g=(r,e,p="")=>s`<div class="field"><label for="${r}">${e}</label><div class="pw-wrap">
  <input class="input" id="${r}" type="password" name="${r}" ${v(p)}><button type="button" class="btn ghost icon" data-toggle-pw aria-label="Show password">${t("eye")}</button></div></div>`,E={login:()=>s`<h1>Welcome back</h1><p class="sub">Sign in to continue to your workspace.</p>
    <form data-form="login" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="username" required autofocus></div>
      ${g("password","Password",'autocomplete="current-password" required')}
      <div class="row between mb-3"><label class="check small"><input type="checkbox" name="remember" checked> Remember me</label><a class="small" href="#/forgot-password">Forgot password?</a></div>
      <button class="btn primary lg block" type="submit">Sign in ${t("arrow-right","sm")}</button>
    </form>
    ${u.branding?.allow_registration?s`<p class="small muted mt-3" style="text-align:center">No account yet? <a href="#/register">Create one</a></p>`:""}`,register:()=>s`<h1>Create your account</h1><p class="sub">Start organising your work in minutes.</p>
    <form data-form="register" novalidate>
      <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" required autofocus></div>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" autocomplete="email" required></div>
      ${g("password","Password",'autocomplete="new-password" required')}
      <p class="hint small subtle" style="margin-top:-6px">At least 8 characters with letters and numbers.</p>
      <button class="btn primary lg block mt-2" type="submit">Create account</button>
    </form><p class="small muted mt-3" style="text-align:center">Already registered? <a href="#/login">Sign in</a></p>`,forgot:()=>s`<h1>Forgot password?</h1><p class="sub">Enter your e-mail and we will send you a link to reset it.</p>
    <form data-form="forgot" novalidate>
      <div class="field"><label for="email">E-mail</label><input class="input" id="email" type="email" name="email" required autofocus></div>
      <button class="btn primary lg block" type="submit">Send reset link</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${t("arrow-left","sm")} Back to sign in</a></p>`,reset:()=>s`<h1>Set a new password</h1><p class="sub">Choose a strong password you don't use elsewhere.</p>
    <form data-form="reset" novalidate>
      ${g("password","New password",'autocomplete="new-password" required autofocus')}
      ${g("password_confirm","Confirm password",'autocomplete="new-password" required')}
      <button class="btn primary lg block" type="submit">Reset password</button>
    </form><p class="small mt-3" style="text-align:center"><a href="#/login">${t("arrow-left","sm")} Back to sign in</a></p>`},P={async render(r,{meta:e,query:p}){let o=e.mode;if(o==="register"&&!u.branding?.allow_registration)return y("/login",{replace:!0});S({login:"Sign in",register:"Register",forgot:"Forgot password",reset:"Reset password"}[o]),k(),r.innerHTML=String(q(E[o]()));let l=r.querySelector("form");r.addEventListener("click",b=>{let c=b.target.closest("[data-toggle-pw]");if(!c)return;let a=c.previousElementSibling;a.type=a.type==="password"?"text":"password",c.innerHTML=String(t(a.type==="password"?"eye":"eye-off"))}),l.addEventListener("submit",async b=>{b.preventDefault();let c=l.querySelector("[type=submit]"),a=x(l);m(l,{}),await $(c,async()=>{try{if(o==="login"){if(!a.email||!a.password)return m(l,{email:!a.email,password:!a.password});let i=await d.post("auth/login",a);h(i.csrf),w(i),n(`Welcome back, ${i.user.name.split(" ")[0]}!`,"success"),f("login")}else if(o==="register"){let i=await d.post("auth/register",a);h(i.csrf),w(i),n("Account created \u2014 welcome!","success"),f("login")}else if(o==="forgot")await d.post("auth/forgot",a),l.innerHTML=String(s`<div class="empty" style="padding:10px 0"><div class="empty-art">${t("mail-check","xl")}</div><h3>Check your inbox</h3>
              <p>If an account exists for <b>${a.email}</b>, a reset link is on its way. The link is valid for 60 minutes.</p></div>`);else if(o==="reset"){if(a.password!==a.password_confirm)return m(l,{password_confirm:1}),n("Passwords do not match","error");await d.post("auth/reset",{token:p.token,password:a.password}),n("Password updated. Please sign in.","success"),y("/login")}}catch(i){m(l,i.errors||{}),n(i.message,"error")}})})}};export{P as default};
