document.querySelectorAll('[data-password-toggle]').forEach(button=>{
  const input=document.getElementById(button.getAttribute('aria-controls'));
  if(!input)return;
  button.hidden=false;
  function setVisible(visible){
    const start=input.selectionStart,end=input.selectionEnd;
    input.type=visible?'text':'password';
    button.setAttribute('aria-pressed',String(visible));
    button.setAttribute('aria-label',`${visible?'Hide':'Show'} ${button.dataset.passwordLabel}`);
    button.querySelector('i').className=`bi ${visible?'bi-eye-slash':'bi-eye'}`;
    if(start!==null&&end!==null)input.setSelectionRange(start,end);
  }
  button.addEventListener('click',()=>setVisible(input.type==='password'));
  input.form?.addEventListener('submit',()=>setVisible(false));
  window.addEventListener('pagehide',()=>setVisible(false));
});
