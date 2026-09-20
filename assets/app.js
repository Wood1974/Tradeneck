// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://jlaajejpqjldpbinktln.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsYWFqZWpwcWpsZHBiaW5rdGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDg3MTksImV4cCI6MjEwMTc4NDcxOX0.tP-seLGoJnivrYmNhhTDmDJw4Uk92D95-zrwWB1G_S4';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── STATE ────────────────────────────────────────────────────────────────────
let STATE = {
  user:null, profile:null, isAdmin:false,
  jobs:[], kslJobs:[], draws:[],
  appliedJobIds:{}, applicantCounts:{},
  activeWorkTab:'open', activeCounty:'all', activeAdmTab:'users', admLoaded:false,
  currentRatingJobId:null, currentRatingRevieweeId:null, currentRating:0,
  milestones:[],
  escrowMap:{} // draw_id → escrow status ('pending'|'held'|'released'|'refunded')
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
let authMode = 'signin';
function toggleAuth() {
  authMode = authMode==='signin'?'signup':'signin';
  document.getElementById('auth-submit').textContent = authMode==='signin'?'Sign In':'Create Account';
  document.querySelector('.auth-toggle-btn').textContent = authMode==='signin'?'Sign up':'Sign in';
}
async function authSubmit() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  errEl.textContent = '';
  if (!email||!password){errEl.textContent='Email and password required';return;}
  const res = authMode==='signup'
    ? await sb.auth.signUp({email,password})
    : await sb.auth.signInWithPassword({email,password});
  if (res.error){errEl.textContent=res.error.message;return;}
  if (authMode==='signup'&&!res.error){td.signUp();errEl.style.color='var(--green)';errEl.textContent='Check your email to confirm.';return;}
  td.login();
  await onLogin(res.data.user);
}
async function onLogin(user) {
  STATE.user = user;
  let {data:profile} = await sb.from('profiles').select('*').eq('id',user.id).single();
  if (!profile) {
    await sb.from('profiles').insert({id:user.id,email:user.email});
    profile = {id:user.id,email:user.email,tier:1};
  }
  STATE.profile = profile;
  /* Admin check is cosmetic only -- it shows/hides the tab. Real
     enforcement is the "Admins have full access" RLS policies from
     admin-setup.sql; nothing here grants any actual permission. This
     also tolerates profiles.is_admin not existing yet on the live
     database (admin-setup.sql not run) -- profile.is_admin is just
     undefined/falsy in that case, so the tab simply stays hidden. */
  STATE.isAdmin = !!profile.is_admin;
  if (STATE.isAdmin) document.getElementById('nav-admin').style.display = '';
  document.getElementById('landing').style.display   = 'none';
  document.getElementById('app').style.display       = 'block';
  document.getElementById('main-nav').style.display  = 'flex';
  await loadData();
  render();
  // Open whatever screen the URL asked for (deep link / refresh / back).
  switchTab(screenFromPath(location.pathname), {replace:true});
}
async function signOut(){await sb.auth.signOut();location.reload();}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
async function loadData() {
  const [jobsRes, drawRes, kslRes] = await Promise.all([
    sb.from('jobs').select('*').eq('status','open').eq('source','tradedeck').order('created_at',{ascending:false}).limit(50),
    sb.from('draw_schedules').select('*, draws(*)').order('created_at',{ascending:false}).limit(30),
    sb.from('jobs').select('*').eq('source','ksl').order('created_at',{ascending:false}).limit(200),
  ]);
  STATE.jobs    = jobsRes.data  || [];
  STATE.draws   = drawRes.data  || [];
  STATE.kslJobs = kslRes.data   || [];

  // Load escrow status for all draws
  STATE.escrowMap = {};
  const allDrawIds = STATE.draws.flatMap(s=>(s.draws||[]).map(d=>d.id)).filter(Boolean);
  if(allDrawIds.length){
    const {data:escrows} = await sb.from('stripe_escrow').select('draw_id,status').in('draw_id',allDrawIds);
    (escrows||[]).forEach(e=>{STATE.escrowMap[e.draw_id]=e.status;});
  }

  /* Applied state (mine only -- RLS on applications only lets a user
     see their own rows or rows on a job they posted, so this can't leak
     anyone else's applications) + privacy-safe applicant counts via the
     job_application_counts() RPC, which returns totals only, never who
     applied. */
  const jobIds = STATE.jobs.map(j=>j.id);
  STATE.appliedJobIds = {};
  STATE.applicantCounts = {};
  if (jobIds.length && STATE.user) {
    const [mineRes, countsRes] = await Promise.all([
      sb.from('applications').select('job_id').eq('applicant_id',STATE.user.id).in('job_id',jobIds),
      sb.rpc('job_application_counts',{p_job_ids:jobIds}),
    ]);
    (mineRes.data||[]).forEach(a=>{STATE.appliedJobIds[a.job_id]=true;});
    (countsRes.data||[]).forEach(row=>{STATE.applicantCounts[row.job_id]=row.applicant_count;});
  }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TAB_PATHS = {home:'/home', work:'/find-work', post:'/post-job', draws:'/draws',
                   workers:'/workers', profile:'/profile', admin:'/admin'};
const PATH_TABS = Object.fromEntries(Object.entries(TAB_PATHS).map(([k,v])=>[v,k]));

function screenFromPath(path){
  return PATH_TABS[path.replace(/\/+$/,'')||'/'] || 'home';
}

function switchTab(tab, opts) {
  opts = opts || {};
  if (!TAB_PATHS[tab]) tab = 'home';
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('#main-nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.getElementById('nav-'+tab).classList.add('active');

  const path = TAB_PATHS[tab];
  if (location.pathname !== path) {
    history[opts.replace ? 'replaceState' : 'pushState']({screen:tab}, '', path);
  }
  document.title = 'TradeDeck \u2014 ' + tab.charAt(0).toUpperCase() + tab.slice(1);
  td.page(path);

  window.scrollTo(0,0);
  if (tab==='admin') loadAdmin();
}

window.addEventListener('popstate', e => {
  if (!STATE.user) return;          // landing page: let the browser handle it
  switchTab((e.state && e.state.screen) || screenFromPath(location.pathname), {replace:true});
});
function workTab(tab,btn) {
  STATE.activeWorkTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('county-tabs').style.display = tab==='ksl'?'flex':'none';
  renderWork();
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function render(){renderHome();renderWork();renderDraws();renderWorkers();renderProfile();}

function renderHome() {
  if (!STATE.profile) return;
  const tiers = ['','Verified','Active','Proven','Trusted','TradeDeck Pro'];
  document.getElementById('home-tier').textContent = tiers[STATE.profile.tier||1]||'Verified';
  document.getElementById('home-stats').innerHTML = `
    <div class="flex between"><span class="text-muted">Jobs available</span><strong>${STATE.jobs.length}</strong></div>
    <div class="flex between mt8"><span class="text-muted">Active draws</span><strong>${STATE.draws.length}</strong></div>
  `;
}

const COUNTIES = ['All','Beaver','Box Elder','Cache','Carbon','Daggett','Davis','Duchesne','Emery',
  'Garfield','Grand','Iron','Juab','Kane','Millard','Morgan','Piute','Rich','Salt Lake',
  'San Juan','Sanpete','Sevier','Summit','Tooele','Uintah','Utah','Wasatch','Washington','Wayne','Weber'];

const LEAD_CATEGORIES = [
  {cat:'Boots on the Ground — Free', items:[
    {name:'Jobsite Cold Outreach', cost:'free', link:'https://tradedeckapp.com', linkLabel:'Post on TradeDeck',
     desc:"Drive active job sites. Write down names and numbers from sub trucks. Call the numbers, visit the websites. Ask the landscaper if he knows an electrician — the highest-close-rate lead in the trades is a warm referral from another sub on the same site."},
    {name:'Lumber Yards & Supply Houses', cost:'free', link:'https://www.84lumber.com', linkLabel:'Visit',
     desc:"Counter staff at ProDesk, 84 Lumber, Marjam, and local yards know every GC in the market. Drop cards, build relationships, ask directly."},
    {name:'Equipment Rental Yards', cost:'free', link:'https://www.unitedrentals.com', linkLabel:'Visit',
     desc:"Anyone renting gear is actively working a job right now. United Rentals, Sunbelt, local yards — drop cards and QR codes at the counter."},
    {name:'Local Home & Trade Shows', cost:'free', link:'https://www.utahnahb.org', linkLabel:'Utah HBA Events',
     desc:"Home and garden shows, builder expos, and local trade events draw GCs, developers, and homeowners in the same room."},
    {name:'City & County Permit Records', cost:'free', link:'https://www.utah.gov', linkLabel:'Utah.gov',
     desc:"Building permits are public record. Search your city or county permitting portal — they show the GC, address, and project scope before the GC even needs you."},
  ]},
  {cat:'Digital — Free', items:[
    {name:'Google Business Profile', cost:'free', link:'https://business.google.com', linkLabel:'Visit',
     desc:'The most important free tool in the trades. When someone searches "contractor near me," your GBP determines whether you show up. Fill every field, add 20+ project photos, post updates weekly.'},
    {name:'PlanHub', cost:'free', link:'https://planhub.com/subcontractors', linkLabel:'Visit',
     desc:"Free sub plan — receive bid invitations from GCs in your trade and region. Check planhub.com for current network size."},
    {name:'LookingForSubs.com', cost:'free', link:'https://lookingforsubs.com', linkLabel:'Visit',
     desc:"GCs search this directory by ZIP code and trade to find subs directly. Free listing, no verification."},
    {name:'LinkedIn', cost:'free', link:'https://linkedin.com', linkLabel:'Visit',
     desc:'Search "General Contractor Utah" and send direct messages offering to fill their trade gaps.'},
    {name:'Facebook Groups', cost:'free', link:'https://facebook.com/groups', linkLabel:'Visit',
     desc:'Search "[Trade] Contractors [City/State]" — dozens of active groups. Engage as a member first, do not just post ads.'},
    {name:'Craigslist — Skilled Trades', cost:'free', link:'https://craigslist.org', linkLabel:'Visit',
     desc:"Subs still browse it. Post open jobs at low cost to seed your pipeline during launch. Check craigslist.org for current posting fees."},
    {name:'Nextdoor Pro', cost:'free', link:'https://nextdoor.com/business', linkLabel:'Visit',
     desc:"Hyperlocal community with high trust signal. Homeowners ask neighbors for contractor recs constantly."},
    {name:'SAM.gov', cost:'free', link:'https://sam.gov', linkLabel:'Visit',
     desc:"Federal system for government contract notices. Free to search and register — federal facilities need every trade."},
    {name:'State & DOT Bid Portals', cost:'free', link:'https://purchasing.utah.gov', linkLabel:'Utah Purchasing',
     desc:"State procurement portals and DOT lettings list public construction opportunities — parks, facilities, sidewalks, roofing."},
    {name:'BuildingConnected', cost:'free', link:'https://app.buildingconnected.com', linkLabel:'Visit',
     desc:"Free sub profile — GCs using BuildingConnected (Autodesk) invite subs from its directory."},
    {name:'ContractorTalk Forum', cost:'free', link:'https://www.contractortalk.com', linkLabel:'Visit',
     desc:"Active forum where trades professionals discuss finding subs, referrals, and work."},
  ]},
  {cat:'Digital — Paid', items:[
    {name:'Google LSA', cost:'paid', link:'https://ads.google.com/local-services-ads', linkLabel:'Visit',
     desc:"Local Services Ads — Google-verified badge, pay-per-lead. Best for urgent residential jobs; first caller wins. Check ads.google.com/local-services-ads for current pricing."},
    {name:'Thumbtack', cost:'paid', link:'https://thumbtack.com', linkLabel:'Visit',
     desc:"Pay-per-lead. Good for residential trades at every level. Check thumbtack.com for current pricing."},
    {name:'Angi', cost:'paid', link:'https://angi.com', linkLabel:'Visit',
     desc:"Homeowner directory built around reviews — the more reviews you have, the higher you rank. Check angi.com for current plans, pricing, and review policies."},
    {name:'Houzz Pro', cost:'paid', link:'https://houzz.com/pro', linkLabel:'Visit',
     desc:"Best for high-end residential. Photo portfolio quality is the feature here. Check houzz.com/pro for current pricing."},
    {name:'Construct-A-Lead', cost:'paid', link:'https://constructalead.com', linkLabel:'Visit',
     desc:"Human-verified commercial project intelligence across the US and Canada. Check constructalead.com for current plans and pricing."},
    {name:'ConstructConnect', cost:'paid', link:'https://constructconnect.com', linkLabel:'Visit',
     desc:"Largest North American commercial bid database. Get in front of GCs before they finalize their sub list."},
    {name:'Dodge Construction Network', cost:'paid', link:'https://construction.com', linkLabel:'Visit',
     desc:"Strongest pre-planning intelligence — find projects at the design phase, months before anyone else bids."},
    {name:'ConstructionBids.ai', cost:'paid', link:'https://constructionbids.ai', linkLabel:'Visit',
     desc:"AI-powered bid matching across procurement sources. Check constructionbids.ai for current pricing and trial terms."},
    {name:'HomeAdvisor', cost:'paid', link:'https://homeadvisor.com', linkLabel:'Visit',
     desc:"Pay-per-lead, shared leads. First caller wins — speed-to-lead is the main differentiator here. Check homeadvisor.com for current pricing."},
    {name:'BuildMapper', cost:'paid', link:'https://buildmapper.com', linkLabel:'Visit',
     desc:"AI reads every permit pull, scores it against your trade and timing window, tells you who to call first. Check buildmapper.com for current coverage areas."},
  ]},
  {cat:'Associations & Trade Networks', items:[
    {name:'AGC Utah', cost:'paid', link:'https://agcutah.com', linkLabel:'Visit',
     desc:"Associated General Contractors — Utah chapter. Direct warm-intro channel to GCs who hire subs."},
    {name:'Home Builders Association of Utah', cost:'paid', link:'https://www.utahnahb.org', linkLabel:'Visit',
     desc:"Residential-focused and aligned with the Wasatch Back custom home market."},
    {name:'ABC (Associated Builders & Contractors)', cost:'paid', link:'https://abc.org', linkLabel:'Visit',
     desc:"Nationwide network with local chapters. Strong for commercial sub networks."},
    {name:'Local Union Halls', cost:'free', link:'https://www.ibew.org', linkLabel:'IBEW',
     desc:"IBEW, UA, Carpenters, Laborers — union halls post work boards for licensed members (electrical, plumbing, piping)."},
  ]},
  {cat:'Job Boards', items:[
    {name:'Indeed', cost:'free', link:'https://indeed.com', linkLabel:'Visit',
     desc:"GCs post sub and crew positions here constantly. Search your trade + city and set a daily email alert."},
    {name:'ZipRecruiter', cost:'free', link:'https://ziprecruiter.com', linkLabel:'Visit',
     desc:"AI-powered job matching with better quality filtering than raw boards."},
    {name:'Monster', cost:'free', link:'https://monster.com', linkLabel:'Visit',
     desc:"Older but still active for construction trades — more traction for licensed tradespeople."},
  ]},
];

function renderWork() {
  const el = document.getElementById('work-content');
  const countyEl = document.getElementById('county-tabs');
  if (STATE.activeWorkTab==='ksl') {
    countyEl.style.display = 'flex';
    countyEl.innerHTML = COUNTIES.map(c=>`
      <button class="county-tab${(c==='All'&&STATE.activeCounty==='all')||(c===STATE.activeCounty)?' active':''}"
        onclick="filterCounty('${c==='All'?'all':c}',this)">${c}</button>`).join('');
    const nearbyCounties = ['Salt Lake','Wasatch','Utah','Weber','Davis','Summit'];
    const filtered = STATE.kslJobs.filter(j=>nearbyCounties.includes(j.county));
    const jobs = STATE.activeCounty==='all'?filtered:filtered.filter(j=>j.county===STATE.activeCounty);
    el.innerHTML = jobs.length ? jobs.map(j=>`
      <div class="card">
        <div class="flex between"><h3>${j.title}</h3><span class="badge badge-ksl">KSL</span></div>
        <p>${j.company||''} · ${j.location||''}, ${j.county||''}</p>
        <p style="margin-top:6px">${(j.description||'').slice(0,120)}…</p>
        <p class="text-muted" style="margin-top:4px;font-size:12px">${j.rate||''}</p>
      </div>`).join('') : '<p class="text-muted" style="padding:20px 0">No KSL jobs in this area yet.</p>';
  } else if (STATE.activeWorkTab==='leads') {
    countyEl.style.display = 'none';
    el.innerHTML = LEAD_CATEGORIES.map(group=>`
      <div class="lead-category">${group.cat}</div>
      ${group.items.map(l=>`
        <div class="card">
          <div class="flex between"><h3>${l.name}</h3><span class="lead-tag lead-tag-${l.cost}">${l.cost}</span></div>
          <p style="margin-top:4px">${l.desc}</p>
          <a class="lead-link" href="${l.link}" target="_blank" rel="noopener">${l.linkLabel} →</a>
        </div>`).join('')}`).join('');
  } else {
    countyEl.style.display = 'none';
    el.innerHTML = STATE.jobs.length ? STATE.jobs.map(j=>{
      const isOwn = !!(j.owner_id && STATE.user && j.owner_id === STATE.user.id);
      const canRate = !!(j.owner_id && STATE.user && j.owner_id !== STATE.user.id);
      const applied = !!STATE.appliedJobIds[j.id];
      const count = STATE.applicantCounts[j.id]||0;
      return `
      <div class="card">
        <div class="flex between"><h3>${j.title}</h3><span class="badge badge-teal">${j.trade||'Trade'}</span></div>
        <p>${j.location||''}, ${j.county||''}</p>
        <p style="margin-top:4px">${j.rate||j.budget||''}</p>
        <p class="text-muted" style="margin-top:6px;font-size:12px">${(j.description||'').slice(0,100)}</p>
        <div class="flex between mt8" style="align-items:center">
          <span class="applicant-count">${count} applicant${count!==1?'s':''}</span>
          ${isOwn
            ? `<button class="btn btn-outline btn-sm" onclick="openApplicants('${j.id}')">View Applicants</button>`
            : `<button class="btn ${applied?'btn-outline':'btn-primary'} btn-sm" ${applied?'disabled':''} onclick="applyToJob('${j.id}',this)">${applied?'Applied':'Apply'}</button>`}
        </div>
        ${canRate ? `<button class="btn btn-outline btn-sm mt8" onclick="openRating('${j.id}','${j.owner_id}')">Rate Job</button>` : ''}
      </div>`;
    }).join('') : '<p class="text-muted" style="padding:20px 0">No open jobs yet. Be the first to post.</p>';
  }
}
function filterCounty(county,btn){
  STATE.activeCounty=county;
  document.querySelectorAll('.county-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderWork();
}

// ─── APPLY ────────────────────────────────────────────────────────────────────
async function applyToJob(jobId,btn){
  if (!STATE.user){alert('Please sign in again to apply.');return;}
  if (STATE.appliedJobIds[jobId]) return;
  btn.disabled = true;
  const existing = await sb.from('applications').select('id').eq('job_id',jobId).eq('applicant_id',STATE.user.id).maybeSingle();
  if (existing.data) {
    STATE.appliedJobIds[jobId] = true;
    btn.textContent = 'Applied'; btn.classList.remove('btn-primary'); btn.classList.add('btn-outline');
    return;
  }
  const {error} = await sb.from('applications').insert({job_id:jobId,applicant_id:STATE.user.id});
  if (error){alert('Could not submit your application. '+error.message);btn.disabled=false;return;}
  STATE.appliedJobIds[jobId] = true;
  STATE.applicantCounts[jobId] = (STATE.applicantCounts[jobId]||0)+1;
  td.jobApplied(jobId, (STATE.jobs.find(j=>j.id===jobId)||{}).trade);
  btn.textContent = 'Applied'; btn.classList.remove('btn-primary'); btn.classList.add('btn-outline');
}

// ─── POST JOB ─────────────────────────────────────────────────────────────────
let milestones = [];
function addMilestone(){milestones.push({name:'',pct:0,verifier:'owner'});renderMilestones();}
function removeMilestone(i){milestones.splice(i,1);renderMilestones();}
function renderMilestones(){
  const el = document.getElementById('milestone-rows');
  el.innerHTML = milestones.map((m,i)=>`
    <div class="milestone-row">
      <input placeholder="Name" value="${m.name}" oninput="milestones[${i}].name=this.value"/>
      <input class="pct-input" type="number" placeholder="%" value="${m.pct||''}" min="1" max="100"
        oninput="milestones[${i}].pct=+this.value;updatePct()"/>
      <select style="width:100px;margin-bottom:0" onchange="milestones[${i}].verifier=this.value">
        <option value="owner" ${m.verifier==='owner'?'selected':''}>Owner</option>
        <option value="inspector" ${m.verifier==='inspector'?'selected':''}>Inspector</option>
      </select>
      <button class="btn btn-outline btn-sm" onclick="removeMilestone(${i})">✕</button>
    </div>`).join('');
  updatePct();
}
function updatePct(){
  const total = milestones.reduce((s,m)=>s+(+m.pct||0),0);
  const el = document.getElementById('pct-total');
  el.textContent = milestones.length?`${total}% of 100%`:'';
  el.style.color = total===100?'var(--green)':total>100?'var(--danger)':'var(--muted)';
}
async function submitJob(){
  const title = document.getElementById('post-title').value.trim();
  if (!title){alert('Title required');return;}
  const total = milestones.reduce((s,m)=>s+(+m.pct||0),0);
  if (milestones.length&&total!==100){alert('Draw percentages must total 100%');return;}
  const {data:job,error} = await sb.from('jobs').insert({
    title,
    trade:    document.getElementById('post-trade').value,
    location: document.getElementById('post-city').value,
    county:   document.getElementById('post-county').value,
    state:    'UT',
    description: document.getElementById('post-desc').value,
    rate:     document.getElementById('post-budget').value,
    owner_id: STATE.user.id,
    source:   'tradedeck',
    status:   'open'
  }).select().single();
  if (error){alert('Error: '+error.message);return;}
  td.jobPosted(job.trade, job.county, parseInt(String(job.rate||'').replace(/\D/g,''))||0);
  if (milestones.length) {
    const budget = parseInt(document.getElementById('post-budget').value.replace(/\D/g,''))||0;
    const {data:sched} = await sb.from('draw_schedules').insert({
      job_id:         job.id,
      owner_id:       STATE.user.id,
      contract_value: budget||1
    }).select().single();
    if (sched) {
      // NOTE: draws.job_id is misleadingly named -- its FK actually points
      // at draw_schedules.id, not jobs.id (confirmed via the live FK
      // constraint "draws_schedule_id_fkey"). sched.id is correct here.
      await sb.from('draws').insert(milestones.map((m,i)=>({
        job_id:          sched.id,
        milestone_order: i+1,
        milestone_name:  m.name,
        percentage:      m.pct,
        amount_cents:    Math.round((budget||1)*100*(m.pct/100)),
        verifier_type:   m.verifier,
        status:          'pending'
      })));
    }
  }
  milestones=[];renderMilestones();
  ['post-title','post-city','post-desc','post-budget'].forEach(id=>document.getElementById(id).value='');
  await loadData();render();
  switchTab('work');
}

// ─── DRAW MANAGER ─────────────────────────────────────────────────────────────
function renderDraws(){
  const el = document.getElementById('draws-content');
  if (!STATE.draws.length){
    el.innerHTML='<p class="text-muted" style="padding:20px 0">No draw schedules yet. Add milestones when posting a job.</p>';
    return;
  }
  const isOwner = STATE.user && STATE.draws.some(s=>s.owner_id===STATE.user.id);
  el.innerHTML = STATE.draws.map(s=>{
    const draws = (s.draws||[]).sort((a,b)=>a.milestone_order-b.milestone_order);
    const releasedPct = draws.filter(d=>d.status==='approved'||d.status==='released').reduce((sum,d)=>sum+(d.percentage||0),0);
    const iAmOwner = STATE.user && s.owner_id===STATE.user.id;
    const hasPayee = !!s.payee_id;
    return `<div class="card">
      <div class="flex between"><h3>Draw Schedule</h3><span class="text-muted">$${(s.contract_value||0).toLocaleString()}</span></div>
      ${hasPayee?'':`<p class="text-muted" style="font-size:12px;margin-bottom:8px">⏳ Awaiting contractor assignment</p>`}
      <div class="escrow-bar"><div class="escrow-fill" style="width:${releasedPct}%"></div></div>
      <p class="text-muted" style="font-size:12px;margin-bottom:12px">${releasedPct}% released</p>
      ${draws.map(d=>{
        const dollarAmt = ((d.amount_cents||0)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
        const escrowStatus = STATE.escrowMap[d.id];
        const escrowHeld = escrowStatus==='held'||escrowStatus==='released';
        const escrowPending = escrowStatus==='pending';
        const canFund = iAmOwner && hasPayee && d.status==='pending' && !escrowStatus;
        const canApprove = iAmOwner && d.status==='submitted' && escrowHeld;
        return `
        <div class="flex between mt8" style="align-items:center">
          <div>
            <span style="font-size:14px">${d.milestone_order||''}. ${d.milestone_name||d.name||''} <span class="text-muted">(${d.percentage||d.pct||0}% · ${dollarAmt})</span></span>
            ${escrowPending?`<br><span style="font-size:11px;color:#ffb400">💳 Escrow pending payment</span>`:''}
            ${escrowHeld?`<br><span style="font-size:11px;color:var(--green)">✓ Escrow funded</span>`:''}
          </div>
          <div class="flex gap8" style="align-items:center">
            <span class="draw-status ${d.status}">${d.status}</span>
            ${canFund?`<button class="btn btn-outline btn-sm" onclick="openEscrowFunding('${d.id}','${s.id}',${d.amount_cents||0},'${d.milestone_name||d.name||''}')">💳 Fund</button>`:''}
            ${!iAmOwner&&d.status==='pending'?`<button class="btn btn-outline btn-sm" onclick="openPhotoUpload('${d.id}','${d.milestone_name||d.name||''}')">📷 Submit</button>`:''}
            ${canApprove?`
              <button class="btn btn-primary btn-sm" onclick="drawAction('${d.id}','approved')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="drawAction('${d.id}','disputed')">Dispute</button>`:''}
            ${iAmOwner&&d.status==='submitted'&&!escrowHeld?`<span style="font-size:11px;color:var(--danger)">Fund escrow first</span>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}
async function drawAction(id,status){
  if(status==='approved'){
    // Must go through Flask so Stripe capture + transfer fires
    const sess=await sb.auth.getSession();
    const token=sess?.data?.session?.access_token;
    if(!token){alert('Session expired. Please sign in again.');return;}
    const btn=event?.target;if(btn){btn.disabled=true;btn.textContent='Releasing…';}
    try{
      const res=await fetch(`https://tradedeck-api.onrender.com/draws/${id}/approve`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}
      });
      const json=await res.json().catch(()=>({}));
      if(!res.ok){
        const msg=json.error||`Server error (${res.status})`;
        alert(`Approval failed: ${msg}`);
        if(btn){btn.disabled=false;btn.textContent='Approve';}
        return;
      }
      // Flask handled Supabase update + Stripe transfer
      td.drawApproved(id);
    }catch(e){
      alert('Could not reach payment server. Check connection and try again.');
      if(btn){btn.disabled=false;btn.textContent='Approve';}
      return;
    }
  }else{
    // Submit and Dispute write Supabase directly (no money movement)
    const update={status};
    if(status==='disputed')update.resolved_at=new Date().toISOString();
    if(status==='submitted')update.submitted_at=new Date().toISOString();
    const{error}=await sb.from('draws').update(update).eq('id',id);
    if(error){alert('Update failed: '+error.message);return;}
  }
  await loadData();renderDraws();
}

// ─── PHOTO UPLOAD ─────────────────────────────────────────────────────────────
let _activePhotoDrawId = null;
let _pendingPhotoFiles = [];

function openPhotoUpload(drawId, milestoneName){
  _activePhotoDrawId = drawId;
  _pendingPhotoFiles = [];
  document.getElementById('photo-overlay-desc').textContent = `${milestoneName} — attach photos showing completed work. Claude AI will review them before the GC approves.`;
  document.getElementById('photo-preview-grid').innerHTML = '';
  document.getElementById('photo-file-input').value = '';
  document.getElementById('photo-upload-error').style.display = 'none';
  document.getElementById('photo-submit-btn').disabled = false;
  document.getElementById('photo-submit-btn').textContent = 'Submit for Approval';
  openOverlay('photo-overlay');
}

function previewPhotos(input){
  const files = Array.from(input.files).slice(0,5);
  _pendingPhotoFiles = files;
  const grid = document.getElementById('photo-preview-grid');
  grid.innerHTML = files.map((_,i)=>`<div style="background:var(--border);border-radius:6px;aspect-ratio:1;overflow:hidden"><img id="prev-${i}" alt="Milestone photo ${i+1} preview" style="width:100%;height:100%;object-fit:cover"/></div>`).join('');
  files.forEach((f,i)=>{
    const r=new FileReader(); r.onload=e=>{document.getElementById('prev-'+i).src=e.target.result;}; r.readAsDataURL(f);
  });
}

async function submitDrawPhotos(){
  if(!_pendingPhotoFiles.length){alert('Select at least one photo.');return;}
  const sess = await sb.auth.getSession();
  const token = sess?.data?.session?.access_token;
  if(!token){alert('Sign in required');return;}
  const btn = document.getElementById('photo-submit-btn');
  const errEl = document.getElementById('photo-upload-error');
  btn.disabled=true; errEl.style.display='none';
  let uploaded=0;
  for(const file of _pendingPhotoFiles){
    btn.textContent=`Uploading ${uploaded+1}/${_pendingPhotoFiles.length}…`;
    try{
      const b64 = await new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=e=>res(e.target.result.split(',')[1]);
        r.onerror=rej;
        r.readAsDataURL(file);
      });
      const ext = file.name.split('.').pop().toLowerCase()||'jpg';
      const res = await fetch(`${API}/draws/${_activePhotoDrawId}/photos/upload`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
        body: JSON.stringify({image_base64:b64, storage_path:`draws/${_activePhotoDrawId}/${Date.now()}-${uploaded}.${ext}`})
      });
      const json = await res.json().catch(()=>({}));
      if(!res.ok){
        errEl.textContent = json.error||`Upload failed (${res.status})`;
        errEl.style.display='block';
        btn.disabled=false; btn.textContent='Submit for Approval';
        return;
      }
      uploaded++;
    }catch(e){
      errEl.textContent='Upload failed. Check connection.';
      errEl.style.display='block';
      btn.disabled=false; btn.textContent='Submit for Approval';
      return;
    }
  }
  td.drawSubmitted(_activePhotoDrawId);
  closeOverlay('photo-overlay');
  await loadData(); renderDraws();
}

// ─── ESCROW FUNDING ───────────────────────────────────────────────────────────
const STRIPE_PK = 'pk_live_51TLWkLDuhYmg5JceXDvwLtNf67teMpBuUATIGt0MtR83ryknJC1vqsrobTlVi2ASugXMIgmcculiDTqKFi3IhzxP00pgwqICRE';
const API = 'https://tradedeck-api.onrender.com';
let _stripe=null, _stripeElements=null, _activeEscrowDrawId=null, _activeEscrowAmountCents=0;
let _stripeJsPromise=null;
function loadStripeJs(){
  if(window.Stripe) return Promise.resolve();
  if(!_stripeJsPromise){
    _stripeJsPromise = new Promise((resolve,reject)=>{
      const el=document.createElement('script');
      el.src='https://js.stripe.com/v3/';
      el.onload=resolve;
      el.onerror=()=>{_stripeJsPromise=null;reject(new Error('stripe.js failed to load'));};
      document.head.appendChild(el);
    });
  }
  return _stripeJsPromise;
}

async function openEscrowFunding(drawId, scheduleId, amountCents, milestoneName){
  _activeEscrowDrawId = drawId;
  _activeEscrowAmountCents = amountCents || 0;
  const sess = await sb.auth.getSession();
  const token = sess?.data?.session?.access_token;
  if(!token){alert('Sign in required');return;}

  const desc = document.getElementById('escrow-overlay-desc');
  const payEl = document.getElementById('escrow-payment-element');
  const errEl = document.getElementById('escrow-error');
  const btn   = document.getElementById('escrow-pay-btn');
  const dollarAmt = (amountCents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  desc.textContent = `${milestoneName} — ${dollarAmt}. Funds held in escrow until you approve the milestone.`;
  payEl.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">Loading payment form…</p>';
  errEl.style.display='none';
  btn.disabled=true;
  openOverlay('escrow-overlay');

  // Call Flask to create escrow & get client_secret
  let clientSecret;
  try{
    const res = await fetch(`${API}/stripe/escrow/create`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body: JSON.stringify({draw_id:drawId})
    });
    const json = await res.json().catch(()=>({}));
    if(!res.ok){
      payEl.innerHTML='';
      errEl.textContent = json.error||`Error ${res.status}`;
      errEl.style.display='block';
      return;
    }
    clientSecret = json.client_secret;
  }catch(e){
    payEl.innerHTML='';
    errEl.textContent='Could not reach server. Try again.';
    errEl.style.display='block';
    return;
  }

  // Mount Stripe Payment Element
  try{
    await loadStripeJs();
  }catch(e){
    payEl.innerHTML='';
    errEl.textContent='Could not load the payment form. Check your connection and try again.';
    errEl.style.display='block';
    return;
  }
  if(!_stripe) _stripe = Stripe(STRIPE_PK);
  _stripeElements = _stripe.elements({clientSecret, appearance:{theme:'night',variables:{colorPrimary:'#0bbcd4',colorBackground:'#1e2a3a',colorText:'#e2e8f0',borderRadius:'8px'}}});
  const payment = _stripeElements.create('payment');
  payEl.innerHTML='';
  payment.mount(payEl);
  btn.disabled=false;
}

async function confirmEscrowPayment(){
  const btn=document.getElementById('escrow-pay-btn');
  const errEl=document.getElementById('escrow-error');
  if(!_stripeElements||!_stripe){return;}
  btn.disabled=true; btn.textContent='Processing…';
  errEl.style.display='none';

  const {error} = await _stripe.confirmPayment({
    elements: _stripeElements,
    confirmParams:{return_url: window.location.href},
    redirect:'if_required'
  });

  if(error){
    errEl.textContent = error.message||'Payment failed';
    errEl.style.display='block';
    btn.disabled=false; btn.textContent='Fund Escrow';
    return;
  }

  // Payment confirmed — escrow now pending webhook to mark held
  td.escrowFunded(_activeEscrowDrawId, _activeEscrowAmountCents);
  STATE.escrowMap[_activeEscrowDrawId]='pending';
  closeOverlay('escrow-overlay');
  btn.textContent='Fund Escrow';
  await loadData(); renderDraws();
}

// ─── WORKER DIRECTORY ─────────────────────────────────────────────────────────
async function renderWorkers(){
  const el=document.getElementById('workers-grid');
  if(!STATE.user){el.innerHTML='<p class="text-muted" style="padding:20px">Sign in to view workers.</p>';return;}
  const search=document.getElementById('worker-search')?.value||'';
  let q=sb.from('profiles').select('id,email,full_name,trade,phone,tier,jobs_completed,created_at,checkr_status').gt('jobs_completed',0);
  if(search){q=q.or(`full_name.ilike.%${search}%,trade.ilike.%${search}%`);}
  const {data:workers,error}=await q.order('jobs_completed',{ascending:false}).limit(50);
  if(error||!workers?.length){el.innerHTML='<p class="text-muted" style="padding:20px">No workers found.</p>';return;}
  el.innerHTML=workers.map(w=>`
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h3>${w.full_name||w.email}</h3>
        <p class="text-muted">${w.trade||'–'} · ${w.jobs_completed||0} jobs · Tier ${w.tier||1}</p>
        ${w.checkr_status==='cleared'?'<p style="color:#4ade80;font-size:12px;margin-top:4px">✓ Background verified</p>':''}
      </div>
      <button class="btn btn-sm btn-outline" onclick="contactWorker('${w.id}')">Contact</button>
    </div>
  `).join('');
}
document.addEventListener('input',e=>{if(e.target.id==='worker-search')renderWorkers();});
async function contactWorker(wid){
  const {error}=await sb.from('contact_requests').insert({
    requester_id:STATE.user.id,
    worker_id:wid,
    status:'pending',
    created_at:new Date().toISOString()
  });
  if(error){alert(error.message);return;}
  alert('Contact request sent!');
}

// ─── CHECKR INTEGRATION ────────────────────────────────────────────────────────
async function startCheckr(){
  if(!STATE.user?.id){alert('Sign in required');return;}
  const btn=event.target;btn.disabled=true;btn.textContent='Starting…';
  const {data,error}=await fetch('/api/checkr/start',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({user_id:STATE.user.id,email:STATE.user.email,name:STATE.profile.full_name||'User'})
  }).then(r=>r.json());
  if(error||!data?.candidate_id){alert('Could not start background check. Try again later.');btn.disabled=false;btn.textContent='Start Background Check';return;}
  STATE.profile.checkr_candidate_id=data.candidate_id;
  await sb.from('profiles').update({checkr_candidate_id:data.candidate_id,checkr_status:'pending'}).eq('id',STATE.user.id);
  renderProfile();
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function renderProfile(){
  const el = document.getElementById('profile-content');
  if (!STATE.profile){el.innerHTML='';return;}
  const p = STATE.profile;
  const tiers=['','Verified','Active','Proven','Trusted','TradeDeck Pro'];
  el.innerHTML=`
    <div class="card">
      <h3>${p.full_name||p.email}</h3>
      <p class="text-muted">${p.trade||'No trade set'} · Tier: ${tiers[p.tier||1]||'Verified'}</p>
      ${p.rating>0?`<p class="text-muted" style="margin-top:4px">★ ${p.rating} · ${p.repeat_hire_rate}% repeat hire</p>`:''}
    </div>
    <div class="card">
      <h3>Edit Profile</h3>
      <label>Full Name</label>
      <input id="edit-name" value="${p.full_name||''}"/>
      <label>Company</label>
      <input id="edit-company" value="${p.company||''}"/>
      <label>Trade</label>
      <select id="edit-trade">
        ${['Framing','Concrete','Roofing','Electrical','Plumbing','HVAC','Drywall','Flooring','Excavation','Landscaping','General Contractor','Other']
          .map(t=>`<option ${p.trade===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <label>Phone</label>
      <input id="edit-phone" value="${p.phone||''}" placeholder="435-555-0100"/>
      <button class="btn btn-primary btn-block" onclick="saveProfile()">Save</button>
    </div>
    <div class="card">
      <h3>Payouts</h3>
      <p class="text-muted" style="font-size:14px;margin-bottom:12px">Connect your bank account to receive draw payments when GCs approve milestones.</p>
      ${p.stripe_account_id?`
        <div style="padding:12px;background:#1a3a1a;border:1px solid #4ade80;border-radius:4px">
          <p style="color:#4ade80;font-weight:bold">✓ Bank account connected</p>
          <p class="text-muted" style="font-size:12px;margin-top:4px">Payments will transfer automatically on approval.</p>
        </div>
      `:`
        <button class="btn btn-primary btn-block" onclick="connectStripe()">Connect Bank Account</button>
        <p class="text-muted" style="font-size:12px;margin-top:8px">Required to receive draw payments. Powered by Stripe.</p>
      `}
    </div>
    <div class="card">
      <h3>Background Verification</h3>
      <p class="text-muted">Verified contractors earn trust badges and appear higher in worker searches.</p>
      ${p.checkr_status==='cleared'?`
        <div style="padding:12px;background:#1a3a1a;border:1px solid #4ade80;border-radius:4px;margin:12px 0">
          <p style="color:#4ade80;font-weight:bold">✓ Background verified</p>
          <p class="text-muted" style="font-size:12px;margin-top:4px">Cleared on ${new Date(p.checkr_cleared_at).toLocaleDateString()}</p>
        </div>
      `:p.checkr_status==='pending'?`
        <div style="padding:12px;background:#3a3a1a;border:1px solid #facc15;border-radius:4px;margin:12px 0">
          <p style="color:#facc15;font-weight:bold">⏱ Verification pending</p>
          <p class="text-muted" style="font-size:12px;margin-top:4px">Check back in 1-2 business days</p>
        </div>
      `:`
        <button class="btn btn-primary btn-block" onclick="startCheckr()">Start Background Check</button>
        <p class="text-muted" style="font-size:12px;margin-top:8px">Takes 1-2 business days. Required for verified badges.</p>
      `}
    </div>
    <button class="btn btn-outline btn-block mt8" onclick="signOut()">Sign Out</button>
  `;
}
async function connectStripe(){
  td.stripeConnect();
  const sess = await sb.auth.getSession();
  const token = sess?.data?.session?.access_token;
  if(!token){alert('Sign in required');return;}
  const btn = event?.target; if(btn){btn.disabled=true;btn.textContent='Connecting…';}
  try{
    const res = await fetch(`${API}/stripe/connect/onboard`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body: JSON.stringify({user_id: STATE.user.id, email: STATE.profile.email, base_url: window.location.origin})
    });
    const json = await res.json().catch(()=>({}));
    if(!res.ok){alert(json.error||'Could not start Stripe onboarding');if(btn){btn.disabled=false;btn.textContent='Connect Bank Account';}return;}
    window.location.href = json.url;
  }catch(e){
    alert('Could not reach server. Try again.');
    if(btn){btn.disabled=false;btn.textContent='Connect Bank Account';}
  }
}

async function saveProfile(){
  const updates = {
    full_name: document.getElementById('edit-name').value,
    company:   document.getElementById('edit-company').value,
    trade:     document.getElementById('edit-trade').value,
    phone:     document.getElementById('edit-phone').value,
  };
  const {error} = await sb.from('profiles').update(updates).eq('id',STATE.user.id);
  if (error){alert(error.message);return;}
  STATE.profile = {...STATE.profile,...updates};
  renderProfile();
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
// Ported from app.html's Admin tab, adapted to the columns actually
// confirmed live (no jobs.hired_by/trade_type — those never existed on
// the real table). Gated cosmetically on STATE.isAdmin (nav button
// hidden unless profiles.is_admin is true) -- real enforcement is the
// "Admins have full access" RLS policies from admin-setup.sql.
function loadAdmin(){
  if (STATE.admLoaded) return;
  STATE.admLoaded = true;
  admLoadUsers();
}
function admTab(tab,btn){
  STATE.activeAdmTab = tab;
  document.querySelectorAll('.adm-subtab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.adm-subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('adm-'+tab).classList.add('active');
  if (tab==='jobs') admLoadJobs(); else admLoadUsers();
}
async function admLoadUsers(){
  const el = document.getElementById('adm-users');
  el.innerHTML = '<p class="text-muted" style="padding:20px 0">Loading…</p>';
  const {data,error} = await sb.from('profiles').select('id,email,full_name,tier,jobs_completed,is_admin').order('created_at',{ascending:false});
  if (error){el.innerHTML = `<p class="text-muted" style="padding:20px 0">Could not load users. ${error.message}</p>`;return;}
  admRenderUsers(data||[]);
}
function admRenderUsers(users){
  const el = document.getElementById('adm-users');
  if (!users.length){el.innerHTML='<p class="text-muted" style="padding:20px 0">No users yet.</p>';return;}
  el.innerHTML = users.map(u=>`
    <div class="card">
      <div class="adm-row">
        <div>
          <h3>${u.full_name||u.email}</h3>
          <p class="text-muted">Tier ${u.tier!=null?u.tier:'--'} · ${u.jobs_completed||0} jobs done</p>
        </div>
        <span class="adm-badge ${u.is_admin?'adm-badge-admin':'adm-badge-user'}">${u.is_admin?'Admin':'User'}</span>
      </div>
      <button class="btn btn-sm mt8 ${u.is_admin?'btn-outline':'btn-primary'}" onclick="admSetAdmin('${u.id}',${!u.is_admin})">${u.is_admin?'Revoke Admin':'Make Admin'}</button>
    </div>`).join('');
}
async function admSetAdmin(id,value){
  if (!confirm(value?'Grant full administrator access to this user?':'Revoke administrator access from this user?')) return;
  const {error} = await sb.from('profiles').update({is_admin:value}).eq('id',id);
  if (error){alert('Could not update admin status. '+error.message);return;}
  admLoadUsers();
}
async function admLoadJobs(){
  const el = document.getElementById('adm-jobs');
  el.innerHTML = '<p class="text-muted" style="padding:20px 0">Loading…</p>';
  const {data,error} = await sb.from('jobs').select('id,title,trade,owner_id,status').order('created_at',{ascending:false});
  if (error){el.innerHTML = `<p class="text-muted" style="padding:20px 0">Could not load jobs. ${error.message}</p>`;return;}
  const jobs = data||[];
  const ids = [...new Set(jobs.map(j=>j.owner_id).filter(Boolean))];
  const profiles = await admFetchProfiles(ids);
  admRenderJobs(jobs,profiles);
}
async function admFetchProfiles(ids){
  const map = {};
  if (!ids.length) return map;
  const {data} = await sb.from('profiles').select('id,full_name,email').in('id',ids);
  (data||[]).forEach(p=>{map[p.id]=p;});
  return map;
}
function admRenderJobs(jobs,profiles){
  const el = document.getElementById('adm-jobs');
  if (!jobs.length){el.innerHTML='<p class="text-muted" style="padding:20px 0">No jobs yet.</p>';return;}
  const statuses = ['open','filled','closed'];
  el.innerHTML = jobs.map(j=>{
    const poster = profiles[j.owner_id];
    const posterName = poster ? (poster.full_name||poster.email) : '--';
    return `
    <div class="card">
      <h3>${j.title}</h3>
      <p class="text-muted">${j.trade||'--'} · Posted by ${posterName}</p>
      <div class="flex gap8 mt8" style="align-items:center;flex-wrap:wrap">
        <select style="width:auto;margin-bottom:0" onchange="admUpdateJobStatus('${j.id}',this.value)">
          ${statuses.map(s=>`<option value="${s}" ${s===j.status?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-danger btn-sm" onclick="admDeleteJob('${j.id}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
async function admUpdateJobStatus(id,status){
  const {error} = await sb.from('jobs').update({status}).eq('id',id);
  if (error){alert('Could not update job status. '+error.message);admLoadJobs();}
}
async function admDeleteJob(id){
  if (!confirm('Permanently delete this job? This cannot be undone.')) return;
  const {error} = await sb.from('jobs').delete().eq('id',id);
  if (error){alert('Could not delete job. '+error.message);return;}
  admLoadJobs();
}

// ─── RATINGS ──────────────────────────────────────────────────────────────────
function openRating(jobId,revieweeId){
  STATE.currentRatingJobId=jobId;STATE.currentRatingRevieweeId=revieweeId;STATE.currentRating=0;
  document.querySelectorAll('#star-picker span').forEach(s=>s.classList.remove('on'));
  document.getElementById('review-text').value='';
  document.getElementById('rating-overlay').classList.add('open');
}
function setRating(n){
  STATE.currentRating=n;
  document.querySelectorAll('#star-picker span').forEach((s,i)=>s.classList.toggle('on',i<n));
}
async function submitRating(){
  if (!STATE.currentRating){alert('Select a rating');return;}
  if (!STATE.currentRatingRevieweeId){alert('Could not determine who this review is for.');return;}
  const {error} = await sb.from('reviews').insert({
    job_id:      STATE.currentRatingJobId,
    reviewer_id: STATE.user.id,
    reviewee_id: STATE.currentRatingRevieweeId, // the job's poster — set by openRating(), not the reviewer
    rating:      STATE.currentRating,
    body:        document.getElementById('review-text').value
  });
  if (error){alert(error.message);return;}
  closeOverlay('rating-overlay');
}
function closeOverlay(id){document.getElementById(id).classList.remove('open');}

// ─── APPLICANTS / HIRE ────────────────────────────────────────────────────────
// A job owner views who applied to their own posted job and hires one. Hiring:
//   1. marks that application 'accepted' and every other applicant 'rejected'
//      (RLS: "Job posters can update applications on their jobs", added
//      Sep 2, 2026 — before this, owners could not update applications at all)
//   2. marks the job 'filled'
//   3. sets draw_schedules.payee_id to the hired worker — this is the column
//      the Flask backend's require_draw_payee() checks before letting anyone
//      upload draw photos, so hiring here is what unblocks that.
async function openApplicants(jobId){
  STATE.currentApplicantsJobId = jobId;
  document.getElementById('applicants-list').innerHTML = '<p class="text-muted">Loading…</p>';
  document.getElementById('applicants-overlay').classList.add('open');
  const {data, error} = await sb.from('applications')
    .select('id,applicant_id,status,bid_amount,message,created_at,profiles:applicant_id(full_name,trade,tier,rating,jobs_completed)')
    .eq('job_id', jobId)
    .order('created_at',{ascending:true});
  if (error){
    document.getElementById('applicants-list').innerHTML = `<p class="text-muted">Could not load applicants. ${error.message}</p>`;
    return;
  }
  renderApplicantsList(data||[]);
}
function renderApplicantsList(apps){
  const el = document.getElementById('applicants-list');
  if (!apps.length){el.innerHTML = '<p class="text-muted">No applicants yet.</p>';return;}
  const hired = apps.find(a=>a.status==='accepted');
  el.innerHTML = apps.map(a=>{
    const p = a.profiles||{};
    const isHired = a.status==='accepted';
    const isRejected = a.status==='rejected';
    return `
    <div class="card" style="margin-bottom:8px">
      <div class="flex between"><h3>${p.full_name||'Worker'}</h3>${isHired?'<span class="badge badge-teal">Hired</span>':''}</div>
      <p class="text-muted" style="font-size:13px">${p.trade||''}${p.tier?' · Tier '+p.tier:''}${p.rating>0?' · ★ '+p.rating:''}</p>
      ${a.bid_amount?`<p style="margin-top:4px">Bid: $${a.bid_amount}</p>`:''}
      ${a.message?`<p class="text-muted" style="margin-top:4px;font-size:13px">"${a.message}"</p>`:''}
      ${!hired && !isRejected ? `<button class="btn btn-primary btn-sm mt8" onclick="hireApplicant('${a.id}','${a.applicant_id}')">Hire</button>` : ''}
      ${isRejected?'<p class="text-muted" style="font-size:12px;margin-top:6px">Not selected</p>':''}
    </div>`;
  }).join('');
}
async function hireApplicant(applicationId, applicantId){
  if (!confirm('Hire this worker? Other applicants will be marked as not selected, and this job will be marked filled.')) return;
  const jobId = STATE.currentApplicantsJobId;
  const {error:e1} = await sb.from('applications').update({status:'accepted'}).eq('id', applicationId);
  if (e1){alert('Could not hire: '+e1.message);return;}
  await sb.from('applications').update({status:'rejected'}).eq('job_id', jobId).neq('id', applicationId);
  await sb.from('jobs').update({status:'filled'}).eq('id', jobId);
  const {data:sched} = await sb.from('draw_schedules').select('id').eq('job_id', jobId).maybeSingle();
  if (sched) {
    await sb.from('draw_schedules').update({payee_id: applicantId}).eq('id', sched.id);
  }
  await openApplicants(jobId);
  await loadData();render();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
(async()=>{
  const {data:{session}} = await sb.auth.getSession();
  if (session?.user) {
    await onLogin(session.user);
  } else {
    // Logged out: show the landing page and report the real URL to analytics.
    if (location.pathname !== '/') history.replaceState({}, '', '/');
    td.page('/');
  }
})();
