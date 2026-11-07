document.querySelectorAll('[data-photo]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#gallery-main').src=button.dataset.photo;}));
document.querySelectorAll('input[data-utc]').forEach(input=>input.form.addEventListener('submit',()=>{input.type='text';input.value=input.value.replace(/Z$/,'')+'Z';}));
