document.querySelectorAll('form[data-ajax]').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();const status=document.querySelector('[data-form-status]');const button=form.querySelector('button[type="submit"],button:not([type])');
  if(button)button.disabled=true;status.className='alert alert-info';status.textContent='Saving…';
  try{const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{'X-CSRF-Token':form.elements._csrf.value},credentials:'same-origin'});
    const result=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
    if(!response.ok)throw new Error(result?.error||'Unable to save. Check your session, reload the page and try again.');
    status.textContent=result.message;if(result.redirect)window.location.assign(result.redirect);
  }catch(error){status.className='alert alert-danger';status.textContent=error.message;}finally{if(button)button.disabled=false;}
}));
