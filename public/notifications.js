const badge=document.querySelector('#notification-count');
if(badge){async function refreshCount(){try{const response=await fetch('/api/notifications/unread');if(response.ok){const {count}=await response.json();badge.textContent=count?String(count):'';}}catch{}}
  void refreshCount();setInterval(refreshCount,30000);
}
