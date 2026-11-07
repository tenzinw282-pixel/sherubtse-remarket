const navToggle=document.querySelector('.nav-toggle'),siteHeader=document.querySelector('.site-header');
if(navToggle){navToggle.hidden=false;siteHeader.classList.add('has-menu');
  function setOpen(open){navToggle.setAttribute('aria-expanded',String(open));siteHeader.classList.toggle('menu-open',open);}
  navToggle.addEventListener('click',()=>setOpen(navToggle.getAttribute('aria-expanded')!=='true'));
  siteHeader.addEventListener('keydown',event=>{if(event.key==='Escape'&&siteHeader.classList.contains('menu-open')){setOpen(false);navToggle.focus();}});
  window.matchMedia('(min-width: 1024px)').addEventListener('change',()=>setOpen(false));
}
// Mark the most specific link in each menu (Overview must not stay active
// while a deeper dashboard or administration page is open).
document.querySelectorAll('.nav-links,.workspace-nav,.admin-sidebar nav').forEach(menu=>{
  const current=window.location.pathname.replace(/\/$/,'')||'/';
  let active=null,longest=-1;
  for(const link of menu.querySelectorAll('a[href]')){
    const target=new URL(link.href,window.location.origin);
    if(target.origin!==window.location.origin)continue;
    const path=target.pathname.replace(/\/$/,'')||'/';
    link.removeAttribute('aria-current');
    if((current===path||(path!=='/'&&current.startsWith(path+'/')))&&path.length>longest){active=link;longest=path.length;}
  }
  active?.setAttribute('aria-current','page');
});
