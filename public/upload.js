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
    const response = await fetch(form.action,{ method:'POST',body:new FormData(form),headers:{ 'X-CSRF-Token':form.elements._csrf.value },credentials:'same-origin' });
    const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(json?.error || 'Request failed. Reload the page, confirm you are logged in, and try again.');
    status.textContent = json.message; window.location.assign(json.redirect);
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
