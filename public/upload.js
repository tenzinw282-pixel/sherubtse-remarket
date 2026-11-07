const form = document.querySelector('#product-form');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#upload-status');
  const button = form.querySelector('button');
  const files = form.querySelector('[name="images"]').files;
  status.className = 'alert alert-info';
  if (files.length < 1 || files.length > 5 || [...files].some(file => file.size > 5*1024*1024)) {
    status.textContent = 'Choose one to five images, each 5 MB or smaller.'; return;
  }
  button.disabled = true; status.textContent = 'Uploading images and saving your listing…';
  try {
    const data=new FormData(form);
    if(data.get('sellingType')==='auction')for(const key of ['startsAt','endsAt']){const time=new Date(data.get(key));if(!Number.isFinite(time.getTime()))throw new Error('Choose valid auction start and end times.');data.set(key,time.toISOString());}
    const response = await fetch(form.action,{ method:'POST',body:data,headers:{ 'X-CSRF-Token':form.elements._csrf.value },credentials:'same-origin' });
    const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(json?.error || 'Request failed. Reload the page, confirm you are logged in, and try again.');
    status.textContent = json.message; window.location.assign(json.redirect);
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
const method=document.querySelector('#sellingType');
method?.addEventListener('change',()=>{const auction=method.value==='auction';document.querySelector('#auction-settings').hidden=!auction;for(const field of document.querySelectorAll('#startsAt,#endsAt,#increment'))field.required=auction;});
let previewUrls=[];
if(method)fetch('/api/time').then(response=>response.json()).then(({now})=>{
  const epoch=new Date(now).getTime(),offset=new Date().getTimezoneOffset()*60000;
  for(const [key,delta] of [['startsAt',0],['endsAt',86400000]]){const field=document.querySelector('#'+key);if(!field.value)field.value=new Date(epoch+delta-offset).toISOString().slice(0,16);}
}).catch(()=>{});
document.querySelector('#images')?.addEventListener('change',event=>{
  previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];const preview=document.querySelector('#image-previews');preview.replaceChildren();
  for(const file of [...event.target.files].slice(0,5)){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)continue;const url=URL.createObjectURL(file);previewUrls.push(url);const image=document.createElement('img');image.src=url;image.alt=`Preview: ${file.name}`;image.width=100;image.height=100;preview.append(image);}
});
