const {Notification}=require('../models/documents');
const {transaction}=require('../services/database');
function startJobs({pool,commerce,publish=()=>{}}) {
  let current=null,stopped=false;
  async function run() {
    try {
      await commerce.closeDue();
      await transaction(pool,async client=>{
        const batch=(await client.query("SELECT * FROM outbox WHERE processed_at IS NULL AND available_at<=now() ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED")).rows;
        for(const event of batch){
          try{
            if(event.event_type==='notification'){
              const notice=await Notification.findOneAndUpdate({userId:event.payload.userId,eventKey:event.event_key},{$setOnInsert:event.payload},{upsert:true,new:true});
              publish(`user:${event.payload.userId}`,'notification',{id:String(notice._id)});
            }
            await client.query('UPDATE outbox SET processed_at=now() WHERE id=$1',[event.id]);
          }catch{
            await client.query("UPDATE outbox SET attempts=attempts+1,available_at=now()+interval '30 seconds' WHERE id=$1",[event.id]);
          }
        }
      });
    }catch{console.error('Marketplace reconciliation or notification delivery failed; retrying automatically.');}
  }
  function tick(){
    if(stopped)return Promise.resolve();
    if(current)return current;
    current=run().finally(()=>{current=null;});return current;
  }
  const timer=setInterval(tick,5000);timer.unref();void tick();
  return {tick,stop:async()=>{stopped=true;clearInterval(timer);await current;}};
}
module.exports={startJobs};
