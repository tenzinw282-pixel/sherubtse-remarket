const panel=document.querySelector('#auction-panel');
if(panel){
  const id=panel.dataset.auction;let state,offset=0;
  const status=document.querySelector('#bid-status'),form=document.querySelector('#bid-form');
  function clock(){if(!state)return;const now=Date.now()+offset,end=new Date(state.endsAt).getTime(),start=new Date(state.startsAt).getTime();const remaining=Math.max(0,end-now);const seconds=Math.floor(remaining/1000);
    document.querySelector('#auction-countdown').textContent=state.status!=='open'||!remaining?'Ended':now<start?'Not started':`${Math.floor(seconds/86400)}d ${Math.floor(seconds%86400/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`;
    if(form)form.querySelector('button').disabled=state.status!=='open'||now<start||remaining===0;
  }
  async function refresh(){try{const response=await fetch(`/api/auctions/${id}`);if(!response.ok)throw new Error();state=await response.json();offset=new Date(state.now).getTime()-Date.now();document.querySelector('#current-bid').textContent=`Nu. ${state.current}`;document.querySelector('#bid-count').textContent=state.count;
    if(form){form.elements.amount.min=state.minimum;form.elements.amount.placeholder=`Minimum ${state.minimum}`;}
    status.textContent=state.status==='open'?(state.highestBidder?'You currently have the highest bid.':`${state.count?'':'No bids yet. '}Minimum next bid: Nu. ${state.minimum}`):state.status==='cancelled'?'This auction was cancelled. No new bids can be placed.':'Auction ended. If you won, your transaction appears in Won auctions.';
    const body=document.querySelector('#bid-history');body.replaceChildren();for(const bid of state.history){const row=document.createElement('tr');for(const value of [bid.full_name+(bid.isYou?' (you)':''),`Nu. ${bid.amount}`,new Date(bid.created_at).toLocaleString()]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}clock();
  }catch{status.textContent='Could not refresh auction status. Retrying automatically.';if(form)form.querySelector('button').disabled=true;}}
  form?.addEventListener('submit',async event=>{event.preventDefault();form.querySelector('button').disabled=true;try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':form.elements._csrf.value},body:JSON.stringify({amount:form.elements.amount.value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Bid rejected.');await refresh();status.textContent=result.message;form.reset();}catch(error){status.textContent=error.message;}finally{clock();}});
  if(panel.dataset.auth==='true'&&typeof io==='function'){const socket=io();socket.on('connect',()=>socket.emit('join-auction',id));socket.on('bid',refresh);socket.on('auction-ended',refresh);}
  void refresh();setInterval(refresh,5000);setInterval(clock,1000);
}
