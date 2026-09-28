const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const state={api:[],repo:null,tree:[],manifests:[],vulns:[],readme:""};

function trace(name,url,ok=true){state.api.push({name,url,ok});renderTrace();}
function renderTrace(){$("#apiTrace").innerHTML=state.api.map(x=>`<div class="trace"><b>${x.ok?"OK":"ERR"}</b>${esc(x.name)} · ${esc(x.url)}</div>`).join("")}

async function api(url,name,opts={}){
  const r=await fetch(url,{headers:{"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},...opts});
  trace(name,url,r.ok);
  if(!r.ok){let t="";try{t=await r.text()}catch{};throw new Error(`${name} returned ${r.status}${t?" — "+t.slice(0,120):""}`)}
  return r.json();
}
async function raw(url,name){const r=await fetch(url);trace(name,url,r.ok);if(!r.ok)throw new Error(`${name} returned ${r.status}`);return r.text()}

function parseRepo(v){
  v=v.trim().replace(/\/+$/,"");
  try{const u=new URL(v);if(u.hostname!=="github.com")throw 0;const p=u.pathname.split("/").filter(Boolean);if(p.length<2)throw 0;return {owner:p[0],repo:p[1].replace(/\.git$/,"")}}catch{}
  const p=v.replace(/^github\.com\//,"").split("/").filter(Boolean);if(p.length>=2)return{owner:p[0],repo:p[1].replace(/\.git$/,"")};
  throw new Error("Enter a public GitHub URL such as https://github.com/owner/repository");
}
function fmtNum(n){return Intl.NumberFormat("en",{notation:n>9999?"compact":"standard",maximumFractionDigits:1}).format(n||0)}
function age(s){const d=new Date(s),ms=Date.now()-d.getTime(),days=Math.floor(ms/864e5);return days<1?"today":days<30?`${days}d ago`:days<365?`${Math.floor(days/30)}mo ago`:`${Math.floor(days/365)}y ago`}
function bytes(n){if(!n)return"0 B";const u=["B","KB","MB","GB"];let i=0,x=n;while(x>1024&&i<3){x/=1024;i++}return `${x.toFixed(i?1:0)} ${u[i]}`}

async function scan(){
  const {owner,repo}=parseRepo($("#repoInput").value);
  resetUI(); showLoading("Reading repository","Fetching public GitHub metadata");
  const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try{
    const r=await api(base,"GitHub repository");
    state.repo=r;
    showLoading("Mapping structure","Fetching top-level tree and documentation");
    const [contents,readme]=await Promise.all([
      api(`${base}/contents?ref=${encodeURIComponent(r.default_branch)}`,"GitHub contents"),
      api(`${base}/readme`,"GitHub README").catch(()=>null)
    ]);
    state.tree=Array.isArray(contents)?contents:[];
    if(readme?.content){
      state.readme=decodeBase64(readme.content);
    }
    renderRepo();
    showLoading("Checking dependencies","Inspecting common manifest files");
    await inspectManifests(base,state.tree);
    showLoading("Checking vulnerability intelligence","Querying OSV for discovered package coordinates");
    await osvScan();
    renderAll();
    $("#loading").classList.add("hidden");$("#dashboard").classList.remove("hidden");
    $("#dashboard").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    $("#loading").classList.add("hidden"); showError(e.message||"Scan failed");
  }
}
function decodeBase64(s){try{return decodeURIComponent(escape(atob(s.replace(/\n/g,""))))}catch{return atob(s.replace(/\n/g,""))}}
function resetUI(){state.api=[];state.tree=[];state.manifests=[];state.vulns=[];state.readme="";$("#error").classList.add("hidden");$("#dashboard").classList.add("hidden");$("#apiTrace").innerHTML=""}
function showLoading(a,b){$("#loading").classList.remove("hidden");$("#loadingTitle").textContent=a;$("#loadingText").textContent=b}
function showError(s){$("#error").textContent=s;$("#error").classList.remove("hidden")}
function renderRepo(){
 const r=state.repo;
 $("#repoFullName").textContent=r.full_name;$("#repoName").textContent=r.name;$("#repoDesc").textContent=r.description||"No repository description provided.";
 $("#openRepo").href=r.html_url;$("#stars").textContent=fmtNum(r.stargazers_count);$("#forks").textContent=fmtNum(r.forks_count)+" forks";$("#issues").textContent=fmtNum(r.open_issues_count);
 $("#lastPush").textContent=age(r.pushed_at);$("#lastPushRaw").textContent=new Date(r.pushed_at).toLocaleString();
 $("#repoChips").innerHTML=[r.language,r.license?.spdx_id,r.archived?"ARCHIVED":null,r.fork?"FORK":null,r.visibility?.toUpperCase()].filter(Boolean).map(x=>`<span class="chip">${esc(x)}</span>`).join("");
 const facts=[
 ["Owner",r.owner?.login],["Default branch",r.default_branch],["Size",bytes(r.size*1024)],["Created",new Date(r.created_at).toLocaleDateString()],["Updated",new Date(r.updated_at).toLocaleDateString()],["License",r.license?.name||"Not detected"],["Homepage",r.homepage||"—"],["Topics",(r.topics||[]).join(", ")||"—"],["Watchers",fmtNum(r.subscribers_count)],["Network forks",fmtNum(r.network_count)]
 ];
 $("#facts").innerHTML=facts.map(([a,b])=>`<div class="fact"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join("");
 $("#readmeBadge").textContent=state.readme?"FOUND":"MISSING";
 $("#readmeBox").className="readme"+(state.readme?"":" empty");
 $("#readmeBox").textContent=state.readme?state.readme.slice(0,8000):"No readable README was returned by the public GitHub API.";
 $("#treeCount").textContent=`${state.tree.length} top-level entries`;
 $("#tree").innerHTML=state.tree.map(x=>`<div class="tree-item ${x.type==="dir"?"dir":"file"}"><span>${x.type==="dir"?"▰":"▱"}</span><span>${esc(x.name)}</span></div>`).join("");
}
async function inspectManifests(base,items){
 const names=new Set(items.map(x=>x.name.toLowerCase()));
 const candidates=[
  ["package.json","npm package manifest"],["package-lock.json","npm lockfile"],["pnpm-lock.yaml","pnpm lockfile"],["yarn.lock","Yarn lockfile"],
  ["requirements.txt","Python requirements"],["pyproject.toml","Python project"],["poetry.lock","Poetry lockfile"],
  ["go.mod","Go module"],["cargo.toml","Rust manifest"],["cargo.lock","Rust lockfile"],
  ["pom.xml","Maven manifest"],["composer.json","Composer manifest"],["gemfile","Ruby manifest"],["dockerfile","Container definition"]
 ];
 for(const [n,label] of candidates) if(names.has(n)){
   try{
    const x=await api(`${base}/contents/${encodeURIComponent(n)}?ref=${encodeURIComponent(state.repo.default_branch)}`,label);
    let txt=x.content?decodeBase64(x.content):"";
    state.manifests.push({name:n,label,text:txt,size:x.size||0});
   }catch{}
 }
}
function detectPackages(){
 const out=[];
 for(const m of state.manifests){
   const t=m.text;
   if(m.name==="package.json"){try{const j=JSON.parse(t);for(const [name,version] of Object.entries({...j.dependencies,...j.devDependencies}))out.push({ecosystem:"npm",name,version:String(version).replace(/^[^0-9]*/,"")||"*",source:m.name})}catch{}}
   if(m.name==="requirements.txt"){for(const line of t.split(/\n/)){const x=line.trim();if(!x||x.startsWith("#")||x.startsWith("-"))continue;const z=x.match(/^([A-Za-z0-9_.-]+)\s*(?:==\s*([0-9][^\\s]*))?/);if(z)out.push({ecosystem:"PyPI",name:z[1],version:z[2]||"*",source:m.name})}}
   if(m.name==="go.mod"){for(const line of t.split(/\n/)){const z=line.match(/^\s*([A-Za-z0-9_.-]+\/[^\s]+)\s+v([0-9][^\s]+)/);if(z)out.push({ecosystem:"Go",name:z[1],version:z[2],source:m.name})}}
   if(m.name==="Cargo.toml"){for(const line of t.split(/\n/)){const z=line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?([0-9][^"'\s]+)["']?/);if(z)out.push({ecosystem:"crates.io",name:z[1],version:z[2],source:m.name})}}
 }
 return out.slice(0,120);
}
async function osvScan(){
 const pkgs=detectPackages();
 if(!pkgs.length)return;
 const queries=pkgs.filter(x=>x.version&&x.version!=="*").slice(0,60);
 if(!queries.length)return;
 const r=await fetch("https://api.osv.dev/v1/querybatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({queries:queries.map(x=>({package:{name:x.name,ecosystem:x.ecosystem},version:x.version}))})});
 trace("OSV vulnerability batch","https://api.osv.dev/v1/querybatch",r.ok);if(!r.ok)return;
 const data=await r.json();
 state.vulns=data.results||[];
 state.pkgResults=queries;
}
function renderAll(){
 const r=state.repo, pkgs=detectPackages(), vulnCount=state.vulns.filter(x=>x.vulns?.length).length;
 const stale=(Date.now()-new Date(r.pushed_at).getTime())>365*864e5;
 const signals=[];
 signals.push({t:r.archived?"Repository is archived":"Repository is active",d:r.archived?"Archived repositories do not receive normal maintenance updates.":"GitHub marks this repository as active.",c:r.archived?"bad":"good"});
 signals.push({t:r.license?"License detected":"No license detected",d:r.license?`${r.license.name} (${r.license.spdx_id||"SPDX unavailable"})`:"Users may have unclear reuse rights until a license is added.",c:r.license?"good":"warn"});
 signals.push({t:stale?"Maintenance age is high":"Recent repository activity",d:stale?`Last push was ${age(r.pushed_at)}.`:`Last push was ${age(r.pushed_at)}.`,c:stale?"warn":"good"});
 signals.push({t:state.readme?"README available":"README missing",d:state.readme?"Documentation was returned by GitHub.":"A public README was not available from the repository API.",c:state.readme?"good":"warn"});
 $("#securityList").innerHTML=signals.map(s=>`<div class="signal ${s.c==="warn"?"warn":s.c==="bad"?"bad":""}"><i class="dot"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("");
 $("#securityBadge").textContent=`${signals.filter(s=>s.c==="bad").length} critical · ${signals.filter(s=>s.c==="warn").length} warnings`;
 const depSignals=[];
 if(!pkgs.length)depSignals.push({t:"No supported manifest detected",d:"Add a package manifest such as package.json, requirements.txt, go.mod or Cargo.toml to enable dependency checks.",c:"warn"});
 else depSignals.push({t:`${pkgs.length} package coordinates detected`,d:"The scanner extracted versioned dependencies from supported manifests.",c:"good"});
 depSignals.push(vulnCount?{t:`${vulnCount} packages returned OSV findings`,d:"Review the affected package versions and upgrade paths before shipping.",c:"bad"}:{t:"No OSV findings for scanned versions",d:"No vulnerability record was returned for the versioned coordinates scanned. This is not a guarantee of safety.",c:"good"});
 $("#dependencyList").innerHTML=depSignals.map(s=>`<div class="signal ${s.c==="warn"?"warn":s.c==="bad"?"bad":""}"><i class="dot"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("");
 $("#depBadge").textContent=pkgs.length?`${pkgs.length} packages`:"No manifest";
 let score=100;
 if(!r.license)score-=15;if(!state.readme)score-=10;if(r.archived)score-=30;if(stale)score-=15;if(vulnCount)score-=Math.min(35,vulnCount*7);
 score=Math.max(0,score);$("#healthScore").textContent=score+"/100";$("#healthLabel").textContent=score>=85?"Strong signals":score>=65?"Review recommended":"Attention required";
}
function downloadReport(){
 const r=state.repo,pkgs=detectPackages();
 const report={generated_at:new Date().toISOString(),tool:"RepoGuardian",repository:{full_name:r.full_name,url:r.html_url,default_branch:r.default_branch,stars:r.stargazers_count,forks:r.forks_count,issues:r.open_issues_count,license:r.license?.spdx_id||null,last_push:r.pushed_at},signals:{archived:r.archived,readme:!!state.readme,manifest_count:state.manifests.length,package_count:pkgs.length,osv_results:state.vulns.length},manifests:state.manifests.map(x=>({name:x.name,size:x.size})),packages:pkgs,vulnerabilities:state.vulns};
 const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`repoguardian-${r.full_name.replace("/","-")}.json`;a.click();URL.revokeObjectURL(a.href);
}
$("#scanForm").addEventListener("submit",e=>{e.preventDefault();scan().catch(x=>showError(x.message))});
document.querySelectorAll("[data-repo]").forEach(b=>b.addEventListener("click",()=>{$("#repoInput").value=b.dataset.repo;scan()}));
$("#exportBtn").addEventListener("click",downloadReport);
$("#themeBtn").addEventListener("click",()=>document.body.classList.toggle("light"));
