const navToggle=document.querySelector('.nav-toggle'),siteHeader=document.querySelector('.site-header');
if(navToggle){navToggle.hidden=false;siteHeader.classList.add('has-menu');
  function setOpen(open){navToggle.setAttribute('aria-expanded',String(open));siteHeader.classList.toggle('menu-open',open);}
  navToggle.addEventListener('click',()=>setOpen(navToggle.getAttribute('aria-expanded')!=='true'));
  siteHeader.addEventListener('keydown',event=>{if(event.key==='Escape'&&siteHeader.classList.contains('menu-open')){setOpen(false);navToggle.focus();}});
  window.matchMedia('(min-width: 1024px)').addEventListener('change',()=>setOpen(false));
}
