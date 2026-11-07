const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const dotenv=require('dotenv');
function findingsFor(text,secrets){
  const findings=[];
  if(secrets.some(value=>value.length>=8&&text.includes(value)))findings.push('configured credential value');
  if(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text))findings.push('private key');
  if(/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/.test(text))findings.push('access token');
  const assignments=text.matchAll(/^[ \t]*(?:SMTP_PASS|CLOUDINARY_API_SECRET|SESSION_SECRET|DATABASE_URL|DIRECT_DATABASE_URL|MONGODB_URI)[ \t]*=[ \t]*([^\r\n]*)/gm);
  for(const match of assignments){const value=match[1].trim().replace(/^['"]|['"]$/g,'');if(value&&!/replace|placeholder|USER:PASSWORD|localhost|example|<.*>|^\$\{/i.test(value)){findings.push('non-placeholder environment credential');break;}}
  return findings;
}
function main(){
  const local=fs.existsSync('.env')?dotenv.parse(fs.readFileSync('.env')):{};
  const settings={...local,...process.env};
  const keys=['DATABASE_URL','DIRECT_DATABASE_URL','MONGODB_URI','SESSION_SECRET','SMTP_PASS','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','GITHUB_TOKEN','GH_TOKEN','RENDER_API_KEY','ADMIN_PASSWORD'];
  const secrets=keys.map(key=>settings[key]).filter(value=>typeof value==='string'&&value.length>=8&&!value.startsWith('replace-'));
  for(const key of ['DATABASE_URL','DIRECT_DATABASE_URL','MONGODB_URI']){try{const url=new URL(settings[key]);if(url.password)secrets.push(decodeURIComponent(url.password));}catch{}}
  const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024});
  if(git(['ls-files','.env']).trim())throw new Error('.env is tracked; refuse to push credentials.');
  let commits=[];
  try{commits=git(['rev-list','origin/main..HEAD']).trim().split('\n').filter(Boolean);}catch{throw new Error('Fetch origin/main before checking unpublished history.');}
  const failures=[];
  function inspect(file,content,label){
    if(/(?:^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))failures.push(`${label}: ${file}: private environment file`);
    for(const reason of findingsFor(content,secrets))failures.push(`${label}: ${file}: ${reason}`);
  }
  for(const file of git(['diff','--cached','--name-only','--diff-filter=ACMR','-z']).split('\0').filter(Boolean))inspect(file,git(['show',`:${file}`]),'staged');
  for(const commit of commits)for(const file of git(['ls-tree','-r','--name-only','-z',commit]).split('\0').filter(Boolean))inspect(file,git(['show',`${commit}:${file}`]),commit.slice(0,8));
  if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;return;}
  console.log('Secret gate passed: staged source and unpublished commits contain no known configured credentials, private env files, private keys or recognized access tokens.');
}
if(require.main===module){try{main();}catch{console.error('Secret gate could not complete. Inspect Git staging and fetched origin/main; no file contents or credential values are printed.');process.exitCode=1;}}
module.exports={findingsFor};
